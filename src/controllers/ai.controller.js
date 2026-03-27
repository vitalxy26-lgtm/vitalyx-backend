const { GoogleGenerativeAI } = require('@google/generative-ai');

const getGeminiModel = () => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
};

// Robustly extract JSON from AI response even if it has surrounding text
const extractJSON = (text) => {
    try { return JSON.parse(text.trim()); } catch (_) { }
    const stripped = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try { return JSON.parse(stripped); } catch (_) { }
    const objMatch = stripped.match(/(\{[\s\S]*\})/);
    if (objMatch) { try { return JSON.parse(objMatch[1]); } catch (_) { } }
    const arrMatch = stripped.match(/(\[[\s\S]*\])/);
    if (arrMatch) { try { return JSON.parse(arrMatch[1]); } catch (_) { } }
    throw new SyntaxError(`Could not extract JSON from AI response: ${text.substring(0, 120)}`);
};

// Helper: compute 7-day behaviour summary without extra DB writes
const getBehaviourContext = async (userId) => {
    try {
        const DietLog = require('../models/DietLog.model');
        const WorkoutLog = require('../models/WorkoutLog.model');
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const [dietLogs, workoutLogs] = await Promise.all([
            DietLog.find({ user_id: userId, date: { $gte: sevenDaysAgo } }),
            WorkoutLog.find({ user_id: userId, date: { $gte: sevenDaysAgo } }),
        ]);

        const avgCal = dietLogs.length
            ? Math.round(dietLogs.reduce((s, d) => s + (d.t_cal || 0), 0) / dietLogs.length)
            : null;
        const avgProt = dietLogs.length
            ? Math.round(dietLogs.reduce((s, d) => s + (d.t_p || 0), 0) / dietLogs.length)
            : null;

        const mealTimes = dietLogs.flatMap(d => d.items.map(i => i.at)).filter(Boolean);
        const uniqueTimes = [...new Set(mealTimes)].slice(0, 5);

        const lastWorkout = workoutLogs.sort((a, b) => b.date - a.date)[0];

        return {
            avg_calories_7d: avgCal,
            avg_protein_7d: avgProt,
            typical_meal_times: uniqueTimes,
            workout_days_7d: workoutLogs.length,
            last_workout_focus: lastWorkout?.focus || null,
            last_workout_duration_min: lastWorkout?.dur_min || null,
        };
    } catch (e) {
        return null;
    }
};

// ── AI Coach Chat ───────────────────────────────────────────────────────────
exports.chatCoach = async (req, res) => {
    try {
        const { message, context } = req.body;
        const userId = req.user?.userId;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const model = getGeminiModel();

        let behaviourStr = '';
        if (userId) {
            const behaviour = await getBehaviourContext(userId);
            if (behaviour) {
                behaviourStr = `\nUser Behaviour (last 7 days): avg ${behaviour.avg_calories_7d || '?'} kcal/day, avg ${behaviour.avg_protein_7d || '?'}g protein. Typical meal times: ${behaviour.typical_meal_times.join(', ') || 'unknown'}. Worked out ${behaviour.workout_days_7d} days. Last focus: ${behaviour.last_workout_focus || 'N/A'} (${behaviour.last_workout_duration_min || '?'} min).`;
            }
        }

        const systemPrompt = `You are an expert AI fitness and nutrition coach. 
        Your tone should be motivational, concise, and professional.
        If the user asks for workouts, provide actionable steps.
        If they ask about diet, provide healthy, macro-aware suggestions.
        User Profile: ${context ? JSON.stringify(context) : 'No specific context provided'}${behaviourStr}`;

        const result = await model.generateContent(systemPrompt + "\n\nUser Message: " + message);
        const responseText = result.response.text() || "Coach ran into an issue finding an answer.";
        res.json({ reply: responseText });
    } catch (error) {
        console.error('AI Coach Error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate response' });
    }
};

