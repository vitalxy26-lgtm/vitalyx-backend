const User = require('../models/User.model');
const { serializeUser } = require('./auth.controller');

// ── Update user profile ────────────────────────────────────────────
const EDITABLE_FIELDS = [
    'name', 'age', 'gender', 'height', 'weight',
    'goal', 'fitness_level', 'diet_preference', 'equipment',
    'target_weight', 'target_timeframe_weeks',
];

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        // Only pick allowed fields
        const updates = {};
        for (const key of EDITABLE_FIELDS) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        // Auto-track when weight is updated
        if (updates.weight !== undefined) {
            updates.weight_updated_at = new Date();
        }

        const user = await User.findByIdAndUpdate(userId, updates, { returnDocument: 'after' }).select('-password_hash');
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({ message: 'Profile updated', user: serializeUser(user) });
    } catch (error) {
        console.error('Update Profile Error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
};

const getTodayStart = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
};

const calculateNutritionTargets = (user) => {
    const weight = Number(user.weight) || 70;
    const height = Number(user.height) || 170;
    const age = Number(user.age) || 30;
    const gender = String(user.gender || '').toLowerCase();
    const genderOffset = gender.startsWith('f') ? -161 : 5;
    const activityMultiplier =
        user.fitness_level === 'advanced'
            ? 1.7
            : user.fitness_level === 'intermediate'
            ? 1.5
            : 1.35;
    const goalAdjustment =
        user.goal === 'fat_loss'
            ? -400
            : user.goal === 'muscle_gain'
            ? 250
            : 0;

    const maintenanceCalories =
        ((10 * weight) + (6.25 * height) - (5 * age) + genderOffset) * activityMultiplier;
    const calories = Math.max(1400, Math.round(maintenanceCalories + goalAdjustment));
    const proteinPerKg =
        user.goal === 'muscle_gain'
            ? 2.2
            : user.goal === 'fat_loss'
            ? 2.0
            : 1.7;
    const protein = Math.max(80, Math.round(weight * proteinPerKg));
    const fats = Math.max(40, Math.round(weight * 0.8));
    const carbs = Math.max(100, Math.round((calories - (protein * 4) - (fats * 9)) / 4));

    return { calories, protein, carbs, fats };
};

exports.upgradeSubscription = async (req, res) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            console.error('Upgrade Error: userId missing from JWT payload. req.user =', req.user);
            return res.status(401).json({ error: 'Unauthorized: user ID not found in token' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { is_premium: true },
            { returnDocument: 'after' }
        ).select('-password_hash');

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'Successfully upgraded to Premium!',
            user: serializeUser(updatedUser)
        });

    } catch (error) {
        console.error('Subscription Upgrade Error:', error.name, error.message);
        res.status(500).json({ error: 'Server error during subscription upgrade', detail: error.message });
    }
};


exports.createWorkoutLog = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { focus, dur_min, exercises, at } = req.body;
        const WorkoutLog = require('../models/WorkoutLog.model');

        if (!focus || !Array.isArray(exercises) || exercises.length === 0) {
            return res.status(400).json({ error: 'Workout focus and exercises are required' });
        }

        const log = await WorkoutLog.create({
            user_id: userId,
            focus,
            dur_min: Math.max(1, Number(dur_min) || 0),
            exercises: exercises.filter(Boolean),
            at: at || null,
        });

        res.status(201).json({
            message: 'Workout saved successfully',
            log,
        });
    } catch (error) {
        console.error('Create Workout Log Error:', error);
        res.status(500).json({ error: 'Failed to save workout log' });
    }
};

exports.getWorkoutHistory = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const WorkoutLog = require('../models/WorkoutLog.model');
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const logs = await WorkoutLog.find({ user_id: userId, date: { $gte: thirtyDaysAgo } }).sort({ date: -1 });
        res.json({ logs });
    } catch (error) {
        console.error('Fetch Workout History Error:', error);
        res.status(500).json({ error: 'Failed to fetch workout history' });
    }
};


exports.getDietHistory = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const DietLog = require('../models/DietLog.model');
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const logs = await DietLog.find({ user_id: userId, date: { $gte: thirtyDaysAgo } }).sort({ date: -1 });
        // Remap slim fields back to readable names for frontend
        const readable = logs.map(log => ({
            date: log.date,
            total_calories: log.t_cal,
            total_protein: log.t_p,
            total_carbs: log.t_c,
            total_fats: log.t_f,
            items: log.items.map(i => ({ food_name: i.n, calories: i.cal, protein: i.p, carbs: i.c, fats: i.f, loggedAt: i.at, image_scanned: i.scanned }))
        }));
        res.json({ logs: readable });
    } catch (error) {
        console.error('Fetch Diet History Error:', error);
        res.status(500).json({ error: 'Failed to fetch diet history' });
    }
};

