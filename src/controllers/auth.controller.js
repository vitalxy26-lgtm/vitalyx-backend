const User = require('../models/User.model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { z } = require('zod');

// ── Nodemailer transporter ──────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // true for 465, false for 587
    family: 6,    // FORCE IPv6 instead of IPv4
    auth: {
        user: process.env.SMTP_USER,
        pass: (process.env.SMTP_PASS || '').trim(),
    },
});

// ── Serializer — the ONLY shape that leaves the API ─────────────────────────
const serializeUser = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    is_email_verified: user.is_email_verified,
    age: user.age ?? null,
    gender: user.gender ?? null,
    height: user.height ?? null,
    weight: user.weight ?? null,
    fitness_level: user.fitness_level ?? null,
    goal: user.goal ?? null,
    diet_preference: user.diet_preference ?? null,
    target_weight: user.target_weight ?? null,
    target_timeframe_weeks: user.target_timeframe_weeks ?? null,
    equipment: user.equipment ?? 'home_no_equipment',
    is_premium: Boolean(user.is_premium),
    subscription_plan: user.subscription_plan ?? 'free',
    subscription_expires_at: user.subscription_expires_at ?? null,
    weight_updated_at: user.weight_updated_at ?? null,
});

// Re-export serializeUser so other controllers can import it
exports.serializeUser = serializeUser;

// ── Validation Schemas ──────────────────────────────────────────────────────
const signupSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
    email: z.string().email('Invalid email address').max(254),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
    email: z.string().email('Invalid email address').max(254),
    password: z.string().min(1, 'Password is required').max(128),
});

const verifyEmailSchema = z.object({
    code: z.string().length(6, 'Verification code must be 6 digits'),
});

const profileSchema = z.object({
    age: z.number().int().min(10).max(120).optional(),
    gender: z.string().max(20).optional(),
    height: z.number().min(50).max(300).optional(),
    weight: z.number().min(20).max(500).optional(),
    goal: z.enum(['fat_loss', 'muscle_gain', 'maintain_weight']).optional(),
    fitness_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    diet_preference: z.enum(['vegetarian', 'non_vegetarian', 'vegan']).optional(),
    target_weight: z.number().min(20).max(500).optional(),
    target_timeframe_weeks: z.number().int().min(1).max(520).optional(),
    equipment: z.enum(['home_no_equipment', 'home_with_equipment', 'gym']).optional(),
});

// ── Disposable-email blocklist ──────────────────────────────────────────────
const disposableDomains = ['tempmail.com', '10minutemail.com', 'tmail.com', 'mailinator.com', 'guerrillamail.com'];

