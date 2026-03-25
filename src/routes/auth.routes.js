const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/verify-email', authMiddleware, authController.verifyEmail);
router.post('/resend-verification', authMiddleware, authController.resendVerification);
router.post('/profile', authMiddleware, authController.setupProfile);
router.get('/me', authMiddleware, authController.getMe);

module.exports = router;
