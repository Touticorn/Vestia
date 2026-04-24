import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════
// VESTIA — Complete Component with Gemini Migration
// Replaces Claude with Google Gemini 2.0 Flash
// Keeps fal.ai/Seedance for video generation
// ═══════════════════════════════════════════════════════════

const CATS = ["Outerwear", "Tops", "Bottoms", "Footwear", "Accessories"];
const TODAY_ISSUE = new Date().toLocaleDateString("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const VESTIA_SYSTEM_PROMPT = `You are Vestia — an editorial AI personal stylist with the sensibility of a Vogue creative director and the practicality of a personal shopper.

Your voice is precise and evocative. You name colors specifically ("ochre," "slate," "ivory" not "brown," "grey," "white"). You understand color theory, fabric behavior, and occasion-appropriate dressing.

You always respond in the requested JSON format. No markdown, no explanations outside the JSON.`;

// ═══════════════════════════════════════════════════════════
// INDEXEDDB HELPERS
// ═══════════════════════════════════════════════════════════
const DB_NAME = "vestia-db";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("store")) {
        db.createObjectStore("store");
      }
    };
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("store", "readonly");
    const store = tx.objectStore("store");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("store", "readwrite");
    const store = tx.objectStore("store");
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("store", "readwrite");
    const store = tx.objectStore("store");
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function haptic(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

async function compressImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════
// WEATHER API (Open-Meteo — free, no key)
// ═══════════════════════════════════════════════════════════
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}¤t=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();

  const codeMap = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Rain showers", 81: "Moderate showers", 82: "Violent showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
  };

  const current = data.current;
  const daily = data.daily;

  return {
    temp: Math.round(current.temperature_2m),
    feel: Math.round(current.apparent_temperature),
    humidity: current.relative_humidity_2m,
    wind: Math.round(current.wind_speed_10m),
    label: codeMap[current.weather_code] || "Unknown",
    week: daily.time.slice(0, 7).map((t, i) => ({
      day: new Date(t).toLocaleDateString("en", { weekday: "short" }),
      high: Math.round(daily.temperature_2m_max[i]),
      low: Math.round(daily.temperature_2m_min[i]),
      condition: codeMap[daily.weather_code[i]] || "Unknown",
    })),
  };
}

// ═══════════════════════════════════════════════════════════
// GEMINI API CALLER (replaces Claude)
// ═══════════════════════════════════════════════════════════
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
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("No response from Gemini");
  }
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

// ═══════════════════════════════════════════════════════════
// VISION: AUTO-CATEGORIZE CLOTHING FROM PHOTO
// ═══════════════════════════════════════════════════════════
async function categorizeWithGeminiVision(imageBase64, originalName) {
  const prompt = `You are a luxury fashion cataloguer. Analyze this clothing item photograph.

Provide a structured analysis. Respond ONLY with valid JSON:
{
  "name": "Specific, evocative name (e.g., 'Charcoal Cashmere Turtleneck'). Do not use generic names.",
  "category": "Exact one of: Outerwear, Tops, Bottoms, Footwear, Accessories",
  "color": "Precise color name using fashion terminology (e.g., 'slate grey', 'burgundy', 'ivory')",
  "material": "Primary fabric if discernible (e.g., merino wool, selvedge denim, full-grain leather). 'Unknown' if unclear.",
  "season": "spring, summer, fall, winter, or all",
  "formality": "casual, smart-casual, business, or formal",
  "notes": "1-2 sentences describing cut, fit, distinctive details, or styling potential"
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
      maxOutputTokens: 600,
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  };

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Vision analysis failed");
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("No vision response");
  if (candidate.finishReason === "SAFETY") {
    return fallbackCategorize(originalName);
  }

  const text = candidate.content.parts[0].text;
  const cleanJson = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(cleanJson);
  } catch (e) {
    return fallbackCategorize(originalName);
  }
}

function fallbackCategorize(fileName) {
  const name = fileName.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
  const lower = name.toLowerCase();

  let category = "Tops";
  if (/coat|jacket|blazer|parka|bomber|trench|overcoat/i.test(lower)) category = "Outerwear";
  else if (/jean|pant|trouser|short|skirt|chino|slack/i.test(lower)) category = "Bottoms";
  else if (/shoe|boot|sneaker|loafer|heel|sandal|oxford/i.test(lower)) category = "Footwear";
  else if (/watch|belt|bag|scarf|hat|tie|jewelry|sunglass|glove/i.test(lower)) category = "Accessories";

  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    category,
    color: "Unknown",
    material: "Unknown",
    season: "all",
    formality: "casual",
    notes: "Auto-categorized from filename",
  };
}