exports.getBehaviourSummary = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const DietLog = require('../models/DietLog.model');
        const WorkoutLog = require('../models/WorkoutLog.model');
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const [dietLogs, workoutLogs] = await Promise.all([
            DietLog.find({ user_id: userId, date: { $gte: sevenDaysAgo } }),
            WorkoutLog.find({ user_id: userId, date: { $gte: sevenDaysAgo } }).sort({ date: -1 }),
        ]);

        const avgCal = dietLogs.length ? Math.round(dietLogs.reduce((s, d) => s + (d.t_cal || 0), 0) / dietLogs.length) : 0;
        const avgProt = dietLogs.length ? Math.round(dietLogs.reduce((s, d) => s + (d.t_p || 0), 0) / dietLogs.length) : 0;
        const mealTimes = [...new Set(dietLogs.flatMap(d => d.items.map(i => i.at)).filter(Boolean))].slice(0, 5);
        const lastWorkout = workoutLogs[0];

        res.json({
            avg_calories_7d: avgCal,
            avg_protein_7d: avgProt,
            typical_meal_times: mealTimes,
            workout_days_7d: workoutLogs.length,
            last_workout_focus: lastWorkout?.focus || null,
            last_workout_duration_min: lastWorkout?.dur_min || null,
        });
    } catch (error) {
        console.error('Behaviour Summary Error:', error);
        res.status(500).json({ error: 'Failed to compute behaviour summary' });
    }
};

exports.getTodayDashboard = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const DietLog = require('../models/DietLog.model');
        const WorkoutLog = require('../models/WorkoutLog.model');
        const today = getTodayStart();

        const [user, dietLog, workoutLog] = await Promise.all([
            User.findById(userId),
            DietLog.findOne({ user_id: userId, date: { $gte: today } }).sort({ date: -1 }),
            WorkoutLog.exists({ user_id: userId, date: { $gte: today } })
        ]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const targets = calculateNutritionTargets(user);
        const consumed = {
            calories: dietLog?.t_cal || 0,
            protein: dietLog?.t_p || 0,
            carbs: dietLog?.t_c || 0,
            fats: dietLog?.t_f || 0,
        };
        const recentMeals = (dietLog?.items || [])
            .slice()
            .reverse()
            .slice(0, 3)
            .map((item) => ({
                food_name: item.n,
                calories: item.cal,
                protein: item.p,
                carbs: item.c,
                fats: item.f,
                loggedAt: item.at || null,
            }));

        res.json({
            consumed,
            targets,
            meals_logged: dietLog?.items?.length || 0,
            recent_meals: recentMeals,
            workout_completed_today: !!workoutLog,
            updated_at: dietLog?.updatedAt || null,
        });
    } catch (error) {
        console.error('Fetch Today Dashboard Error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
};


exports.getAffiliateProducts = async (req, res) => {
    try {
        const AffiliateProduct = require('../models/AffiliateProduct.model');
        const products = await AffiliateProduct.find({ is_active: true }).sort({ createdAt: -1 });
        
        // If the DB is empty, let's return some mocked fallbacks so the UI doesn't break
        if(products.length === 0) {
            return res.json({ products: [
                {
                    _id: "mock1",
                    name: "Optimum Nutrition Gold Standard 100% Whey",
                    category: "Supplements",
                    price_string: "$45.99",
                    rating: 4.8,
                    image_url: "https://images.unsplash.com/photo-1593095948071-474c5cc2989d?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60",
                    affiliate_link: "https://amazon.com"
                },
                {
                    _id: "mock2",
                    name: "Bowflex SelectTech 552 Adjustable Dumbbells",
                    category: "Equipment",
                    price_string: "$429.00",
                    rating: 4.9,
                    image_url: "https://images.unsplash.com/photo-1638202993928-7267aad84c31?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60",
                    affiliate_link: "https://amazon.com"
                }
            ]});
        }

        res.json({ products });
    } catch (error) {
        console.error('Fetch Affiliate Products Error:', error);
        res.status(500).json({ error: 'Failed to fetch affiliate products' });
    }
};
