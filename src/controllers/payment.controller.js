const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User.model');

// Initialize Razorpay
const getRazorpayInstance = () => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error("Razorpay keys not configured in backend");
    }
    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
};

exports.createOrder = async (req, res) => {
    try {
        const { amount, currency = "INR", receipt } = req.body;
        
        if (!amount) {
            return res.status(400).json({ error: 'Amount is required' });
        }

        const razorpay = getRazorpayInstance();

        const options = {
            amount: amount * 100, // Razorpay expects amount in paise
            currency,
            receipt: receipt || `receipt_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        if (!order) {
            return res.status(500).json({ error: 'Failed to create order' });
        }

        res.json({ order });
    } catch (error) {
        console.error('Create Order Error:', error);
        res.status(500).json({ error: 'Server error creating Razorpay order' });
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature, 
            purchaseType, // 'subscription'
        } = req.body;
        
        const userId = req.user.userId;

        // Verify Signature
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest("hex");

        if (razorpay_signature === expectedSign) {
            // Payment is legit! Update the user's account
            const user = await User.findById(userId);
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (purchaseType === 'subscription') {
                const days = plan === 'annual' ? 365 : 30;
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + days);

                user.is_premium = true;
                user.subscription_plan = plan;
                user.subscription_expires_at = expiresAt;
            }

            await user.save();

            res.json({ 
                message: 'Payment verified successfully',
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    is_premium: user.is_premium,
                    subscription_plan: user.subscription_plan,
                    subscription_expires_at: user.subscription_expires_at,
                }
            });
        } else {
            return res.status(400).json({ error: 'Invalid signature sent!' });
        }
    } catch (error) {
        console.error('Verify Payment Error:', error);
        res.status(500).json({ error: 'Server error verifying Razorpay payment' });
    }
};