// ═══════════════════════════════════════════════════════════
// SEEDANCE VIDEO GENERATION (unchanged — uses fal.ai)
// ═══════════════════════════════════════════════════════════
async function generateSeedanceVideo(suggestion, userPhoto, wardrobe) {
  const outfitDesc = Object.entries(suggestion.outfit || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const prompt = `A cinematic fashion portrait of a person wearing ${outfitDesc}. ${suggestion.mood} aesthetic. Editorial lighting, shallow depth of field, luxury fashion photography style. The person stands confidently, full body visible, against a minimal background.`;

  const res = await fetch("/api/fal/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-fal-target-url": "https://110602490-seedance-lite.fal.run",
    },
    body: JSON.stringify({
      prompt,
      image_url: userPhoto,
      duration: 5,
      aspect_ratio: "9:16",
      resolution: "720p",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Video generation failed");
  }

  const data = await res.json();
  return data.video?.url || data.url;
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function Vestia() {
  // ─── State ───
  const [tab, setTab] = useState("today");
  const [onboarded, setOnboarded] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);
  const [wardrobe, setWardrobe] = useState([]);
  const [activeCat, setActiveCat] = useState("Outerwear");
  const [selectedItem, setSelectedItem] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [weather, setWeather] = useState(null);
  const [locationName, setLocationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [weekPlan, setWeekPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [userPhoto, setUserPhoto] = useState(null);
  const [sdVideo, setSdVideo] = useState(null);
  const [sdError, setSdError] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);

  // ─── Toast ───
  const toast = useCallback((msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  }, []);

  // ─── Load from IndexedDB ───
  useEffect(() => {
    (async () => {
      const [w, h, wp, up, ob] = await Promise.all([
        dbGet("wardrobe"),
        dbGet("history"),
        dbGet("weekPlan"),
        dbGet("userPhoto"),
        dbGet("onboarded"),
      ]);
      if (w) setWardrobe(w);
      if (h) setHistory(h);
      if (wp) setWeekPlan(wp);
      if (up) setUserPhoto(up);
      if (ob) setOnboarded(true);
    })();
  }, []);

  // ─── Weather ───
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const w = await fetchWeather(latitude, longitude);
          setWeather(w);
          // Reverse geocode for location name
          const geoRes = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
          );
          const geo = await geoRes.json();
          setLocationName(geo.city || geo.locality || "Local");
        } catch (e) {
          console.error("Weather fetch failed", e);
        }
      },
      (err) => console.error("Geolocation denied", err)
    );
  }, []);

  // ─── PWA Install Prompt ───
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // ─── Onboarding ───
  const steps = [
    {
      eyebrow: "Welcome",
      title: "Your wardrobe, elevated.",
      body: "Vestia composes outfits from what you own. No shopping. No trends. Just intelligent styling.",
    },
    {
      eyebrow: "How it works",
      title: "Photograph your pieces.",
      body: "Upload your clothing by category. Vestia remembers every item, tracks how often you wear it, and never repeats a look too soon.",
    },
    {
      eyebrow: "The result",
      title: "Editorial intelligence.",
      body: "Each day, Vestia considers the weather, your rotation, and color theory to compose a look — with reasoning you can read.",
    },
  ];

  function finishOnboarding() {
    setOnboarded(true);
    dbSet("onboarded", true);
    haptic(30);
  }

  // ─── Wardrobe Upload ───
  async function handleClothingUpload(files) {
    if (!files || files.length === 0) return;
    setUploading(true);

    try {
      for (const file of files) {
        const compressed = await compressImage(file, 1200, 0.85);
        const base64 = await fileToBase64(compressed);

        // Try Gemini Vision auto-categorization
        let categoryData;
        try {
          categoryData = await categorizeWithGeminiVision(base64, file.name);
        } catch (e) {
          console.warn("Vision failed, using fallback:", e);
          categoryData = fallbackCategorize(file.name);
        }

        const newItem = {
          id: Date.now() + Math.random(),
          name: categoryData.name || file.name.replace(/\.[^/.]+$/, ""),
          categoryLabel: categoryData.category || activeCat,
          color: categoryData.color || "Unknown",
          material: categoryData.material || "Unknown",
          season: categoryData.season || "all",
          formality: categoryData.formality || "casual",
          notes: categoryData.notes || "",
          photo: URL.createObjectURL(compressed),
          wearCount: 0,
          lastWorn: null,
          dateAdded: new Date().toISOString(),
        };

        const updated = [...wardrobe, newItem];
        setWardrobe(updated);
        await dbSet("wardrobe", updated);
        toast(`Added: ${newItem.name}`);
        haptic(20);
      }
    } catch (err) {
      console.error("Upload failed:", err);
      toast("Upload failed — " + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ─── User Profile Photo ───
  async function handleUserPhoto(file) {
    if (!file) return;
    try {
      const compressed = await compressImage(file, 800, 0.9);
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result;
        setUserPhoto(dataUrl);
        await dbSet("userPhoto", dataUrl);
        toast("Profile photo updated");
        haptic(20);
      };
      reader.readAsDataURL(compressed);
    } catch (err) {
      toast("Photo upload failed");
    }
  }

  // ─── Outfit Generation (Today Tab) — GEMINI ───
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
        .map((h) => Object.values(h.outfit || {}).filter(Boolean).join(" + "))
        .join("\n");

      const prompt = `You are Vestia, a luxury personal stylist.

AVAILABLE WARDROBE:
${wardrobe
  .map(
    (item) =>
      `- ${item.name} (${item.categoryLabel}, worn ${item.wearCount}x${
        item.lastWorn ? ", last: " + item.lastWorn : ""
      })`
  )
  .join("\n")}

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
      const updatedWardrobe = wardrobe.map((item) => {
        const wornToday = Object.values(result.outfit || {}).includes(item