// ─────────────────────────────────────────────────────────────────────────────
// Signup
// ─────────────────────────────────────────────────────────────────────────────
exports.signup = async (req, res) => {
    try {
        // Validate input
        const parsed = signupSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error?.issues?.[0]?.message || 'Invalid input' });
        }
        const { name, email, password } = parsed.data;

        // Check if disposable email
        const domain = email.split('@')[1];
        const envDomains = process.env.DISPOSABLE_DOMAINS ? process.env.DISPOSABLE_DOMAINS.split(',') : [];
        const allDisposableDomains = [...new Set([...disposableDomains, ...envDomains])];

        if (allDisposableDomains.includes(domain)) {
            return res.status(400).json({ error: 'Temporary or disposable email addresses are not allowed.' });
        }

        // Check for existing user
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        // Hash Password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Generate a 6-digit verification token with 24h expiry
        const verification_token = Math.floor(100000 + Math.random() * 900000).toString();
        const verification_token_expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Create User
        const user = new User({
            name,
            email,
            password_hash,
            verification_token,
            verification_token_expires,
        });

        // Send Email via Nodemailer (Fire and forget, do not await)
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            transporter.sendMail({
                from: `"VITALYX" <${process.env.SMTP_USER}>`,
                to: email,
                subject: 'Verify Your VITALYX Account',
                text: `Your verification code is: ${verification_token}. Expires in 24 hours.`,
                html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#111827;border-radius:16px;">
                    <h2 style="color:#13ec80">Welcome to VITALYX! 💪</h2>
                    <p style="color:#d1d5db">Your verification code is:</p>
                    <h1 style="color:#13ec80;letter-spacing:12px;font-size:40px">${verification_token}</h1>
                    <p style="color:#9ca3af;font-size:13px">This code expires in 24 hours.</p>
                </div>`,
            }).catch(mailError => console.error('Background Email Error:', mailError.message));
        }

        // Generate JWT — NO fallback secret, 1-day expiry
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(201).json({ 
            message: 'User created successfully. Please verify your email.',
            token,
            user: serializeUser(user),
        });

    } catch (error) {
        console.error('Signup Error:', error);
        res.status(500).json({ error: 'Server error during signup' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
    try {
        // Validate input
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error?.issues?.[0]?.message || 'Invalid input' });
        }
        const { email, password } = parsed.data;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Auto-expire subscription if date has passed
        if (user.is_premium && user.subscription_expires_at && user.subscription_expires_at < new Date()) {
            user.is_premium = false;
            user.subscription_plan = 'free';
            user.subscription_expires_at = null;
            await user.save();
        }

        // Generate JWT — NO fallback secret, 7-day expiry
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

        const isProfileComplete = !!user.goal;

        res.json({
            message: 'Logged in successfully',
            token,
            isProfileComplete,
            user: serializeUser(user),
        });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Verify Email — now checks OTP expiry
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
    try {
        const parsed = verifyEmailSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.errors[0].message });
        }

        const userId = req.user.userId;
        const { code } = parsed.data;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.is_email_verified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        // Check OTP expiry
        if (user.verification_token_expires && user.verification_token_expires < new Date()) {
            return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
        }

        if (user.verification_token !== code) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        user.is_email_verified = true;
        user.verification_token = undefined;
        user.verification_token_expires = undefined;
        await user.save();

        res.json({ message: 'Email verified successfully', user: serializeUser(user) });

    } catch (error) {
        console.error('Email Verification Error:', error);
        res.status(500).json({ error: 'Server error during verification' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Resend Verification Email
// ─────────────────────────────────────────────────────────────────────────────
exports.resendVerification = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.is_email_verified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        // Generate a new 6-digit verification token with 24h expiry
        const verification_token = Math.floor(100000 + Math.random() * 900000).toString();
        const verification_token_expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        user.verification_token = verification_token;
        user.verification_token_expires = verification_token_expires;
        await user.save();

        // Resend email via Nodemailer (Fire and forget)
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            transporter.sendMail({
                from: `"VITALYX" <${process.env.SMTP_USER}>`,
                to: user.email,
                subject: 'New Verification Code for VITALYX',
                text: `Your new verification code is: ${verification_token}. Expires in 24 hours.`,
                html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#111827;border-radius:16px;">
                    <h2 style="color:#13ec80">Your New Code 🔄</h2>
                    <p style="color:#d1d5db">Here is your fresh verification code:</p>
                    <h1 style="color:#13ec80;letter-spacing:12px;font-size:40px">${verification_token}</h1>
                    <p style="color:#9ca3af;font-size:13px">This code expires in 24 hours.</p>
                </div>`,
            }).catch(mailError => console.error('Background Resend Email Error:', mailError.message));
        }

        res.json({ message: 'Verification code resent successfully' });

    } catch (error) {
        console.error('Resend Verification Error:', error);
        res.status(500).json({ error: 'Server error during resend verification' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Setup Profile — with zod validation
// ─────────────────────────────────────────────────────────────────────────────
exports.setupProfile = async (req, res) => {
    try {
        const parsed = profileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.errors[0].message });
        }

        const userId = req.user?.userId;
        const { age, gender, height, weight, goal, fitness_level, diet_preference, target_weight, target_timeframe_weeks, equipment } = parsed.data;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { age, gender, height, weight, goal, fitness_level, diet_preference, target_weight, target_timeframe_weeks, equipment },
            { returnDocument: 'after', runValidators: true }
        ).select('-password_hash');

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'Profile updated successfully',
            user: serializeUser(updatedUser)
        });

    } catch (error) {
        console.error('Profile Setup Error:', error);
        res.status(500).json({ error: 'Server error during profile setup' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /me — validates token & returns current user (used by frontend on resume)
// ─────────────────────────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            user: serializeUser(user),
            isProfileComplete: !!user.goal,
            isEmailVerified: user.is_email_verified,
        });
    } catch (error) {
        console.error('GetMe Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
