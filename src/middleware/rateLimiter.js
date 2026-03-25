const rateLimit = require('express-rate-limit');

// Use authenticated user ID when available, fall back to IP
const userOrIpKey = (req) => req.user?.userId || req.ip;

// Skip entirely for premium users
const skipIfPremium = (req) => req.user?.is_premium === true;

// General AI queries limit — free: 10/day, premium: unlimited
exports.aiChatLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 10,
    keyGenerator: userOrIpKey,
    skip: skipIfPremium,
    validate: false,
    message: { error: 'Daily AI chat limit reached. Upgrade to Premium for unlimited access.' }
});

// AI Plan generation — free: 3/day, premium: unlimited
exports.aiPlanLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 3,
    keyGenerator: userOrIpKey,
    skip: skipIfPremium,
    validate: false,
    message: { error: 'Daily plan generation limit reached. Upgrade to Premium for unlimited access.' }
});

// Image scan limit — free: 5/day, premium: unlimited
exports.aiScanLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 5,
    keyGenerator: userOrIpKey,
    skip: skipIfPremium,
    validate: false,
    message: { error: 'Daily food scan limit reached. Upgrade to Premium for unlimited scans.' }
});