// ── Generate Workout Plan ───────────────────────────────────────────────────
exports.generateWorkoutPlan = async (req, res) => {
    try {
        const { goal, fitness_level, equipment, days, target_weight, target_timeframe_weeks } = req.body;

        const model = getGeminiModel();

        const prompt = `Generate a structured ${days || 3}-day workout plan for someone with the following profile:
        Goal: ${goal}
        Fitness Level: ${fitness_level}
        Equipment: ${equipment || 'home_no_equipment'}
        Target Weight: ${target_weight ? target_weight + ' kg' : 'Not specified'}
        Timeframe: ${target_timeframe_weeks ? target_timeframe_weeks + ' weeks' : 'Not specified'}

        REQUIREMENTS:
        - Total workout duration per day must be approximately 60 minutes
        - Exercise counts and duration_seconds should be realistic according to the user's fitness level
        - Exercise reps should be realistic according to the user's fitness level
        - Each day must have a minimum of 3 exercises (ideally 5-7)
        - Assign realistic duration_seconds per exercise set (60-120s typical)
        - Assign realistic rest_seconds between exercises (30-90s)

        Return ONLY a stringified JSON array. No markdown, no backticks.
        Use this exact structure:
        [
            {
              "day": "Day 1",
              "focus": "Upper Body Strength",
              "exercises": [
                 { "name": "Pushups", "sets": 3, "reps": "12-15", "dur_s": 90, "rest_s": 60, "tip": "Keep core tight" }
                 ]
            }
        ]`;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text() || "";
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        const plan = extractJSON(rawText);
        res.json({ plan });

    } catch (error) {
        console.error('Workout Generation Error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate workout plan' });
    }
};

// ── Generate Weekly Plan ────────────────────────────────────────────────────
exports.generateWeeklyPlan = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { goal, fitness_level, equipment, custom_request, duration_minutes } = req.body;
        const durationMinutes =
            Number.isFinite(Number(duration_minutes)) && Number(duration_minutes) > 0
                ? Number(duration_minutes)
                : 60;
        const customRequest = custom_request?.trim();

        const model = getGeminiModel();

        const splitHint = goal === 'muscle_gain'
            ? 'Monday=Chest, Tuesday=Back, Wednesday=Shoulders, Thursday=Arms (Biceps+Triceps), Friday=Abs/Core, Saturday=Legs'
            : goal === 'fat_loss'
                ? 'Monday=Full Body HIIT, Tuesday=Upper Body, Wednesday=Core/Abs, Thursday=Lower Body, Friday=Full Body Cardio, Saturday=Active Recovery/Stretching'
                : 'Monday=Chest, Tuesday=Abs/Core, Wednesday=Back, Thursday=Shoulders, Friday=Arms, Saturday=Legs';

        const prompt = `Generate a full 6-day weekly workout plan for someone with:
        Goal: ${goal || 'maintain_weight'}
        Fitness Level: ${fitness_level || 'intermediate'}
        Equipment: ${equipment || 'home_no_equipment'}
        Target workout duration per day: approximately ${durationMinutes} minutes
        Additional user instructions: ${customRequest || 'None'}

        Use this muscle group split: ${splitHint}
        Sunday is a rest day, do not include it.

        REQUIREMENTS:
        - Each day must have minimum 4 exercises
        - Total workout duration should stay close to ${durationMinutes} minutes per day
        - Assign dur_s (duration per set in seconds, e.g. 90)
        - Assign rest_s (rest timer in seconds between exercises, e.g. 45-90)
        - Tailor exercises to the equipment available
        - Respect the additional user instructions whenever they are safe and realistic

        Return ONLY a stringified JSON array. No markdown, no backticks.
        Use this exact structure:
        [
          {
            "day": "Monday",
            "muscle_group": "Chest",
            "focus": "Push Strength",
            "exercises": [
              { "name": "Pushups", "sets": 3, "reps": "12-15", "dur_s": 90, "rest_s": 60, "tip": "Keep core tight" }
            ]
          }
        ]`;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text() || "";
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        const days = extractJSON(rawText);

        const WeeklyPlan = require('../models/WeeklyPlan.model');
        const plan = await WeeklyPlan.findOneAndUpdate(
            { user_id: userId },
            {
                user_id: userId,
                generated_at: new Date(),
                duration_minutes: durationMinutes,
                custom_request: customRequest || '',
                days,
            },
            { upsert: true, returnDocument: 'after' }
        );

        res.json({ plan });

    } catch (error) {
        console.error('Weekly Plan Error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate weekly plan' });
    }
};

// ── Get Weekly Plan ─────────────────────────────────────────────────────────
exports.getWeeklyPlan = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const WeeklyPlan = require('../models/WeeklyPlan.model');
        const plan = await WeeklyPlan.findOne({ user_id: userId });
        res.json({ plan: plan || null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch weekly plan' });
    }
};

