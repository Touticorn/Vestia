// ═══════════════════════════════════════════════════════════
// VESTIA GEMINI MIGRATION — REPLACEMENT FUNCTIONS
// Paste these into your Vestia.jsx, replacing the Claude equivalents
// ═══════════════════════════════════════════════════════════

// ─── CONFIG ───
const VESTIA_SYSTEM_PROMPT = `You are Vestia — an editorial AI personal stylist with the sensibility of a Vogue creative director and the practicality of a personal shopper.

Your voice is precise and evocative. You name colors specifically ("ochre," "slate," "ivory" not "brown," "grey," "white"). You understand color theory, fabric behavior, and occasion-appropriate dressing.

You always respond in the requested JSON format. No markdown, no explanations outside the JSON.`;

// ─── CORE AI CALLER (replaces your Claude fetch) ───
async function askGemini(prompt, systemPrompt = null, maxTokens = 1200) {
  haptic(5);

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      model: "gemini-2.0-flash",
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
    },
  };

  if (systemPrompt) {
    payload.systemInstruction = systemPrompt;
  }

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.detail || `Gemini API error ${res.status}`);
  }

  const data = await res.json();

  // Handle Gemini response structure
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("No response from Gemini");
  }

  // Check finish reasons
  if (candidate.finishReason === "SAFETY") {
    throw new Error("Response blocked by safety filter. Try a different prompt.");
  }
  if (candidate.finishReason === "RECITATION") {
    throw new Error("Response blocked due to copyright concern.");
  }
  if (candidate.finishReason === "MAX_TOKENS") {
    console.warn("Gemini response truncated — consider increasing maxOutputTokens");
  }

  const text = candidate.content.parts[0].text;

  // Clean markdown wrappers if present
  const cleanJson = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("Failed to parse Gemini response:", text);
    throw new Error("Invalid JSON from Gemini. Check the response format.");
  }
}

// ─── OUTFIT GENERATION (Today Tab) ───
async function generateOutfit() {
  if (wardrobe.length < 2) {
    toast("Add at least 2 wardrobe pieces first");
    return;
  }
  if (!weather) {
    toast("Waiting for weather data...");
    return;
  }

  setLoading(true);
  setSuggestion(null);
  setSdVideo(null);
  setSdError(null);

  try {
    const recentOutfits = history
      .slice(0, 7)
      .map(h => Object.values(h.outfit || {}).filter(Boolean).join(" + "))
      .join("\n");

    const prompt = `You are Vestia, a luxury personal stylist.

AVAILABLE WARDROBE:
${wardrobe.map(item => 
  `- ${item.name} (${item.categoryLabel}, worn ${item.wearCount}x${item.lastWorn ? ", last: " + item.lastWorn : ""})`
).join("\n")}

TODAY'S WEATHER:
- Temperature: ${weather.temp}°C (feels like ${weather.feel}°C)
- Conditions: ${weather.label}
- Humidity: ${weather.humidity}%
- Wind: ${weather.wind}km/h

RECENT OUTFITS (avoid repeating):
${recentOutfits || "None yet"}

TASK: Compose today's outfit. Consider:
1. Weather-appropriate fabrics and layers
2. Color harmony and contrast
3. Occasion versatility (work to evening)
4. Rotation principle — favor less-worn pieces
5. No exact repeats from recent history

Respond ONLY with this JSON structure:
{
  "mood": "Single evocative word",
  "occasion": "Primary occasion",
  "outfit": {
    "Outerwear": "item name or null",
    "Top": "item name or null", 
    "Bottom": "item name or null",
    "Footwear": "item name or null",
    "Accessory": "item name or null"
  },
  "styleScore": 0-100,
  "weatherScore": 0-100,
  "reasoning": "2-3 sentences of editorial commentary",
  "colorStory": "Color palette description",
  "tips": ["styling tip 1", "styling tip 2"]
}`;

    const result = await askGemini(prompt, VESTIA_SYSTEM_PROMPT, 1500);

    // Validate response structure
    if (!result.outfit || !result.mood) {
      throw new Error("Invalid response structure from Gemini");
    }

    setSuggestion(result);

    // Save to history
    const entry = {
      id: Date.now(),
      date: new Date().toISOString(),
      outfit: result.outfit,
      mood: result.mood,
      weather,
      reasoning: result.reasoning,
    };
    const newHistory = [entry, ...history];
    setHistory(newHistory);
    await dbSet("history", newHistory);

    // Update wear counts
    const updatedWardrobe = wardrobe.map(item => {
      const wornToday = Object.values(result.outfit || {}).includes(item.name);
      if (wornToday) {
        return {
          ...item,
          wearCount: (item.wearCount || 0) + 1,
          lastWorn: new Date().toLocaleDateString("en", { month: "short", day: "numeric" }),
        };
      }
      return item;
    });
    setWardrobe(updatedWardrobe);
    await dbSet("wardrobe", updatedWardrobe);

    toast("Outfit composed");
  } catch (err) {
    console.error(err);
    setSuggestion({ error: true, message: err.message });
    toast("Generation failed — " + err.message);
  } finally {
    setLoading(false);
  }
}

