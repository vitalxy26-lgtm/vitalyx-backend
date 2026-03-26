const fs = require('fs');

let f = fs.readFileSync('d:/AI Wrapper/ai-fitness-backend/src/controllers/ai.controller.js', 'utf8');

// 1. Replace Imports & Setup
f = f.replace(
    /const OpenAI = require\('openai'\);\s+const getOpenAIModel = \(\) => \{[\s\S]*?\n\}/,
    `const { GoogleGenerativeAI } = require('@google/generative-ai');\n\nconst getGeminiModel = () => {\n    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');\n    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);\n    return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });\n}`
);

// 2. Chat Coach
f = f.replace(
    /const openai = getOpenAIModel\(\);\s+let behaviourStr/g,
    `const model = getGeminiModel();\n        let behaviourStr`
);
f = f.replace(
    /const completion = await openai\.chat\.completions\.create\(\{[\s\S]*?\}\);\s+const responseText = completion\.choices\[0\]\?\.message\?\.content \|\| "Coach ran into an issue finding an answer\.";/m,
    `const result = await model.generateContent(systemPrompt + "\\n\\nUser Message: " + message);\n        const responseText = result.response.text() || "Coach ran into an issue finding an answer.";`
);


// 3. Scan Food Image (Multimodal)
f = f.replace(
    /const completion = await openai\.chat\.completions\.create\(\{[\s\S]*?model: 'gemini-1\.5-flash',[\s\S]*?stream: false\s+\}\);\s+let rawText = completion\.choices\[0\]\?\.message\?\.content \|\| "";/m,
    `const result = await model.generateContent([\n            prompt,\n            { inlineData: { data: imageBase64, mimeType } }\n        ]);\n        let rawText = result.response.text() || "";`
);

// 4. All other endpoints (generateWorkoutPlan, generateWeeklyPlan, generateMealPlan, lookupFoodByText, generateStoreRecommendations)
f = f.replace(/const openai = getOpenAIModel\(\);/g, 'const model = getGeminiModel();');

f = f.replace(/const completion = await openai\.chat\.completions\.create\(\{[\s\S]*?\}\);\s+let rawText = completion\.choices\[0\]\?\.message\?\.content \|\| "";/g, 
    `const result = await model.generateContent(prompt);\n        let rawText = result.response.text() || "";`
);


fs.writeFileSync('d:/AI Wrapper/ai-fitness-backend/src/controllers/ai.controller.js', f, 'utf8');
console.log('REWRITE COMPLETE');