// ── Generate Meal Plan ──────────────────────────────────────────────────────
exports.generateMealPlan = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { targetCalories, diet_preference } = req.body;

        const model = getGeminiModel();

        const User = require('../models/User.model');
        const user = userId ? await User.findById(userId) : null;

        const weight = user?.weight || 70;
        const goal = user?.goal || 'maintain_weight';
        const fitnessLevel = user?.fitness_level || 'intermediate';
        const equipment = user?.equipment || 'home_no_equipment';

        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = days[new Date().getDay()];
        const randomSeed = Math.floor(Math.random() * 1000);

        const comboGuide = {
            'fat_loss|gym': {
                macros: `Protein: ${Math.round(weight * 2.2)}g (very high). Carbs: ${Math.round(weight * 2)}g. Fats: ${Math.round(weight * 0.7)}g.`,
                meals: 'Post-workout: protein shake. Other meals: grilled chicken, fish, egg whites, Greek yogurt, salads. Avoid: fried foods, sweets.',
                style: 'The user lifts heavy at the gym while cutting.',
            },
            'fat_loss|home_with_equipment': {
                macros: `Protein: ${Math.round(weight * 2)}g. Carbs: ${Math.round(weight * 1.8)}g. Fats: ${Math.round(weight * 0.7)}g.`,
                meals: 'High-volume: boiled eggs, grilled chicken, moong dal, veggie soup, cucumber raita, oats, sprout salad, roti.',
                style: 'The user trains at home with dumbbells/bands — deficit-focused diet.',
            },
            'fat_loss|home_no_equipment': {
                macros: `Protein: ${Math.round(weight * 1.8)}g. Carbs: ${Math.round(weight * 1.5)}g. Fats: ${Math.round(weight * 0.6)}g.`,
                meals: 'Light, filling: poha with peanuts, boiled egg salad, dal-roti, steamed veggies, buttermilk, makhana.',
                style: 'The user does bodyweight workouts at home.',
            },
            'muscle_gain|gym': {
                macros: `Protein: ${Math.round(weight * 2.4)}g. Carbs: ${Math.round(weight * 4)}g. Fats: ${Math.round(weight * 1)}g.`,
                meals: 'Calorie-dense: chicken breast, eggs, paneer, rajma-rice, oats, sweet potato, peanut butter toast, banana shake.',
                style: 'The user trains heavy at the gym for muscle growth.',
            },
            'muscle_gain|home_with_equipment': {
                macros: `Protein: ${Math.round(weight * 2.2)}g. Carbs: ${Math.round(weight * 3.5)}g. Fats: ${Math.round(weight * 0.9)}g.`,
                meals: 'Moderate surplus: eggs, chicken, dal-chawal, curd-rice, oat smoothies, chana, sprouts.',
                style: 'The user trains with home equipment for lean gains.',
            },
            'muscle_gain|home_no_equipment': {
                macros: `Protein: ${Math.round(weight * 2)}g. Carbs: ${Math.round(weight * 3)}g. Fats: ${Math.round(weight * 0.8)}g.`,
                meals: 'Lean surplus: dal, rajma, chole, eggs, milk, curd, roti, banana, sattu drink, soaked almonds.',
                style: 'The user does bodyweight training at home.',
            },
            'maintain_weight|gym': {
                macros: `Protein: ${Math.round(weight * 1.8)}g. Carbs: ${Math.round(weight * 3)}g. Fats: ${Math.round(weight * 0.9)}g.`,
                meals: 'Balanced meals: grilled chicken, fish, dal, brown rice, roti, seasonal vegetables, curd, fruit.',
                style: 'The user lifts at the gym and wants to maintain weight.',
            },
            'maintain_weight|home_with_equipment': {
                macros: `Protein: ${Math.round(weight * 1.7)}g. Carbs: ${Math.round(weight * 2.8)}g. Fats: ${Math.round(weight * 0.8)}g.`,
                meals: 'Balanced home meals: eggs, dal-roti, sabzi, curd-rice, fruit, grilled paneer.',
                style: 'The user trains at home with equipment for general fitness.',
            },
            'maintain_weight|home_no_equipment': {
                macros: `Protein: ${Math.round(weight * 1.6)}g. Carbs: ${Math.round(weight * 2.5)}g. Fats: ${Math.round(weight * 0.8)}g.`,
                meals: 'Simple balanced meals: idli-sambar, roti-sabzi, dal-rice, boiled eggs, fruits, buttermilk, nuts.',
                style: 'The user does light bodyweight exercises at home.',
            },
        };

        const key = `${goal}|${equipment}`;
        const guide = comboGuide[key] || comboGuide['maintain_weight|home_no_equipment'];

        const levelNote = fitnessLevel === 'advanced'
            ? 'Advanced athlete — increase portion sizes.'
            : fitnessLevel === 'beginner'
                ? 'Beginner — keep meals simple.'
                : 'Intermediate — standard portions.';

        const dietRules = {
            'vegetarian': 'STRICTLY VEGETARIAN: No meat, no fish, no eggs. Use paneer, tofu, dal, rajma, chole, soy chunks, milk, curd.',
            'vegan': 'STRICTLY VEGAN: No animal products. Use tofu, tempeh, soy milk, lentils, chickpeas, peanut butter, quinoa, seeds, nuts.',
            'non_vegetarian': 'Non-vegetarian: Use chicken breast, fish, eggs, turkey, lean mutton as primary protein.',
        };
        const dietRule = dietRules[diet_preference] || dietRules['non_vegetarian'];

        const cals = targetCalories || 2000;
        const needsExtraMeals = cals >= 2500 || goal === 'muscle_gain';
        const mealCountNote = needsExtraMeals
            ? `The calorie target is high (${cals} kcal). Generate 5-6 meals.`
            : `Generate 4 meals: breakfast, lunch, dinner, and 1-2 snacks.`;

        const extraMealsExample = needsExtraMeals
            ? '"extra_meals": [{ "label": "Mid-Morning", "name": "Dish", "calories": 250, "protein": 15, "carbs": 30, "fats": 8 }],'
            : '"extra_meals": [],';

        const prompt = `You are an elite Indian sports nutritionist creating a ${today}'s meal plan using AFFORDABLE, everyday Indian foods.

USER PROFILE:
- Weight: ${weight} kg
- Goal: ${goal.replace(/_/g, ' ')}
- Fitness Level: ${fitnessLevel} (${levelNote})
- Diet Preference: ${diet_preference || 'non_vegetarian'}
- Daily Calorie Target: ${cals} kcal
- Training Style: ${guide.style}

DIET RULES (MUST FOLLOW):
${dietRule}

MACRO TARGETS:
${guide.macros}

FOOD GUIDANCE:
${guide.meals}

MEAL COUNT:
${mealCountNote}

AFFORDABILITY RULES (CRITICAL):
1. Use ONLY affordable, everyday Indian kitchen ingredients.
2. For each meal, provide 2-3 ALTERNATIVES.

STRICT RULES:
1. Every meal MUST use affordable Indian home-cooked food.
2. All calorie and macro values must be realistic NUMBERS.
3. Total calories across ALL meals should closely match ${cals}.
4. Variety seed: ${randomSeed}
5. RESPECT THE DIET PREFERENCE.

Return ONLY a JSON object, no markdown, no backticks:
{
  "breakfast": { "name": "Dish Name", "calories": 400, "protein": 25, "carbs": 45, "fats": 10, "alternatives": ["Alt 1", "Alt 2"] },
  "lunch": { "name": "Dish Name", "calories": 550, "protein": 35, "carbs": 50, "fats": 15, "alternatives": ["Alt 1", "Alt 2"] },
  "dinner": { "name": "Dish Name", "calories": 500, "protein": 30, "carbs": 40, "fats": 12, "alternatives": ["Alt 1", "Alt 2"] },
  "snacks": [{ "name": "Snack Name", "calories": 150, "protein": 10, "carbs": 15, "fats": 5, "alternatives": ["Alt 1", "Alt 2"] }],
  ${extraMealsExample}
  "total_calories": ${cals},
  "total_protein": 120,
  "total_carbs": 180,
  "total_fats": 50
}`;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text() || "";
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        const plan = extractJSON(rawText);
        res.json({ plan });

    } catch (error) {
        console.error('Meal Plan Error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate meal plan' });
    }
};