// ─── WEEKLY PLANNING (Week Tab) ───
async function generateWeekPlan() {
  if (wardrobe.length < 5) {
    toast("Add at least 5 pieces for weekly planning");
    return;
  }
  if (!weather?.week) {
    toast("Weather forecast unavailable");
    return;
  }

  setLoadingWeek(true);
  setWeekPlan(null);

  try {
    const prompt = `You are Vestia, a luxury personal stylist planning a cohesive week.

AVAILABLE WARDROBE:
${wardrobe.map(item => 
  `- ${item.name} (${item.categoryLabel}, worn ${item.wearCount}x)`
).join("\n")}

7-DAY WEATHER FORECAST:
${weather.week.slice(0, 7).map(d => 
  `- ${d.day}: High ${d.high}°C, Low ${d.low}°C, ${d.condition}`
).join("\n")}

RULES:
1. Plan Monday through Sunday
2. No single item worn more than twice
3. Match layers to daily weather
4. Create a cohesive narrative across the week
5. Each day needs a brief style note

Respond ONLY with this JSON:
{
  "days": [
    {
      "day": "Monday",
      "outfit": {
        "Outerwear": "item or null",
        "Top": "item or null",
        "Bottom": "item or null",
        "Footwear": "item or null",
        "Accessory": "item or null"
      },
      "note": "Brief editorial note for this day"
    }
  ],
  "philosophy": "Overarching style narrative for the week (2-3 sentences)"
}`;

    const result = await askGemini(prompt, VESTIA_SYSTEM_PROMPT, 2500);

    if (!result.days || result.days.length !== 7) {
      throw new Error("Invalid week plan structure");
    }

    setWeekPlan(result);
    await dbSet("weekPlan", result);
    toast("Week planned");
  } catch (err) {
    console.error(err);
    toast("Week planning failed — " + err.message);
  } finally {
    setLoadingWeek(false);
  }
}

// ─── WARDROBE CATEGORIZATION (when user uploads photo) ───
// Gemini 2.0 Flash has vision capabilities — you can send the image directly!
// This is a NEW feature you didn't have with Claude text-only

async function categorizeClothingWithVision(imageBase64, fileName) {
  const prompt = `Analyze this clothing item photo and categorize it.

Respond ONLY with JSON:
{
  "name": "Descriptive name (e.g., 'Navy Wool Overcoat')",
  "category": "One of: Outerwear, Tops, Bottoms, Footwear, Accessories",
  "color": "Specific color name",
  "material": "Fabric if visible (e.g., wool, cotton, leather)",
  "season": "spring/summer/fall/winter/all",
  "formality": "casual/smart-casual/formal",
  "notes": "Any notable details"
}`;

  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64,
          },
        },
      ],
    }],
    generationConfig: {
      model: "gemini-2.0-flash",
      maxOutputTokens: 800,
      responseMimeType: "application/json",
      temperature: 0.3, // Lower temp for categorization
    },
  };

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("Vision analysis failed");

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("No vision response");

  const text = candidate.content.parts[0].text;
  const cleanJson = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleanJson);
}

// NOTE: To use vision, your handleClothingUpload function needs to convert
// the File to base64 before calling categorizeClothingWithVision.
// Example:
// const base64 = await new Promise((resolve) => {
//   const reader = new FileReader();
//   reader.onloadend = () => resolve(reader.result.split(',')[1]);
//   reader.readAsDataURL(file);
// });
