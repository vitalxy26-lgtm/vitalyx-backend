const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { aiChatLimiter, aiPlanLimiter, aiScanLimiter } = require('../middleware/rateLimiter');

// Chat with the AI Coach (no auth required — behaviour context uses optional userId)
router.post('/coach', authMiddleware, aiChatLimiter, aiController.chatCoach);

// Generate a Workout Plan (multi-day)
router.post('/workout', aiPlanLimiter, aiController.generateWorkoutPlan);

// Generate & save full weekly muscle-group split
router.post('/weekly-plan', authMiddleware, aiPlanLimiter, aiController.generateWeeklyPlan);
router.get('/weekly-plan', authMiddleware, aiController.getWeeklyPlan);

// Generate a Meal Plan
router.post('/mealplan', authMiddleware, aiPlanLimiter, aiController.generateMealPlan);

// Scan Food Image
router.post('/scanfood', authMiddleware, aiScanLimiter, aiController.scanFoodImage);

// Log Meal with AI Calculation
router.post('/log-meal', authMiddleware, aiController.logMeal);

// AI personalized store product recommendations
router.post('/store-recommendations', authMiddleware, aiPlanLimiter, aiController.generateStoreRecommendations);

module.exports = router;