// ── Scan Food Image (Multimodal — Gemini Vision) ────────────────────────────
exports.scanFoodImage = async (req, res) => {
    try {
        const { imageBase64, mimeType } = req.body;

        if (!imageBase64 || !mimeType) {
            return res.status(400).json({ error: 'Image data and mimeType are required' });
        }

        const model = getGeminiModel();

        const prompt = `Identify the food in this image. 
        Provide an estimated calorie count and macronutrient breakdown per standard serving.
        
        Return ONLY a stringified JSON object. Do not include markdown formatting.
        {
          "food_name": "String name of the food",
          "confidence_score": "Percentage string",
          "calories": number,
          "protein": number,
          "carbs": number,
          "fats": number,
          "unit": "100g"
        }`;

        const result = await model.generateContent([
            prompt,
            { inlineData: { data: imageBase64, mimeType } }
        ]);
        let rawText = result.response.text() || "";
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        const data = extractJSON(rawText);
        res.json({ data });

    } catch (error) {
        console.error('Food Scan Error:', error);
        res.status(500).json({ error: error.message || 'Failed to analyze food image' });
    }
};

// ── Lookup Food by Text Name ────────────────────────────────────────────────
exports.lookupFoodByText = async (req, res) => {
    try {
        const { foodName } = req.body;

        if (!foodName || !foodName.trim()) {
            return res.status(400).json({ error: 'Food name is required' });
        }

        const model = getGeminiModel();

        const prompt = `You are a nutrition database. The user wants to know the macros of: "${foodName.trim()}"

Estimate the calorie count and macronutrient breakdown per 100g serving of this food.
If the food name is ambiguous, pick the most common interpretation.
If it is a cooked Indian dish, estimate for a standard home-cooked serving.

Return ONLY a JSON object. No markdown, no backticks:
{
  "food_name": "Recognized food name",
  "confidence_score": "85%",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "unit": "100g"
}`;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text() || "";
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        const data = extractJSON(rawText);
        res.json({ data });

    } catch (error) {
        console.error('Food Lookup Error:', error);
        res.status(500).json({ error: error.message || 'Failed to look up food' });
    }
};

