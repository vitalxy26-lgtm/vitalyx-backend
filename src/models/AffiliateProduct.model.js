const mongoose = require('mongoose');

const affiliateProductSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Supplements', 'Equipment', 'Healthy Snacks', 'Clothing', 'Other']
    },
    price_string: {
        type: String,
        required: true, // e.g "$45.99"
    },
    rating: {
        type: Number,
        default: 4.5
    },
    image_url: {
        type: String,
        required: true
    },
    affiliate_link: {
        type: String,
        required: true
    },
    is_active: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('AffiliateProduct', affiliateProductSchema);
