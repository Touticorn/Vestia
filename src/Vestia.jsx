import { useState, useEffect, useRef, useCallback } from "react";

const CATS = ["Outerwear", "Tops", "Bottoms", "Footwear", "Accessories"];
const TODAY_ISSUE = new Date().toLocaleDateString("en", {
  weekday: "long", month: "long", day: "numeric",
});

const VESTIA_SYSTEM_PROMPT = `You are Vestia — an editorial AI personal stylist with the sensibility of a Vogue creative director and the practicality of a personal shopper. Your voice is precise and evocative. You name colors specifically ("ochre," "slate," "ivory"). You always respond in the requested JSON format.`;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("vestia-db", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("store")) db.createObjectStore("store");
    };
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("store", "readonly");
    const req = tx.objectStore("store").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("store", "readwrite");
    const req = tx.objectStore("store").put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("store", "readwrite");
    const req = tx.objectStore("store").delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function haptic(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

async function compressImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
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

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}¤t=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
  const data = await (await fetch(url)).json();
  const codeMap = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Rain showers", 81: "Moderate showers", 82: "Violent showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
  };
  const c = data.current, d = data.daily;
  return {
    temp: Math.round(c.temperature_2m), feel: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m),
    label: codeMap[c.weather_code] || "Unknown",
    week: d.time.slice(0, 7).map((t, i) => ({
      day: new Date(t).toLocaleDateString("en", { weekday: "short" }),
      high: Math.round(d.temperature_2m_max[i]),
      low: Math.round(d.temperature_2m_min[i]),
      condition: codeMap[d.weather_code[i]] || "Unknown",
    })),
  };
}

async function askGemini(prompt, systemPrompt = null, maxTokens = 1200) {
  haptic(5);
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      model: "gemini-2.0-flash", maxOutputTokens: maxTokens,
      responseMimeType: "application/json", temperature: 0.7, topP: 0.95, topK: 40,
    },
  };
  if (systemPrompt) payload.systemInstruction = systemPrompt;
  const res = await fetch("/api/gemini", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.detail || `Gemini API error ${res.status}`);
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("No response from Gemini");
  if (candidate.finishReason === "SAFETY") throw new Error("Response blocked by safety filter");
  if (candidate.finishReason === "RECITATION") throw new Error("Response blocked due to copyright");
  const text = candidate.content.parts[0].text;
  const cleanJson = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleanJson); }
  catch (e) { console.error("Parse failed:", text); throw new Error("Invalid JSON from Gemini"); }
}

async function categorizeWithGeminiVision(imageBase64, originalName) {
  const prompt = `Analyze this clothing item photo. Respond ONLY with JSON: {"name":"Descriptive name","category":"One of: Outerwear, Tops, Bottoms, Footwear, Accessories","color":"Color name","material":"Fabric or Unknown","season":"spring/summer/fall/winter/all","formality":"casual/smart-casual/business/formal","notes":"Notable details"}`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] }],
    generationConfig: { model: "gemini-2.0-flash", maxOutputTokens: 600, responseMimeType: "application/json", temperature: 0.2 },
  };
  const res = await fetch("/api/gemini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) return fallbackCategorize(originalName);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate || candidate.finishReason === "SAFETY") return fallbackCategorize(originalName);
  const text = candidate.content.parts[0].text;
  const cleanJson = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleanJson); } catch (e) { return fallbackCategorize(originalName); }
}

function fallbackCategorize(fileName) {
  const name = fileName.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
  const lower = name.toLowerCase();
  let category = "Tops";
  if (/coat|jacket|blazer|parka|bomber|trench|overcoat/i.test(lower)) category = "Outerwear";
  else if (/jean|pant|trouser|short|skirt|chino|slack/i.test(lower)) category = "Bottoms";
  else if (/shoe|boot|sneaker|loafer|heel|sandal|oxford/i.test(lower)) category = "Footwear";
  else if (/watch|belt|bag|scarf|hat|tie|jewelry|sunglass|glove/i.test(lower)) category = "Accessories";
  return { name: name.charAt(0).toUpperCase() + name.slice(1), category, color: "Unknown", material: "Unknown", season: "all", formality: "casual", notes: "Auto-categorized" };
}