// ── Log Meal ────────────────────────────────────────────────────────────────
exports.logMeal = async (req, res) => {
    try {
        const { food_name, base_calories, base_protein, base_carbs, base_fats, quantity, loggedAt } = req.body;
        const userId = req.user?.userId;

        const qty = parseFloat(quantity) || 1;
        const m = {
            calories: Math.round(base_calories * qty),
            protein: Math.round(base_protein * qty * 10) / 10,
            carbs: Math.round(base_carbs * qty * 10) / 10,
            fats: Math.round(base_fats * qty * 10) / 10,
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const DietLog = require('../models/DietLog.model');

        let dietLog = await DietLog.findOne({
            user_id: userId,
            date: { $gte: today }
        });

        if (!dietLog) {
            dietLog = new DietLog({
                user_id: userId,
                date: new Date(),
                items: [],
                t_cal: 0, t_p: 0, t_c: 0, t_f: 0
            });
        }

        const newItem = {
            n: food_name,
            cal: m.calories,
            p: m.protein,
            c: m.carbs,
            f: m.fats,
            scanned: true,
            at: loggedAt
        };

        dietLog.items.push(newItem);
        dietLog.t_cal += m.calories;
        dietLog.t_p += m.protein;
        dietLog.t_c += m.carbs;
        dietLog.t_f += m.fats;

        await dietLog.save();

        res.json({
            message: 'Meal logged successfully', log: {
                food_name, calories: m.calories, protein: m.protein,
                carbs: m.carbs, fats: m.fats, image_scanned: true, loggedAt
            }
        });
    } catch (error) {
        console.error('Log Meal Error:', error);
        res.status(500).json({ error: error.message || 'Failed to log meal' });
    }
};

// ── AI Store Recommendations ────────────────────────────────────────────────
exports.generateStoreRecommendations = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { goal, equipment, diet_preference, fitness_level, recent_focus } = req.body;

        const model = getGeminiModel();

        const prompt = `You are a sports nutrition and fitness equipment expert.
A user has the following profile:
- Goal: ${goal || 'maintain_weight'}
- Fitness Level: ${fitness_level || 'intermediate'}
- Equipment: ${equipment || 'home_no_equipment'}
- Diet Preference: ${diet_preference || 'non_vegetarian'}
- Recent Workout Focus: ${recent_focus || 'general fitness'}

Recommend exactly 6 real, widely-available fitness or nutrition products tailored to this user's needs.
Choose a smart mix: 2-3 supplements/nutrition items, 2-3 equipment/gear items.

Return ONLY a JSON array, no markdown, no extra text:
[
  {
    "name": "Exact real product name",
    "brand": "Brand name",
    "category": "Supplements | Equipment | Nutrition | Apparel | Recovery",
    "why": "One sentence: why this product suits this user",
    "price_range": "₹500–₹2000",
    "rating": 4.5,
    "search_query": "amazon search query string for this product"
  }
]

IMPORTANT:
- Use Indian Rupee (₹) for price ranges
- Products must be real (e.g. MuscleBlaze Whey, Boldfit Dumbbells, etc.)
- Tailor to Indian market availability`;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text() || '';
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const products = extractJSON(rawText);

        const affiliateTag = process.env.AMAZON_AFFILIATE_TAG || '';
        const tagParam = affiliateTag ? `&tag=${affiliateTag}` : '';

        const enriched = products.map((p, i) => ({
            ...p,
            id: i + 1,
            link: `https://www.amazon.in/s?k=${encodeURIComponent(p.search_query || p.name)}${tagParam}`,
        }));

        res.json({ products: enriched });

    } catch (error) {
        console.error('Store Recommendations Error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate store recommendations' });
    }
};
