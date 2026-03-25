const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.put('/profile', authMiddleware, userController.updateProfile);
router.post('/upgrade', authMiddleware, userController.upgradeSubscription);
router.post('/history/workouts', authMiddleware, userController.createWorkoutLog);

router.get('/history/workouts', authMiddleware, userController.getWorkoutHistory);
router.get('/history/diet', authMiddleware, userController.getDietHistory);
router.get('/behaviour-summary', authMiddleware, userController.getBehaviourSummary);
router.get('/affiliate-products', authMiddleware, userController.getAffiliateProducts);
router.get('/dashboard/today', authMiddleware, userController.getTodayDashboard);

module.exports = router;