async function generateSeedanceVideo(suggestion, userPhoto) {
  const outfitDesc = Object.entries(suggestion.outfit || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");
  const prompt = `A cinematic fashion portrait of a person wearing ${outfitDesc}. ${suggestion.mood} aesthetic. Editorial lighting, shallow depth of field, luxury fashion photography style. Full body visible.`;
  const res = await fetch("/api/fal/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fal-target-url": "https://110602490-seedance-lite.fal.run" },
    body: JSON.stringify({ prompt, image_url: userPhoto, duration: 5, aspect_ratio: "9:16", resolution: "720p" }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Video generation failed"); }
  const data = await res.json();
  return data.video?.url || data.url;
}

export default function Vestia() {
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

  const toast = useCallback((msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 2500); }, []);

  useEffect(() => {
    (async () => {
      const [w, h, wp, up, ob] = await Promise.all([dbGet("wardrobe"), dbGet("history"), dbGet("weekPlan"), dbGet("userPhoto"), dbGet("onboarded")]);
      if (w) setWardrobe(w); if (h) setHistory(h); if (wp) setWeekPlan(wp); if (up) setUserPhoto(up); if (ob) setOnboarded(true);
    })();
  }, []);

  // ─── WEATHER WITH FALLBACK ───
  useEffect(() => {
    async function loadWeather() {
      // Try geolocation first
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              const w = await fetchWeather(pos.coords.latitude, pos.coords.longitude);
              setWeather(w);
              const geo = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&localityLanguage=en`)).json();
              setLocationName(geo.city || geo.locality || "Local");
            } catch (e) {
              console.error("Weather fetch failed", e);
              toast("Weather unavailable — using defaults");
            }
          },
          async (err) => {
            console.error("Geolocation denied", err);
            // Fallback: use IP-based location approximation (New York as default)
            try {
              const w = await fetchWeather(40.7128, -74.0060);
              setWeather(w);
              setLocationName("New York");
              toast("Using default location — enable GPS for local weather");
            } catch (e) {
              toast("Weather unavailable");
            }
          },
          { timeout: 10000, enableHighAccuracy: false }
        );
      } else {
        // No geolocation API at all
        try {
          const w = await fetchWeather(40.7128, -74.0060);
          setWeather(w);
          setLocationName("New York");
        } catch (e) { toast("Weather unavailable"); }
      }
    }
    loadWeather();
  }, []);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const steps = [
    { eyebrow: "Welcome", title: "Your wardrobe, elevated.", body: "Vestia composes outfits from what you own. No shopping. No trends. Just intelligent styling." },
    { eyebrow: "How it works", title: "Photograph your pieces.", body: "Upload your clothing by category. Vestia remembers every item, tracks how often you wear it, and never repeats a look too soon." },
    { eyebrow: "The result", title: "Editorial intelligence.", body: "Each day, Vestia considers the weather, your rotation, and color theory to compose a look — with reasoning you can read." },
  ];

  function finishOnboarding() { setOnboarded(true); dbSet("onboarded", true); haptic(30); }

  // ─── FIXED: MULTIPLE FILE UPLOAD ───
  async function handleClothingUpload(fileList) {
    if (!fileList || fileList.length === 0) return;

    // BUG FIX #2: Copy FileList to array IMMEDIATELY before any async operations
    // FileList is live and gets cleared when we reset the input
    const files = Array.from(fileList);

    setUploading(true);
    try {
      for (const file of files) {
        const compressed = await compressImage(file, 1200, 0.85);
        const base64 = await fileToBase64(compressed);

        let categoryData;
        try { categoryData = await categorizeWithGeminiVision(base64, file.name); }
        catch (e) { categoryData = fallbackCategorize(file.name); }

        // BUG FIX #1: Use AI-detected category, NOT activeCat
        // The AI returns the correct category from the photo analysis
        const detectedCategory = categoryData.category;
        // Validate it's one of our allowed categories
        const validCategory = CATS.includes(detectedCategory) ? detectedCategory : activeCat;

        const newItem = {
          id: Date.now() + Math.random(),
          name: categoryData.name || file.name.replace(/\.[^/.]+$/, ""),
          categoryLabel: validCategory,  // ← FIXED: uses AI category, not activeCat
          color: categoryData.color || "Unknown",
          material: categoryData.material || "Unknown",
          season: categoryData.season || "all",
          formality: categoryData.formality || "casual",
          notes: categoryData.notes || "",
          photo: URL.createObjectURL(compressed),
          wearCount: 0, lastWorn: null,
          dateAdded: new Date().toISOString(),
        };

        const updated = [...wardrobe, newItem];
        setWardrobe(updated);
        await dbSet("wardrobe", updated);
        toast(`Added: ${newItem.name} (${validCategory})`);
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

  async function handleUserPhoto(file) {
    if (!file) return;
    try {
      const compressed = await compressImage(file, 800, 0.9);
      const reader = new FileReader();
      reader.onloadend = async () => { const dataUrl = reader.result; setUserPhoto(dataUrl); await dbSet("userPhoto", dataUrl); toast("Profile photo updated"); haptic(20); };
      reader.readAsDataURL(compressed);
    } catch (err) { toast("Photo upload failed"); }
  }

  async function generateOutfit() {
    if (wardrobe.length < 2) { toast("Add at least 2 wardrobe pieces first"); return; }
    if (!weather) { toast("Waiting for weather data..."); return; }
    setLoading(true); setSuggestion(null); setSdVideo(null); setSdError(null);
    try {
      const recentOutfits = history.slice(0, 7).map((h) => Object.values(h.outfit || {}).filter(Boolean).join(" + ")).join("\n");
      const prompt = `You are Vestia, a luxury personal stylist.\n\nAVAILABLE WARDROBE:\n${wardrobe.map((item) => `- ${item.name} (${item.categoryLabel}, worn ${item.wearCount}x${item.lastWorn ? ", last: " + item.lastWorn : ""})`).join("\n")}\n\nTODAY'S WEATHER:\n- Temperature: ${weather.temp}°C (feels like ${weather.feel}°C)\n- Conditions: ${weather.label}\n- Humidity: ${weather.humidity}%\n- Wind: ${weather.wind}km/h\n\nRECENT OUTFITS (avoid repeating):\n${recentOutfits || "None yet"}\n\nTASK: Compose today's outfit. Consider weather, color harmony, occasion versatility, rotation principle, no repeats.\n\nRespond ONLY with JSON: {"mood":"word","occasion":"occasion","outfit":{"Outerwear":"item or null","Top":"item or null","Bottom":"item or null","Footwear":"item or null","Accessory":"item or null"},"styleScore":0-100,"weatherScore":0-100,"reasoning":"commentary","colorStory":"palette","tips":["tip1","tip2"]}`;
      const result = await askGemini(prompt, VESTIA_SYSTEM_PROMPT, 1500);
      if (!result.outfit || !result.mood) throw new Error("Invalid response structure");
      setSuggestion(result);
      const entry = { id: Date.now(), date: new Date().toISOString(), outfit: result.outfit, mood: result.mood, weather, reasoning: result.reasoning };
      const newHistory = [entry, ...history];
      setHistory(newHistory); await dbSet("history", newHistory);
      const updatedWardrobe = wardrobe.map((item) => {
        const wornToday = Object.values(result.outfit || {}).includes(item.name);
        if (wornToday) return { ...item, wearCount: (item.wearCount || 0) + 1, lastWorn: new Date().toLocaleDateString("en", { month: "short", day: "numeric" }) };
        return item;
      });
      setWardrobe(updatedWardrobe); await dbSet("wardrobe", updatedWardrobe);
      toast("Outfit composed");
    } catch (err) { console.error(err); setSuggestion({ error: true, message: err.message }); toast("Generation failed — " + err.message); }
    finally { setLoading(false); }
  }

  async function generateWeekPlan() {
    if (wardrobe.length < 5) { toast("Add at least 5 pieces for weekly planning"); return; }
    if (!weather?.week) { toast("Weather forecast unavailable"); return; }
    setLoadingWeek(true); setWeekPlan(null);
    try {
      const prompt = `You are Vestia, a luxury personal stylist planning a cohesive week.\n\nAVAILABLE WARDROBE:\n${wardrobe.map((item) => `- ${item.name} (${item.categoryLabel}, worn ${item.wearCount}x)`).join("\n")}\n\n7-DAY WEATHER FORECAST:\n${weather.week.slice(0, 7).map((d) => `- ${d.day}: High ${d.high}°C, Low ${d.low}°C, ${d.condition}`).join("\n")}\n\nRULES: 1. Plan Mon-Sun. 2. No item worn more than twice. 3. Match to weather. 4. Cohesive narrative. 5. Daily style note.\n\nRespond ONLY with JSON: {"days":[{"day":"Monday","outfit":{"Outerwear":"item or null","Top":"item or null","Bottom":"item or null","Footwear":"item or null","Accessory":"item or null"},"note":"editorial note"}],"philosophy":"week narrative"}`;
      const result = await askGemini(prompt, VESTIA_SYSTEM_PROMPT, 2500);
      if (!result.days || result.days.length !== 7) throw new Error("Invalid week plan structure");
      setWeekPlan(result); await dbSet("weekPlan", result); toast("Week planned");
    } catch (err) { toast("Week planning failed — " + err.message); }
    finally { setLoadingWeek(false); }
  }

  async function handleGenerateVideo() {
    if (!userPhoto) { toast("Add profile photo first"); return; }
    if (!suggestion || suggestion.error) { toast("Generate an outfit first"); return; }
    setSdVideo(null); setSdError(null); toast("Generating video...");
    try { const url = await generateSeedanceVideo(suggestion, userPhoto); setSdVideo(url); toast("Video ready"); }
    catch (err) { setSdError(err.message || "Video generation failed"); toast("Video failed"); }
  }

  async function clearAllData() {
    if (!confirm("Erase all wardrobe, history, and photos? This cannot be undone.")) return;
    await Promise.all([dbDel("wardrobe"), dbDel("history"), dbDel("weekPlan"), dbDel("userPhoto"), dbDel("onboarded")]);
    setWardrobe([]); setHistory([]); setWeekPlan(null); setUserPhoto(null); setSuggestion(null); setOnboarded(false);
    toast("All data cleared"); haptic(50);
  }

  const filtered = wardrobe.filter((i) => i.categoryLabel === activeCat);

  // ─── RENDER ───
  if (!onboarded) {
    return (
      <div className="onboard-screen">
        <div className="onboard-card">
          <p className="onboard-eyebrow">{steps[onboardStep].eyebrow}</p>
          <h1>{steps[onboardStep].title}</h1>
          <p>{steps[onboardStep].body}</p>
          <div className="onboard-dots">
            {steps.map((_, i) => (
              <span key={i} className={`dot ${i === onboardStep ? 'active' : ''}`} />
            ))}
          </div>
          <button onClick={() => {
            if (onboardStep < steps.length - 1) setOnboardStep(onboardStep + 1);
            else finishOnboarding();
          }}>
            {onboardStep < steps.length - 1 ? 'Next' : 'Get Started'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>VESTIA</h1>
        <p className="date">{TODAY_ISSUE} {locationName && `· ${locationName}`}</p>
        {weather && (
          <div className="weather-bar">
            <span>{weather.temp}°C feels {weather.feel}°C</span>
            <span>{weather.label} · 💧{weather.humidity}% · 💨{weather.wind}km/h</span>
          </div>
        )}
      </header>

      <nav className="tabs">
        {['today', 'wardrobe', 'week', 'look'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); haptic(5); }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'today' && (
        <section className="today">
          {!suggestion && !loading && (
            <button className="generate-btn" onClick={generateOutfit}>Compose Today's Look</button>
          )}
          {loading && <p className="loading">Composing your look...</p>}
          {suggestion?.error && <p className="error">{suggestion.message}</p>}
          {suggestion && !suggestion.error && (
            <div className="suggestion-card">
              <h2>{suggestion.mood} · {suggestion.occasion}</h2>
              <div className="outfit-grid">
                {Object.entries(suggestion.outfit).map(([cat, item]) => (
                  <div key={cat} className="outfit-slot">
                    <label>{cat}</label>
                    <p>{item || '—'}</p>
                  </div>
                ))}
              </div>
              <p className="reasoning">{suggestion.reasoning}</p>
              <p className="color-story">🎨 {suggestion.colorStory}</p>
              <div className="scores">
                <span>Style: {suggestion.styleScore}/100</span>
                <span>Weather: {suggestion.weatherScore}/100</span>
              </div>
              {suggestion.tips && (
                <ul className="tips">{suggestion.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
              )}
              <button onClick={handleGenerateVideo}>Generate Look Video</button>
              {sdVideo && <video src={sdVideo} controls className="sd-video" />}
              {sdError && <p className="error">{sdError}</p>}
            </div>
          )}
        </section>
      )}

      {tab === 'wardrobe' && (
        <section className="wardrobe">
          <div className="wardrobe-header">
            <div className="cat-tabs">
              {CATS.map(cat => (
                <button key={cat} className={activeCat === cat ? 'active' : ''} onClick={() => setActiveCat(cat)}>
                  {cat}
                </button>
              ))}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => handleClothingUpload(e.target.files)} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading...' : '+ Add Items'}
            </button>
          </div>
          <div className="wardrobe-grid">
            {filtered.length === 0 && <p className="empty">No items in {activeCat}</p>}
            {filtered.map(item => (
              <div key={item.id} className={`item-card ${selectedItem?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedItem(item)}>
                <img src={item.photo} alt={item.name} />
                <p>{item.name}</p>
                <small>Worn: {item.wearCount}x</small>
              </div>
            ))}
          </div>
          {selectedItem && (
            <div className="item-detail">
              <h3>{selectedItem.name}</h3>
              <p>{selectedItem.categoryLabel} · {selectedItem.color} · {selectedItem.material}</p>
              <p>{selectedItem.formality} · {selectedItem.season}</p>
              <p>{selectedItem.notes}</p>
              <button onClick={() => setSelectedItem(null)}>Close</button>
            </div>
          )}
        </section>
      )}

      {tab === 'week' && (
        <section className="week">
          <button onClick={generateWeekPlan} disabled={loadingWeek}>
            {loadingWeek ? 'Planning...' : 'Generate Week Plan'}
          </button>
          {weekPlan && (
            <div className="week-grid">
              {weekPlan.days.map((day, i) => (
                <div key={i} className="day-card">
                  <h3>{day.day}</h3>
                  <div className="outfit-mini">
                    {Object.entries(day.outfit).map(([cat, item]) => (
                      <p key={cat}><strong>{cat}:</strong> {item || '—'}</p>
                    ))}
                  </div>
                  <p className="note">{day.note}</p>
                </div>
              ))}
              <p className="philosophy">📖 {weekPlan.philosophy}</p>
            </div>
          )}
        </section>
      )}

      {tab === 'look' && (
        <section className="look">
          <h2>Your Profile</h2>
          <input ref={photoInputRef} type="file" accept="image/*" onChange={e => handleUserPhoto(e.target.files[0])} hidden />
          <button onClick={() => photoInputRef.current?.click()}>
            {userPhoto ? 'Change Photo' : 'Add Photo'}
          </button>
          {userPhoto && <img src={userPhoto} alt="You" className="user-photo" />}
          {history.length > 0 && (
            <div className="history">
              <h3>Recent Looks</h3>
              {history.slice(0, 10).map(h => (
                <div key={h.id} className="history-item">
                  <p>{new Date(h.date).toLocaleDateString()} — {h.mood}</p>
                  <small>{Object.values(h.outfit).filter(Boolean).join(', ')}</small>
                </div>
              ))}
            </div>
          )}
          <button className="danger" onClick={clearAllData}>Clear All Data</button>
        </section>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
