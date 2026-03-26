const { GoogleGenerativeAI } = require('@google/generative-ai');

const getGeminiModel = () => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

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

        const completion = await openai.chat.completions.create({
            model: "gemini-1.5-flash",
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            max_tokens: 2000,
        });

        let rawText = completion.choices[0]?.message?.content || '';
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
