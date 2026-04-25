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
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
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
  const cleanJson = text.replace(/^```json\\s*/i, "").replace(/^```\\s*/i, "").replace(/\\s*```$/, "").trim();
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
  const cleanJson = text.replace(/^```json\\s*/i, "").replace(/\\s*```$/, "").trim();
  try { return JSON.parse(cleanJson); } catch (e) { return fallbackCategorize(originalName); }
}

function fallbackCategorize(fileName) {
  const name = fileName.replace(/\\.[^/.]+$/, "").replace(/[_-]/g, " ");
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

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const w = await fetchWeather(latitude, longitude);
        setWeather(w);
        const geo = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`)).json();
        setLocationName(geo.city || geo.locality || "Local");
      } catch (e) { console.error(e); }
    }, (err) => console.error(err));
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

  async function handleClothingUpload(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const compressed = await compressImage(file, 1200, 0.85);
        const base64 = await fileToBase64(compressed);
        let categoryData;
        try { categoryData = await categorizeWithGeminiVision(base64, file.name); }
        catch (e) { categoryData = fallbackCategorize(file.name); }
        const newItem = {
          id: Date.now() + Math.random(),
          name: categoryData.name || file.name.replace(/\\.[^/.]+$/, ""),
          categoryLabel: categoryData.category || activeCat,
          color: categoryData.color || "Unknown", material: categoryData.material || "Unknown",
          season: categoryData.season || "all", formality: categoryData.formality || "casual",
          notes: categoryData.notes || "", photo: URL.createObjectURL(compressed),
          wearCount: 0, lastWorn: null, dateAdded: new Date().toISOString(),
        };
        const updated = [...wardrobe, newItem];
        setWardrobe(updated); await dbSet("wardrobe", updated);
        toast(`Added: ${newItem.name}`); haptic(20);
      }
    } catch (err) { toast("Upload failed — " + err.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
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
      const recentOutfits = history.slice(0, 7).map((h) => Object.values(h.outfit || {}).filter(Boolean).join(" + ")).join("\\n");
      const prompt = `You are Vestia, a luxury personal stylist.\\n\\nAVAILABLE WARDROBE:\\n${wardrobe.map((item) => `- ${item.name} (${item.categoryLabel}, worn ${item.wearCount}x${item.lastWorn ? ", last: " + item.lastWorn : ""})`).join("\\n")}\\n\\nTODAY'S WEATHER:\\n- Temperature: ${weather.temp}°C (feels like ${weather.feel}°C)\\n- Conditions: ${weather.label}\\n- Humidity: ${weather.humidity}%\\n- Wind: ${weather.wind}km/h\\n\\nRECENT OUTFITS (avoid repeating):\\n${recentOutfits || "None yet"}\\n\\nTASK: Compose today's outfit. Consider weather, color harmony, occasion versatility, rotation principle, no repeats.\\n\\nRespond ONLY with JSON: {"mood":"word","occasion":"occasion","outfit":{"Outerwear":"item or null","Top":"item or null","Bottom":"item or null","Footwear":"item or null","Accessory":"item or null"},"styleScore":0-100,"weatherScore":0-100,"reasoning":"commentary","colorStory":"palette","tips":["tip1","tip2"]}`;
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
      const prompt = `You are Vestia, a luxury personal stylist planning a cohesive week.\\n\\nAVAILABLE WARDROBE:\\n${wardrobe.map((item) => `- ${item.name} (${item.categoryLabel}, worn ${item.wearCount}x)`).join("\\n")}\\n\\n7-DAY WEATHER FORECAST:\\n${weather.week.slice(0, 7).map((d) => `- ${d.day}: High ${d.high}°C, Low ${d.low}°C, ${d.condition}`).join("\\n")}\\n\\nRULES: 1. Plan Mon-Sun. 2. No item worn more than twice. 3. Match to weather. 4. Cohesive narrative. 5. Daily style note.\\n\\nRespond ONLY with JSON: {"days":[{"day":"Monday","outfit":{"Outerwear":"item or null","Top":"item or null","Bottom":"item or null","Footwear":"item or null","Accessory":"item or null"},"note":"editorial note"}],"philosophy":"week narrative"}`;
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

  if (!onboarded) {
    const step = steps[onboardStep];
    return (
      <div className="onboarding">
        <div className="onboarding-progress">{String(onboardStep + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</div>
        <div className="onboarding-eyebrow">{step.eyebrow}</div>
        <h1 className="onboarding-title">{step.title}</h1>
        <p className="onboarding-body">{step.body}</p>
        <div className="onboarding-dots">{steps.map((_, i) => <span key={i} className={i === onboardStep ? "dot active" : "dot"} />)}</div>
        {onboardStep < steps.length - 1 ? (
          <button className="onboarding-btn" onClick={() => { setOnboardStep(onboardStep + 1); haptic(10); }}>Continue</button>
        ) : (
          <button className="onboarding-btn" onClick={finishOnboarding}>Enter Vestia</button>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      {toastMsg && <div className="toast" onClick={() => setToastMsg(null)}>{toastMsg}</div>}
      {installPrompt && (
        <div className="install-banner">
          <span>INSTALL VESTIA</span>
          <button onClick={() => { installPrompt.prompt(); setInstallPrompt(null); }}>Add to home screen</button>
          <button className="close" onClick={() => setInstallPrompt(null)}>✕</button>
        </div>
      )}
      <header className="masthead"><h1>Vestia</h1><p>Editorial Style Intelligence</p></header>
      <nav className="tabs">
        {[{id:"today",l:"Today"},{id:"wardrobe",l:"Wardrobe"},{id:"week",l:"Week"},{id:"history",l:"History"},{id:"profile",l:"Profile"}].map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => { setTab(t.id); haptic(5); }}>{t.l}</button>
        ))}
      </nav>
      <div className="issue-bar"><span>Issue №{String(history.length + 1).padStart(3, "0")}</span><span>{TODAY_ISSUE}</span></div>

      {tab === "today" && (
        <section className="tab-content">
          {weather && (
            <div className="weather-card">
              <div className="weather-main"><span className="temp">{weather.temp}°</span><span className="feel">Feels {weather.feel}°</span></div>
              <div className="weather-details"><span>Humidity {weather.humidity}%</span><span>Wind {weather.wind}km/h</span></div>
              <div className="weather-label">{weather.label}</div>
              {locationName && <div className="location">{locationName}</div>}
            </div>
          )}
          <button className="generate-btn" onClick={generateOutfit} disabled={loading || wardrobe.length < 2}>{loading ? "Composing..." : "Compose Today's Look"}</button>
          {suggestion && !suggestion.error && (
            <div className="suggestion-card">
              <div className="mood-header"><span className="mood">{suggestion.mood}</span><span className="occasion">{suggestion.occasion}</span></div>
              <div className="outfit-section">
                <h3>The Composition</h3>
                {Object.entries(suggestion.outfit || {}).filter(([, v]) => v).map(([part, val], i) => (
                  <div key={part} className="outfit-item"><span className="num">{String(i + 1).padStart(2, "0")}</span><span className="part">{part}</span><span className="val">{val}</span></div>
                ))}
              </div>
              <div className="scores">
                <div><span className="score">{suggestion.styleScore}/100</span><span className="score-label">Style Index</span></div>
                <div><span className="score">{suggestion.weatherScore}/100</span><span className="score-label">Weather Fit</span></div>
              </div>
              <p className="reasoning">{suggestion.reasoning}</p>
              {suggestion.colorStory && <div className="color-story"><h4>Color Story</h4><p>{suggestion.colorStory}</p></div>}
              {suggestion.tips && (
                <div className="tips"><h4>Stylist's Notes</h4><ul>{suggestion.tips.map((t, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}.</span> {t}</li>)}</ul></div>
              )}
              <div className="cinema-section">
                <h4>Cinema</h4><p className="cinema-sub">Seedance × ByteDance</p>
                <p className="cinema-desc">A moving portrait, in five seconds.</p>
                <p className="cinema-desc">Generate a cinematic vertical video of you wearing this exact composition. Renders in 30–90 seconds.</p>
                <button className="video-btn" onClick={handleGenerateVideo} disabled={!userPhoto}>{sdVideo ? "Regenerate Video" : "Generate Video"}</button>
                {sdVideo && <div className="video-result"><video src={sdVideo} controls loop playsInline /><a href={sdVideo} download target="_blank" rel="noreferrer">Download Video</a></div>}
                {sdError && <p className="error">{sdError}</p>}
              </div>
            </div>
          )}
          {suggestion?.error && <div className="error-card"><p>{suggestion.message || "Unable to generate. Try again."}</p></div>}
          {!suggestion && !loading && wardrobe.length < 2 && <div className="empty-state"><span className="empty-icon">◇</span><h3>Begin with the wardrobe.</h3><p>Add at least two pieces — Vestia composes from what you have.</p></div>}
        </section>
      )}

      {tab === "wardrobe" && (
        <section className="tab-content">
          <div className="category-tabs">
            {CATS.map((cat) => {
              const cnt = wardrobe.filter((i) => i.categoryLabel === cat).length;
              return <button key={cat} className={activeCat === cat ? "active" : ""} onClick={() => { setActiveCat(cat); haptic(5); }}>{cat}<span className="count">{cnt}</span></button>;
            })}
          </div>
          <div className="upload-area">
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => handleClothingUpload(e.target.files)} style={{ display: "none" }} />
            <button className="upload-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? "◌" : "+"}</button>
            <p>{uploading ? "Adding…" : `Add to ${activeCat.toLowerCase()}`}</p><span className="upload-hint">Tap · Multiple OK</span>
          </div>
          {filtered.length > 0 ? (
            <div className="wardrobe-grid">
              {filtered.map((item) => (
                <div key={item.id} className="wardrobe-item" onClick={() => { haptic(10); setSelectedItem(item); }}>
                  <img src={item.photo} alt={item.name} loading="lazy" />
                  <div className="item-meta"><span className="item-name">{item.name}</span><span className="item-wear">{item.wearCount}×</span></div>
                </div>
              ))}
            </div>
          ) : <div className="empty-state"><span className="empty-icon">∅</span><p>No {activeCat.toLowerCase()} yet.</p></div>}
        </section>
      )}

      {tab === "week" && (
        <section className="tab-content">
          <div className="week-header"><span className="issue-num">№ 03</span><h2>Seven days, composed.</h2></div>
          {weather?.week && <div className="week-weather">{weather.week.slice(0, 7).map((d, i) => <div key={i} className="day-weather"><span className="day">{d.day}</span><span className="high">{d.high}°</span><span className="low">{d.low}°</span></div>)}</div>}
          <button className="generate-btn" onClick={generateWeekPlan} disabled={loadingWeek || wardrobe.length < 5}>{loadingWeek ? "Planning..." : "Plan the Week"}</button>
          {weekPlan?.days?.map((d, i) => (
            <div key={i} className="day-plan">
              <div className="day-label">{d.day}</div>
              <div className="day-outfit">{Object.values(d.outfit || {}).filter(Boolean).map((v, j, arr) => <span key={j}>{v}{j < arr.length - 1 && " · "}</span>)}</div>
              {d.note && <p className="day-note">— {d.note}</p>}
            </div>
          ))}
          {weekPlan?.philosophy && <div className="philosophy"><h4>The Week's Philosophy</h4><p>{weekPlan.philosophy}</p></div>}
          {!weekPlan && !loadingWeek && <div className="empty-state"><span className="empty-icon">◈</span><p>Five pieces, minimum.<br />You have {wardrobe.length}.</p></div>}
        </section>
      )}

      {tab === "history" && (
        <section className="tab-content">
          <div className="history-header"><span className="issue-num">№ 04</span><h2>The Archive of looks.</h2></div>
          {history.length > 0 ? (
            <div className="history-list">
              {history.map((h, i) => (
                <div key={h.id || i} className="history-item">
                  <div className="history-meta"><span className="history-mood">{h.mood}</span><span className="history-date">{new Date(h.date).toLocaleDateString("en", { month: "short", day: "numeric" })}</span></div>
                  {h.weather && <div className="history-weather">{h.weather.temp}° · {h.weather.label}</div>}
                  <div className="history-outfit">{Object.values(h.outfit || {}).filter(Boolean).map((v, j, arr) => <span key={j}>{v}{j < arr.length - 1 && " · "}</span>)}</div>
                </div>
              ))}
            </div>
          ) : <div className="empty-state"><span className="empty-icon">◌</span><h3>The archive is empty.</h3><p>Compose your first look to begin.</p></div>}
        </section>
      )}

      {tab === "profile" && (
        <section className="tab-content profile-tab">
          <div className="profile-photo">
            <input ref={photoInputRef} type="file" accept="image/*" onChange={(e) => handleUserPhoto(e.target.files[0])} style={{ display: "none" }} />
            <div className="photo-circle" onClick={() => photoInputRef.current?.click()}>{userPhoto ? <img src={userPhoto} alt="Profile" /> : <span className="photo-placeholder">+</span>}</div>
            <p className="photo-hint">Tap to {userPhoto ? "change" : "upload"} · Used by AI for personalized videos</p>
          </div>
          <div className="profile-section"><h4>Privacy</h4><p>Your wardrobe, your photo, your history — all stored locally in this browser. Nothing syncs. Nothing tracks.</p></div>
          <div className="profile-section"><h4>Weather</h4><p>{weather ? <>{weather.label} · {weather.temp}°C · {locationName || "Live"}</> : "Locating..."}</p></div>
          <div className="profile-section powered-by"><h4>Powered By</h4><p>i. Google Gemini — Style intelligence & vision</p><p>ii. ByteDance Seedance — Cinematic video</p><p>iii. Open-Meteo — Real-time weather</p></div>
          <button className="clear-btn" onClick={clearAllData}>Clear All Data</button>
        </section>
      )}

      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <img src={selectedItem.photo} alt={selectedItem.name} />
            <h3>{selectedItem.name}</h3>
            <div className="modal-meta">
              <p><span>i.</span> Category {selectedItem.categoryLabel}</p>
              <p><span>ii.</span> Worn {selectedItem.wearCount} times</p>
              {selectedItem.lastWorn && <p><span>iii.</span> Last {selectedItem.lastWorn}</p>}
              {selectedItem.color && <p><span>iv.</span> Color {selectedItem.color}</p>}
              {selectedItem.material && <p><span>v.</span> Material {selectedItem.material}</p>}
              {selectedItem.notes && <p className="modal-notes">{selectedItem.notes}</p>}
            </div>
            <button className="modal-close" onClick={() => setSelectedItem(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
