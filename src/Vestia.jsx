import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { fal } from "@fal-ai/client";

// Configure fal client to route through our Netlify proxy
fal.config({ proxyUrl: "/api/fal/proxy" });

// ═════════════════════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════════════════════
const GS = `
  :root {
    --obsidian: #080808; --charcoal: #111111; --graphite: #1a1a1a;
    --smoke: #242424; --ash: #2e2e2e; --mist: #3d3d3d;
    --silver: #8a8a8a; --pearl: #c8c8c8; --ivory: #f0ece4;
    --gold: #c9a96e; --gold-light: #e8c98a; --gold-dark: #9a7a45;
    --green: #4caf7d; --red: #c87070;
    --serif: 'Cormorant Garamond', Georgia, serif;
    --sans: 'Tenor Sans', -apple-system, sans-serif;
  }
  @keyframes fadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  @keyframes slideUp { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes dotPulse { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
  .fu { animation: fadeUp .5s cubic-bezier(.16,1,.3,1) both; }
  .gold-shimmer {
    background: linear-gradient(90deg,var(--gold-dark),var(--gold-light),var(--gold-dark),var(--gold-light),var(--gold-dark));
    background-size:200% auto; -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
    animation: shimmer 4s linear infinite;
  }
  .nav-pill { transition:all .25s; position:relative; }
  .nav-pill::after { content:''; position:absolute; bottom:-1px; left:50%; right:50%; height:1px; background:var(--gold); transition:all .3s; }
  .nav-pill.active::after { left:0; right:0; }
  .cta-btn { transition:all .3s; position:relative; overflow:hidden; }
  .cta-btn::before { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(201,169,110,.12),transparent); transform:translateX(-100%); transition:transform .6s; }
  .cta-btn:active::before { transform:translateX(100%); }
  .cta-btn:active { transform:scale(.98); }
  .item-card { transition:all .3s; }
  .item-card:active { transform:scale(.97); }
  .week-row { transition:background .2s; cursor:pointer; }
  .week-row:active { background:var(--graphite)!important; }
  .scrollbar-hide { scrollbar-width:none; }
  .scrollbar-hide::-webkit-scrollbar { display:none; }
  .grain { position:fixed; inset:0; pointer-events:none; z-index:999; opacity:.028;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .file-upload-wrap { position:relative; display:block; }
  .file-upload-wrap input[type=file] {
    position:absolute; inset:0; width:100%; height:100%;
    opacity:0; cursor:pointer; z-index:2; font-size:0;
  }
  .typing-dots span { display:inline-block; width:4px; height:4px; margin:0 2px; background:var(--gold); border-radius:50%; animation:dotPulse 1.4s infinite; }
  .typing-dots span:nth-child(2) { animation-delay:.2s; }
  .typing-dots span:nth-child(3) { animation-delay:.4s; }
  ::selection { background:var(--gold); color:var(--obsidian); }
`;

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════
const WMO_LABEL = {0:"Clear Sky",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",45:"Foggy",48:"Icy Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",77:"Snow Grains",80:"Showers",81:"Rain Showers",82:"Violent Showers",85:"Snow Showers",86:"Heavy Snow Showers",95:"Thunderstorm",96:"Thunderstorm & Hail",99:"Thunderstorm & Heavy Hail"};
const WMO_ICON = {0:"○",1:"◎",2:"◑",3:"●",45:"≈",48:"≈",51:"·",53:"·",55:"··",61:"◉",63:"◉",65:"◉",71:"❄",73:"❄",75:"❄",77:"❄",80:"◉",81:"◉",82:"◉",85:"❄",86:"❄",95:"⚡",96:"⚡",99:"⚡"};
const CATS = ["TOPS","BOTTOMS","SHOES","OUTERWEAR","ACCESSORIES"];
const CAT_KEY = {TOPS:"tops",BOTTOMS:"bottoms",SHOES:"shoes",OUTERWEAR:"outerwear",ACCESSORIES:"accessories"};

// ═════════════════════════════════════════════════════════════════════════════
// INDEXEDDB
// ═════════════════════════════════════════════════════════════════════════════
const DB_NAME = "vestia_db";
const DB_VERSION = 1;
const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onerror = () => reject(req.error);
  req.onsuccess = () => resolve(req.result);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" });
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
  };
});
const dbGet = async (store, key) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const dbGetAll = async (store) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
};
const dbPut = async (store, value) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};
const dbDelete = async (store, key) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};
const dbClear = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["photos","meta"], "readwrite");
    tx.objectStore("photos").clear();
    tx.objectStore("meta").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// IMAGE COMPRESSION
// ═════════════════════════════════════════════════════════════════════════════
const compressImage = (file, maxDim = 1200, quality = 0.85) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = (height * maxDim) / width; width = maxDim; }
      else if (height > maxDim) { width = (width * maxDim) / height; height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = reject;
    img.src = e.target.result;
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const haptic = (pattern = 10) => { if (navigator.vibrate) navigator.vibrate(pattern); };

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function Vestia() {
  const [booted, setBooted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);

  const [wardrobe, setWardrobe] = useState([]);
  const [userPhoto, setUserPhoto] = useState(null);
  const [history, setHistory] = useState([]);

  const [tab, setTab] = useState("suggest");
  const [activeCat, setActiveCat] = useState("TOPS");

  const [weather, setWeather] = useState(null);
  const [wLoading, setWLoading] = useState(false);
  const [locationName, setLocationName] = useState("");

  const [suggestion, setSuggestion] = useState(null);
  const [weekPlan, setWeekPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingWeek, setLoadingWeek] = useState(false);

  const [sdLoading, setSdLoading] = useState(false);
  const [sdVideo, setSdVideo] = useState(null);
  const [sdError, setSdError] = useState(null);
  const [sdStatus, setSdStatus] = useState("");

  const [selectedItem, setSelectedItem] = useState(null);
  const [toast, setToast] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [uploading, setUploading] = useState(false);

  // ─── Boot ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [photos, userPhotoData, historyData, hasOnboarded] = await Promise.all([
          dbGetAll("photos"),
          dbGet("meta", "userPhoto"),
          dbGet("meta", "history"),
          dbGet("meta", "onboarded"),
        ]);
        setWardrobe(photos.filter(p => p.type === "clothing").sort((a,b) => (b.addedAt||0) - (a.addedAt||0)));
        setUserPhoto(userPhotoData?.value || null);
        setHistory(historyData?.value || []);
        if (!hasOnboarded?.value) setShowOnboarding(true);
      } catch(e) { console.error("Boot failed:", e); }
      setBooted(true);
    })();

    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type, id: Date.now() });
    haptic(type === "error" ? [50,30,50] : 15);
    setTimeout(() => setToast(t => t?.msg === msg ? null : t), 3000);
  }, []);

  // ─── Weather ─────────────────────────────────────────────────────────────────
  const fetchWeather = useCallback(async (lat, lon) => {
    setWLoading(true);
    try {
      const [wRes, gRes] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`),
        fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en`).catch(() => null),
      ]);
      const d = await wRes.json();
      const c = d.current;
      setWeather({
        temp: Math.round(c.temperature_2m),
        feel: Math.round(c.apparent_temperature),
        humidity: c.relative_humidity_2m,
        wind: Math.round(c.wind_speed_10m),
        code: c.weather_code,
        label: WMO_LABEL[c.weather_code] || "Clear",
        icon: WMO_ICON[c.weather_code] || "○",
        week: d.daily.time.map((t, i) => ({
          day: new Date(t + "T12:00:00").toLocaleDateString("en", { weekday: "short" }).toUpperCase(),
          icon: WMO_ICON[d.daily.weather_code[i]] || "○",
          label: WMO_LABEL[d.daily.weather_code[i]] || "",
          high: Math.round(d.daily.temperature_2m_max[i]),
          low: Math.round(d.daily.temperature_2m_min[i]),
        })),
      });
      if (gRes?.ok) {
        const gd = await gRes.json();
        if (gd.results?.[0]) setLocationName(`${gd.results[0].name}${gd.results[0].country_code ? ", " + gd.results[0].country_code : ""}`);
      }
    } catch (e) { console.error("Weather error:", e); }
    setWLoading(false);
  }, []);

  const getLocation = useCallback(() => {
    setWLoading(true);
    if (!navigator.geolocation) { fetchWeather(48.8566, 2.3522); return; }
    navigator.geolocation.getCurrentPosition(
      pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
      () => { showToast("Location denied, using Paris", "info"); fetchWeather(48.8566, 2.3522); },
      { timeout: 10000, maximumAge: 600000 }
    );
  }, [fetchWeather, showToast]);

  useEffect(() => { if (booted) getLocation(); }, [booted, getLocation]);

  // ─── Uploads ─────────────────────────────────────────────────────────────────
  const handleClothingUpload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    const items = [];
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        const { dataUrl, base64, mediaType } = await compressImage(f, 1200, 0.85);
        const item = {
          id: `cloth_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
          type: "clothing",
          category: CAT_KEY[activeCat],
          categoryLabel: activeCat,
          url: dataUrl,
          base64,
          mediaType,
          name: f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").slice(0, 40),
          wearCount: 0,
          lastWorn: null,
          addedAt: Date.now(),
        };
        await dbPut("photos", item);
        items.push(item);
      }
      setWardrobe(w => [...items, ...w]);
      haptic(20);
      showToast(`${items.length} piece${items.length > 1 ? "s" : ""} added`, "success");
    } catch(e) {
      console.error(e);
      showToast("Upload failed — try smaller photos", "error");
    }
    setUploading(false);
  };

  const handleUserPhoto = async (f) => {
    if (!f?.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const { dataUrl, base64, mediaType } = await compressImage(f, 800, 0.88);
      const data = { url: dataUrl, base64, mediaType };
      await dbPut("meta", { key: "userPhoto", value: data });
      setUserPhoto(data);
      haptic(20);
      showToast("Profile photo updated", "success");
    } catch(e) { showToast("Failed to save photo", "error"); }
    setUploading(false);
  };

  const removeItem = async (item) => {
    await dbDelete("photos", item.id);
    setWardrobe(w => w.filter(i => i.id !== item.id));
    setSelectedItem(null);
    haptic(25);
    showToast("Item removed");
  };

  // ─── Suggestion via Claude proxy ─────────────────────────────────────────────
  const getSuggestion = async () => {
    if (wardrobe.length < 2) return showToast("Add at least 2 items first", "error");
    setLoading(true); setSuggestion(null); setSdVideo(null); setSdError(null);
    haptic(15);

    try {
      const desc = wardrobe.map((i, x) => `[${x+1}] ${i.categoryLabel}: "${i.name}" (worn ${i.wearCount}×, last:${i.lastWorn || "never"})`).join("\n");
      const w = weather;
      const msgs = [{
        role: "user",
        content: [
          ...(userPhoto ? [{ type: "image", source: { type: "base64", media_type: userPhoto.mediaType, data: userPhoto.base64 } }] : []),
          ...wardrobe.slice(0, 6).map(i => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })),
          { type: "text", text: `World-class personal stylist for a luxury fashion app.

LIVE WEATHER: ${w?.label || "Clear"}, ${w?.temp || 20}°C, feels ${w?.feel || 19}°C, humidity ${w?.humidity || 50}%, wind ${w?.wind || 10}km/h.

WARDROBE:
${desc}

${userPhoto ? "First image = user's photo. Remaining = wardrobe items." : "Images = wardrobe items."}

Reply ONLY with valid JSON (no markdown, no backticks):
{
  "outfit": {"top":"name","bottom":"name","shoes":"name","outerwear":null,"accessories":null},
  "mood": "one evocative word",
  "reasoning": "2 sentences — fashion editor tone",
  "styleScore": 88,
  "weatherScore": 94,
  "tips": ["tip 1", "tip 2"],
  "occasion": "Editorial / Work / Soirée / Leisure",
  "colorStory": "palette harmony in 1 sentence",
  "videoPrompt": "Cinematic fashion editorial. Subject wearing [describe each piece in detail]. Slow camera dolly, soft natural light, minimal background, shallow depth of field, 5 seconds."
}` }
        ]
      }];

      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, max_tokens: 1200 }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = `API error ${res.status}`;
        try { const j = JSON.parse(errText); errMsg = j.error?.message || j.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      const text = data.content.map(b => b.text || "").join("");
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setSuggestion(parsed);

      const entry = { date: new Date().toISOString(), outfit: parsed.outfit, mood: parsed.mood, weather: { temp: w?.temp, label: w?.label } };
      const newHistory = [entry, ...history].slice(0, 50);
      setHistory(newHistory);
      await dbPut("meta", { key: "history", value: newHistory });

      // Update wear counts
      const vals = Object.values(parsed.outfit || {}).filter(Boolean).join(" ").toLowerCase();
      for (const item of wardrobe) {
        if (vals.includes(item.name.toLowerCase())) {
          const updated = { ...item, wearCount: item.wearCount + 1, lastWorn: new Date().toISOString().split("T")[0] };
          await dbPut("photos", updated);
          setWardrobe(w => w.map(i => i.id === item.id ? updated : i));
        }
      }
      haptic([10,30,10]);
    } catch (e) {
      console.error("Suggestion error:", e);
      setSuggestion({ error: true, message: e.message });
      showToast(e.message.slice(0,40), "error");
    }
    setLoading(false);
  };

  // ─── Week plan ───────────────────────────────────────────────────────────────
  const getWeekPlan = async () => {
    if (wardrobe.length < 5) return showToast("Need 5+ pieces for week plan", "error");
    setLoadingWeek(true); setWeekPlan(null); haptic(15);
    try {
      const desc = wardrobe.map((i, x) => `[${x+1}] ${i.categoryLabel}: "${i.name}"`).join("\n");
      const forecast = weather?.week?.map(d => `${d.day}: ${d.label}, ${d.high}°/${d.low}°C`).join("\n") || "Mild week";

      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: `Luxury personal stylist. Plan 7 days of outfits. Each item used max twice.

FORECAST:
${forecast}

WARDROBE:
${desc}

Reply ONLY with JSON:
{"days":[{"day":"MON","outfit":{"top":"...","bottom":"...","shoes":"...","outerwear":null},"mood":"word","note":"one elegant sentence"}],"philosophy":"one sentence"}`
          }]
        }),
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const text = data.content.map(b => b.text || "").join("");
      setWeekPlan(JSON.parse(text.replace(/```json|```/g, "").trim()));
      haptic([10,30,10]);
    } catch(e) {
      console.error(e);
      showToast("Week plan failed", "error");
    }
    setLoadingWeek(false);
  };

  // ─── Seedance video via fal client through proxy ─────────────────────────────
  const generateVideo = async () => {
    if (!suggestion?.videoPrompt) return;
    if (!userPhoto) return showToast("Add your profile photo in Profile tab first", "error");

    setSdLoading(true);
    setSdVideo(null);
    setSdError(null);
    setSdStatus("Submitting to Seedance...");
    haptic(15);

    try {
      // The fal client handles polling automatically.
      // Base64 data URLs are accepted as image_url and decoded server-side.
      const result = await fal.subscribe("fal-ai/bytedance/seedance/v1/lite/image-to-video", {
        input: {
          prompt: suggestion.videoPrompt,
          image_url: userPhoto.url, // base64 data URL works directly
          duration: "5",
          resolution: "720p",
          aspect_ratio: "9:16",
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_QUEUE") setSdStatus("Queued...");
          else if (update.status === "IN_PROGRESS") {
            const lastLog = update.logs?.[update.logs.length - 1]?.message || "Generating video...";
            setSdStatus(lastLog.slice(0, 60));
          }
        },
      });

      const videoUrl = result.data?.video?.url;
      if (!videoUrl) throw new Error("No video URL in response");
      setSdVideo(videoUrl);
      setSdStatus("");
      showToast("Video ready", "success");
      haptic([20,50,20,50,20]);
    } catch (e) {
      console.error("Seedance error:", e);
      const msg = e.message || e.body?.detail || "Video generation failed";
      setSdError(msg);
      showToast("Video generation failed", "error");
    }
    setSdLoading(false);
  };

  const installPWA = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") showToast("Added to home screen", "success");
    setInstallPrompt(null);
  };

  const finishOnboarding = async () => {
    await dbPut("meta", { key: "onboarded", value: { value: true, at: Date.now() } });
    setShowOnboarding(false);
    haptic(30);
  };

  const clearAllData = async () => {
    if (!window.confirm("Clear all Vestia data? This cannot be undone.")) return;
    await dbClear();
    window.location.reload();
  };

  const filtered = useMemo(() => wardrobe.filter(i => i.categoryLabel === activeCat), [wardrobe, activeCat]);
  const totalWears = useMemo(() => wardrobe.reduce((s, i) => s + (i.wearCount || 0), 0), [wardrobe]);

  // ── BOOTING ──
  if (!booted) {
    return (
      <div style={{minHeight:"100vh",background:"#080808",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontFamily:"'Cormorant Garamond', serif",fontSize:32,fontWeight:300,color:"#c9a96e",letterSpacing:10,animation:"pulse 1.5s infinite"}}>V</div>
      </div>
    );
  }

  // ── ONBOARDING ──
  if (showOnboarding) {
    const steps = [
      { t: "Welcome to Vestia", s: "Your personal style intelligence. Built for people who dress with intention.", emoji: "V" },
      { t: "Build Your Wardrobe", s: "Photograph each piece you own. Tops, bottoms, shoes, outerwear. The more Vestia sees, the better it curates.", emoji: "◈" },
      { t: "Let Weather Guide You", s: "Vestia reads the real weather for your exact location and composes outfits that work for the day you're actually living.", emoji: "◎" },
      { t: "Style with Intention", s: "Daily looks. Week-ahead planning. AI video previews. All private, all yours.", emoji: "✦" },
    ];
    const step = steps[onboardStep];
    return (
      <>
        <style>{GS}</style>
        <div className="grain"/>
        <div style={{minHeight:"100vh",background:"var(--obsidian)",display:"flex",flexDirection:"column",padding:"40px 28px",maxWidth:480,margin:"0 auto"}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",textAlign:"center"}}>
            <div key={onboardStep} className="fu" style={{fontFamily:"var(--serif)",fontSize:80,fontWeight:300,color:"var(--gold)",marginBottom:40,lineHeight:1}}>{step.emoji}</div>
            <div key={`t-${onboardStep}`} className="fu" style={{fontFamily:"var(--serif)",fontSize:36,fontWeight:300,color:"var(--ivory)",marginBottom:20,lineHeight:1.2}}>{step.t}</div>
            <div key={`s-${onboardStep}`} className="fu" style={{fontSize:15,color:"var(--silver)",lineHeight:1.7,maxWidth:340,margin:"0 auto",letterSpacing:.3}}>{step.s}</div>
          </div>
          <div>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:32}}>
              {steps.map((_, i) => (
                <div key={i} style={{width:i === onboardStep ? 24 : 6,height:2,background:i <= onboardStep ? "var(--gold)" : "var(--ash)",transition:"all .3s"}}/>
              ))}
            </div>
            <button className="cta-btn" onClick={() => { haptic(15); onboardStep < steps.length - 1 ? setOnboardStep(onboardStep + 1) : finishOnboarding(); }}
              style={{width:"100%",padding:"16px",background:"transparent",border:"1px solid var(--gold-dark)",color:"var(--gold)",fontSize:10,letterSpacing:5,fontFamily:"var(--sans)",cursor:"pointer"}}>
              {onboardStep < steps.length - 1 ? "CONTINUE" : "BEGIN"}
            </button>
            {onboardStep < steps.length - 1 && (
              <button onClick={finishOnboarding} style={{width:"100%",padding:"12px",background:"none",border:"none",color:"var(--silver)",fontSize:9,letterSpacing:3,marginTop:12,fontFamily:"var(--sans)",cursor:"pointer"}}>
                SKIP
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── MAIN APP ──
  return (
    <>
      <style>{GS}</style>
      <div className="grain"/>

      {toast && (
        <div key={toast.id} style={{position:"fixed",top:"calc(env(safe-area-inset-top) + 16px)",left:"50%",transform:"translateX(-50%)",background:toast.type === "error" ? "#2a1010" : toast.type === "success" ? "#0f2a1a" : "#1a1814",border:`1px solid ${toast.type === "error" ? "var(--red)" : toast.type === "success" ? "var(--green)" : "var(--gold-dark)"}`,color:toast.type === "error" ? "var(--red)" : toast.type === "success" ? "var(--green)" : "var(--gold)",padding:"10px 20px",fontSize:9,letterSpacing:2,zIndex:1000,animation:"fadeUp .3s ease",whiteSpace:"nowrap",fontFamily:"var(--sans)",maxWidth:"90vw",overflow:"hidden",textOverflow:"ellipsis"}}>
          {toast.msg.toUpperCase()}
        </div>
      )}

      {installPrompt && (
        <div style={{position:"fixed",bottom:"calc(env(safe-area-inset-bottom) + 16px)",left:16,right:16,background:"var(--charcoal)",border:"1px solid var(--gold-dark)",padding:"12px 16px",zIndex:900,maxWidth:448,margin:"0 auto",display:"flex",alignItems:"center",gap:12,animation:"slideUp .4s ease"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:10,letterSpacing:3,color:"var(--gold)",marginBottom:2}}>INSTALL VESTIA</div>
            <div style={{fontSize:11,color:"var(--silver)"}}>Add to home screen</div>
          </div>
          <button onClick={installPWA} style={{background:"var(--gold)",color:"var(--obsidian)",padding:"7px 14px",fontSize:9,letterSpacing:3,fontFamily:"var(--sans)",border:"none",cursor:"pointer"}}>INSTALL</button>
          <button onClick={() => setInstallPrompt(null)} style={{color:"var(--silver)",padding:"7px",fontSize:16,background:"none",border:"none",cursor:"pointer"}}>×</button>
        </div>
      )}

      <div style={{minHeight:"100vh",background:"var(--obsidian)",color:"var(--ivory)",fontFamily:"var(--sans)",maxWidth:480,margin:"0 auto"}}>

        {/* HEADER */}
        <div style={{background:"var(--charcoal)",borderBottom:"1px solid var(--ash)",position:"sticky",top:0,zIndex:50,paddingTop:"env(safe-area-inset-top)"}}>
          <div style={{padding:"16px 20px 0"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <div className="gold-shimmer" style={{fontSize:28,letterSpacing:10,fontFamily:"var(--serif)",fontWeight:300}}>VESTIA</div>
                <div style={{fontSize:7,letterSpacing:4,color:"var(--silver)",marginTop:1}}>PERSONAL STYLE INTELLIGENCE</div>
              </div>
              <div style={{textAlign:"right",cursor:"pointer"}} onClick={() => { haptic(10); getLocation(); }}>
                {wLoading ? <div style={{fontSize:8,letterSpacing:2,color:"var(--silver)",animation:"pulse 1.5s infinite"}}>LOCATING</div> : weather ? (
                  <>
                    <div style={{fontFamily:"var(--serif)",fontSize:24,fontWeight:300,lineHeight:1}}>{weather.icon} {weather.temp}°</div>
                    <div style={{fontSize:7,letterSpacing:3,color:"var(--gold)",marginTop:2}}>{(locationName || weather.label).toUpperCase()}</div>
                  </>
                ) : <div style={{fontSize:7,letterSpacing:3,color:"var(--silver)"}}>TAP FOR WEATHER</div>}
              </div>
            </div>
            <div style={{display:"flex",borderTop:"1px solid var(--ash)"}}>
              {[{id:"suggest",l:"TODAY"},{id:"wardrobe",l:"WARDROBE"},{id:"week",l:"WEEK"},{id:"history",l:"HISTORY"},{id:"profile",l:"PROFILE"}].map(t => (
                <button key={t.id} onClick={() => { haptic(8); setTab(t.id); }} className={`nav-pill${tab === t.id ? " active" : ""}`}
                  style={{flex:1,padding:"12px 2px",fontSize:7,letterSpacing:2,color:tab === t.id ? "var(--gold)" : "var(--silver)",fontFamily:"var(--sans)",background:"none",border:"none",cursor:"pointer"}}>
                  {t.l}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{padding:"22px 16px 120px"}}>

          {/* TODAY */}
          {tab === "suggest" && (
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontSize:9,letterSpacing:4,color:"var(--gold)",marginBottom:4}}>CURATION</div>
                <div style={{fontFamily:"var(--serif)",fontSize:30,fontWeight:300}}>Today's Look</div>
              </div>

              {weather && (
                <div style={{border:"1px solid var(--ash)",padding:"14px 16px",marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontFamily:"var(--serif)",fontSize:36,fontWeight:300,lineHeight:1}}>{weather.icon} {weather.temp}°C</div>
                      <div style={{fontSize:7,letterSpacing:3,color:"var(--gold)",marginTop:3}}>{weather.label.toUpperCase()} · {(locationName || "LIVE").toUpperCase()}</div>
                    </div>
                    <div style={{textAlign:"right",display:"flex",flexDirection:"column",gap:4}}>
                      {[["FEELS",`${weather.feel}°`],["HUMIDITY",`${weather.humidity}%`],["WIND",`${weather.wind}km/h`]].map(([l,v]) => (
                        <div key={l} style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                          <span style={{fontSize:6,letterSpacing:2,color:"var(--silver)"}}>{l}</span>
                          <span style={{fontSize:8,color:"var(--pearl)"}}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button className="cta-btn" onClick={getSuggestion} disabled={loading}
                style={{width:"100%",padding:"15px",background:"transparent",border:"1px solid var(--gold-dark)",color:"var(--gold)",fontSize:8,letterSpacing:5,marginBottom:20,fontFamily:"var(--sans)",display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer"}}>
                {loading ? (<><span className="typing-dots"><span/><span/><span/></span><span>COMPOSING YOUR LOOK</span></>) : "GENERATE TODAY'S OUTFIT"}
              </button>

              {suggestion && !suggestion.error && (
                <div className="fu">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,paddingBottom:12,borderBottom:"1px solid var(--ash)"}}>
                    <div style={{fontFamily:"var(--serif)",fontSize:28,fontStyle:"italic",fontWeight:300,color:"var(--gold)"}}>{suggestion.mood}</div>
                    <div style={{fontSize:7,letterSpacing:3,color:"var(--silver)",border:"1px solid var(--ash)",padding:"4px 10px"}}>{suggestion.occasion?.toUpperCase()}</div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                    {[{l:"STYLE",v:suggestion.styleScore},{l:"WEATHER FIT",v:suggestion.weatherScore}].map(s => (
                      <div key={s.l} style={{border:"1px solid var(--ash)",padding:"11px"}}>
                        <div style={{fontFamily:"var(--serif)",fontSize:30,fontWeight:300,lineHeight:1}}>{s.v}</div>
                        <div style={{fontSize:6,letterSpacing:3,color:"var(--silver)",marginTop:4}}>{s.l}</div>
                        <div style={{height:1,background:"var(--ash)",marginTop:6}}><div style={{height:"100%",width:`${s.v}%`,background:"var(--gold)",transition:"width 1.2s ease"}}/></div>
                      </div>
                    ))}
                  </div>

                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:7,letterSpacing:4,color:"var(--gold)",marginBottom:8}}>THE LOOK</div>
                    {Object.entries(suggestion.outfit||{}).filter(([,v])=>v).map(([part,val]) => (
                      <div key={part} style={{display:"flex",justifyContent:"space-between",padding:"9px 10px",borderBottom:"1px solid var(--ash)",gap:10}}>
                        <div style={{fontSize:6,letterSpacing:3,color:"var(--silver)",width:76,flexShrink:0,paddingTop:1}}>{part.toUpperCase()}</div>
                        <div style={{fontFamily:"var(--serif)",fontSize:13,color:"var(--pearl)",textAlign:"right"}}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {suggestion.colorStory && (
                    <div style={{border:"1px solid var(--ash)",borderLeft:"2px solid var(--gold-dark)",padding:"11px 13px",marginBottom:16}}>
                      <div style={{fontSize:6,letterSpacing:3,color:"var(--gold)",marginBottom:5}}>COLOR STORY</div>
                      <div style={{fontFamily:"var(--serif)",fontSize:13,fontStyle:"italic",color:"var(--pearl)",lineHeight:1.7}}>{suggestion.colorStory}</div>
                    </div>
                  )}

                  <div style={{marginBottom:16,paddingBottom:16,borderBottom:"1px solid var(--ash)"}}>
                    <div style={{fontFamily:"var(--serif)",fontSize:13,color:"var(--silver)",lineHeight:1.8,fontStyle:"italic"}}>{suggestion.reasoning}</div>
                  </div>

                  {suggestion.tips && (
                    <div style={{marginBottom:18}}>
                      <div style={{fontSize:7,letterSpacing:4,color:"var(--gold)",marginBottom:9}}>STYLIST NOTES</div>
                      {suggestion.tips.map((t,i) => (
                        <div key={i} style={{display:"flex",gap:9,marginBottom:7}}>
                          <div style={{color:"var(--gold)",fontSize:7,marginTop:3,flexShrink:0}}>◆</div>
                          <div style={{fontSize:12,color:"var(--silver)",lineHeight:1.6}}>{t}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SEEDANCE */}
                  <div style={{background:"var(--graphite)",border:"1px solid var(--ash)",padding:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
                      <div style={{fontSize:7,letterSpacing:4,color:"var(--gold)"}}>AI VIDEO · SEEDANCE 1.0 LITE</div>
                      <div style={{fontSize:6,letterSpacing:2,color:"var(--silver)",background:"var(--ash)",padding:"2px 7px"}}>BYTEDANCE</div>
                    </div>
                    <div style={{fontFamily:"var(--serif)",fontSize:13,color:"var(--silver)",lineHeight:1.7,marginBottom:13}}>
                      Generate a 5-second cinematic video of you in this outfit. Takes ~30-90 seconds.
                    </div>
                    <button className="cta-btn" onClick={generateVideo} disabled={sdLoading || !userPhoto}
                      style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid var(--gold-dark)",color:"var(--gold)",fontSize:7,letterSpacing:4,fontFamily:"var(--sans)",display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",opacity:!userPhoto?0.5:1}}>
                      {sdLoading ? (<><span className="typing-dots"><span/><span/><span/></span><span>{sdStatus || "RENDERING"}</span></>) : !userPhoto ? "ADD PROFILE PHOTO FIRST" : "GENERATE VIDEO"}
                    </button>
                    {sdVideo && (
                      <div style={{marginTop:12,border:"1px solid var(--ash)",overflow:"hidden"}}>
                        <video src={sdVideo} controls autoPlay loop muted playsInline style={{width:"100%",display:"block"}}/>
                        <a href={sdVideo} download="vestia-look.mp4" target="_blank" rel="noopener"
                          style={{display:"block",padding:"9px",textAlign:"center",fontSize:7,letterSpacing:3,color:"var(--gold)",background:"var(--smoke)",textDecoration:"none"}}>
                          ↓ DOWNLOAD VIDEO
                        </a>
                      </div>
                    )}
                    {sdError && <div style={{marginTop:9,fontSize:9,color:"var(--red)",background:"rgba(200,112,112,.07)",padding:"7px 10px",lineHeight:1.5}}>{sdError}</div>}
                  </div>
                </div>
              )}

              {suggestion?.error && (
                <div style={{border:"1px solid #3d1515",padding:13,color:"var(--red)",fontSize:11,lineHeight:1.6}}>
                  {suggestion.message || "Unable to generate. Please try again."}
                </div>
              )}

              {!suggestion && !loading && wardrobe.length < 2 && (
                <div style={{textAlign:"center",padding:"50px 20px",border:"1px dashed var(--ash)"}}>
                  <div style={{fontFamily:"var(--serif)",fontSize:48,color:"var(--ash)",marginBottom:12}}>◈</div>
                  <div style={{fontSize:9,letterSpacing:3,color:"var(--silver)",marginBottom:8}}>START WITH YOUR WARDROBE</div>
                  <div style={{fontSize:11,color:"var(--mist)",marginBottom:16,lineHeight:1.6}}>Add at least 2 pieces to generate outfits</div>
                  <button onClick={() => setTab("wardrobe")} style={{padding:"10px 20px",border:"1px solid var(--gold-dark)",color:"var(--gold)",fontSize:8,letterSpacing:3,background:"transparent",fontFamily:"var(--sans)",cursor:"pointer"}}>
                    BUILD WARDROBE →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* WARDROBE */}
          {tab === "wardrobe" && (
            <div className="fu">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:20}}>
                <div>
                  <div style={{fontSize:9,letterSpacing:4,color:"var(--gold)",marginBottom:4}}>COLLECTION</div>
                  <div style={{fontFamily:"var(--serif)",fontSize:30,fontWeight:300}}>My Wardrobe</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"var(--serif)",fontSize:22}}>{wardrobe.length}</div>
                  <div style={{fontSize:7,letterSpacing:3,color:"var(--silver)"}}>PIECES</div>
                </div>
              </div>

              <div className="scrollbar-hide" style={{display:"flex",gap:6,overflowX:"auto",marginBottom:16,paddingBottom:2}}>
                {CATS.map(cat => {
                  const cnt = wardrobe.filter(i => i.categoryLabel === cat).length;
                  return (
                    <button key={cat} onClick={() => { haptic(8); setActiveCat(cat); }}
                      style={{flexShrink:0,padding:"6px 12px",background:activeCat===cat?"var(--gold)":"transparent",border:`1px solid ${activeCat===cat?"var(--gold)":"var(--ash)"}`,color:activeCat===cat?"var(--obsidian)":"var(--silver)",fontSize:7,letterSpacing:3,fontFamily:"var(--sans)",cursor:"pointer"}}>
                      {cat}{cnt > 0 ? ` (${cnt})` : ""}
                    </button>
                  );
                })}
              </div>

              <div className="file-upload-wrap cta-btn"
                style={{border:"1px solid var(--ash)",padding:"24px 18px",textAlign:"center",marginBottom:20}}>
                <input type="file" accept="image/*" multiple onChange={e => handleClothingUpload(e.target.files)} aria-label="Upload clothing photos"/>
                <div style={{fontSize:20,color:"var(--gold)",marginBottom:6,pointerEvents:"none"}}>{uploading ? "◌" : "+"}</div>
                <div style={{fontSize:9,letterSpacing:3,color:"var(--pearl)",marginBottom:2,pointerEvents:"none"}}>{uploading ? "UPLOADING..." : `ADD TO ${activeCat}`}</div>
                <div style={{fontSize:8,color:"var(--silver)",letterSpacing:1,pointerEvents:"none"}}>Tap to browse · multiple photos OK</div>
              </div>

              {filtered.length > 0 ? (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {filtered.map((item,i) => (
                    <div key={item.id} className="item-card fu" style={{animationDelay:`${i*.04}s`,background:"var(--graphite)",border:"1px solid var(--ash)",cursor:"pointer"}} onClick={() => { haptic(10); setSelectedItem(item); }}>
                      <div style={{position:"relative",overflow:"hidden"}}>
                        <img src={item.url} alt={item.name} style={{width:"100%",aspectRatio:"3/4",objectFit:"cover",display:"block"}}/>
                        <div style={{position:"absolute",top:5,right:5,background:"rgba(8,8,8,.85)",padding:"2px 6px",fontSize:7,letterSpacing:2,color:"var(--gold)"}}>{item.wearCount}×</div>
                      </div>
                      <div style={{padding:"7px 9px"}}>
                        <div style={{fontSize:9,color:"var(--pearl)",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div>
                        {item.lastWorn && <div style={{fontSize:7,color:"var(--silver)",marginTop:1}}>{item.lastWorn}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{textAlign:"center",padding:"48px 20px",borderTop:"1px solid var(--ash)"}}>
                  <div style={{fontFamily:"var(--serif)",fontSize:42,color:"var(--ash)",marginBottom:12}}>∅</div>
                  <div style={{fontSize:8,letterSpacing:4,color:"var(--silver)"}}>NO {activeCat} YET</div>
                </div>
              )}
            </div>
          )}

          {/* WEEK */}
          {tab === "week" && (
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontSize:9,letterSpacing:4,color:"var(--gold)",marginBottom:4}}>PLANNING</div>
                <div style={{fontFamily:"var(--serif)",fontSize:30,fontWeight:300}}>Week Ahead</div>
              </div>

              {weather?.week && (
                <div className="scrollbar-hide" style={{display:"flex",gap:5,overflowX:"auto",marginBottom:16}}>
                  {weather.week.map((d,i) => (
                    <div key={i} style={{flexShrink:0,border:"1px solid var(--ash)",padding:"9px 7px",textAlign:"center",minWidth:50}}>
                      <div style={{fontSize:6,letterSpacing:2,color:"var(--gold)",marginBottom:5}}>{d.day}</div>
                      <div style={{fontFamily:"var(--serif)",fontSize:16,color:"var(--silver)",marginBottom:4}}>{d.icon}</div>
                      <div style={{fontSize:9,color:"var(--pearl)"}}>{d.high}°</div>
                      <div style={{fontSize:7,color:"var(--mist)"}}>{d.low}°</div>
                    </div>
                  ))}
                </div>
              )}

              <button className="cta-btn" onClick={getWeekPlan} disabled={loadingWeek}
                style={{width:"100%",padding:"15px",background:"transparent",border:"1px solid var(--gold-dark)",color:"var(--gold)",fontSize:8,letterSpacing:5,marginBottom:20,fontFamily:"var(--sans)",display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer"}}>
                {loadingWeek ? (<><span className="typing-dots"><span/><span/><span/></span><span>PLANNING YOUR WEEK</span></>) : "PLAN MY WEEK"}
              </button>

              {weekPlan?.days?.map((d,i) => (
                <div key={i} className="week-row fu" style={{animationDelay:`${i*.06}s`,border:"1px solid var(--ash)",marginBottom:8}}>
                  <div style={{display:"flex",borderBottom:"1px solid var(--ash)"}}>
                    <div style={{background:"var(--graphite)",padding:"11px 12px",minWidth:58,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:4}}>
                      <div style={{fontSize:7,letterSpacing:2,color:"var(--gold)"}}>{d.day}</div>
                      {weather?.week && <div style={{fontSize:14,color:"var(--ash)"}}>{weather.week[i]?.icon}</div>}
                      <div style={{fontFamily:"var(--serif)",fontSize:10,fontStyle:"italic",color:"var(--silver)"}}>{d.mood}</div>
                    </div>
                    <div style={{padding:"11px 13px",flex:1}}>
                      {Object.entries(d.outfit||{}).filter(([,v])=>v).map(([part,val]) => (
                        <div key={part} style={{display:"flex",gap:7,marginBottom:3}}>
                          <span style={{fontSize:6,letterSpacing:2,color:"var(--silver)",width:52,flexShrink:0,paddingTop:1}}>{part.toUpperCase()}</span>
                          <span style={{fontFamily:"var(--serif)",fontSize:12,color:"var(--pearl)"}}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {d.note && <div style={{padding:"7px 13px",fontSize:11,fontFamily:"var(--serif)",fontStyle:"italic",color:"var(--silver)"}}>{d.note}</div>}
                </div>
              ))}

              {weekPlan?.philosophy && (
                <div style={{border:"1px solid var(--ash)",padding:"13px 16px",marginTop:12,textAlign:"center"}}>
                  <div style={{fontSize:6,letterSpacing:4,color:"var(--gold)",marginBottom:7}}>WEEK'S PHILOSOPHY</div>
                  <div style={{fontFamily:"var(--serif)",fontSize:14,fontStyle:"italic",color:"var(--silver)",lineHeight:1.7}}>{weekPlan.philosophy}</div>
                </div>
              )}

              {!weekPlan && !loadingWeek && (
                <div style={{textAlign:"center",padding:"50px 20px"}}>
                  <div style={{fontFamily:"var(--serif)",fontSize:48,color:"var(--ash)",marginBottom:12}}>◈</div>
                  <div style={{fontSize:7,letterSpacing:4,color:"var(--silver)"}}>NEEDS 5+ PIECES · YOU HAVE {wardrobe.length}</div>
                </div>
              )}
            </div>
          )}

          {/* HISTORY */}
          {tab === "history" && (
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontSize:9,letterSpacing:4,color:"var(--gold)",marginBottom:4}}>ARCHIVE</div>
                <div style={{fontFamily:"var(--serif)",fontSize:30,fontWeight:300}}>Outfit History</div>
              </div>
              {history.length > 0 ? history.map((h,i) => (
                <div key={i} className="fu" style={{animationDelay:`${i*.04}s`,border:"1px solid var(--ash)",marginBottom:9}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 13px",borderBottom:"1px solid var(--ash)",background:"var(--graphite)"}}>
                    <div style={{fontFamily:"var(--serif)",fontSize:15,fontStyle:"italic",color:"var(--gold)"}}>{h.mood}</div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:7,letterSpacing:2,color:"var(--silver)"}}>{new Date(h.date).toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric"})}</div>
                      {h.weather && <div style={{fontSize:6,color:"var(--mist)",letterSpacing:1}}>{h.weather.temp}° · {h.weather.label}</div>}
                    </div>
                  </div>
                  <div style={{padding:"9px 13px"}}>
                    {Object.entries(h.outfit||{}).filter(([,v])=>v).map(([part,val]) => (
                      <div key={part} style={{display:"flex",gap:7,marginBottom:3}}>
                        <span style={{fontSize:6,letterSpacing:2,color:"var(--silver)",width:66,flexShrink:0}}>{part.toUpperCase()}</span>
                        <span style={{fontFamily:"var(--serif)",fontSize:11,color:"var(--pearl)"}}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )) : (
                <div style={{textAlign:"center",padding:"60px 20px"}}>
                  <div style={{fontFamily:"var(--serif)",fontSize:48,color:"var(--ash)",marginBottom:12}}>⊘</div>
                  <div style={{fontSize:7,letterSpacing:4,color:"var(--silver)"}}>NO HISTORY YET</div>
                  <div style={{fontSize:10,color:"var(--mist)",marginTop:7}}>Generate your first outfit to begin</div>
                </div>
              )}
            </div>
          )}

          {/* PROFILE */}
          {tab === "profile" && (
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontSize:9,letterSpacing:4,color:"var(--gold)",marginBottom:4}}>IDENTITY</div>
                <div style={{fontFamily:"var(--serif)",fontSize:30,fontWeight:300}}>My Profile</div>
              </div>

              <div className="file-upload-wrap" style={{border:"1px solid var(--ash)",padding:20,textAlign:"center",marginBottom:12}}>
                <input type="file" accept="image/*" onChange={e => handleUserPhoto(e.target.files[0])} aria-label="Upload your profile photo"/>
                {userPhoto ? (
                  <div style={{position:"relative",display:"inline-block",pointerEvents:"none"}}>
                    <img src={userPhoto.url} alt="You" style={{width:100,height:100,objectFit:"cover",border:"1px solid var(--ash)",display:"block"}}/>
                    <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,.6)",padding:"4px 0",fontSize:6,letterSpacing:3,color:"var(--ivory)"}}>CHANGE</div>
                  </div>
                ) : (
                  <div style={{width:100,height:100,border:"1px dashed var(--ash)",margin:"0 auto",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,pointerEvents:"none"}}>
                    <div style={{fontSize:18,color:"var(--gold)"}}>{uploading ? "◌" : "+"}</div>
                    <div style={{fontSize:6,letterSpacing:3,color:"var(--silver)"}}>YOUR PHOTO</div>
                  </div>
                )}
                <div style={{fontSize:8,letterSpacing:1,color:"var(--silver)",marginTop:10,pointerEvents:"none"}}>Tap to upload · Used by AI for personalized videos</div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:14}}>
                {[{l:"PIECES",v:wardrobe.length},{l:"WEARS",v:totalWears},{l:"LOOKS",v:history.length}].map(s => (
                  <div key={s.l} style={{border:"1px solid var(--ash)",padding:"12px 8px",textAlign:"center"}}>
                    <div style={{fontFamily:"var(--serif)",fontSize:26,fontWeight:300,lineHeight:1}}>{s.v}</div>
                    <div style={{fontSize:6,letterSpacing:3,color:"var(--silver)",marginTop:4}}>{s.l}</div>
                  </div>
                ))}
              </div>

              <div style={{border:"1px solid var(--ash)",padding:14,marginBottom:12}}>
                <div style={{fontSize:7,letterSpacing:4,color:"var(--gold)",marginBottom:8}}>PRIVATE · LOCAL</div>
                <div style={{fontSize:10,color:"var(--silver)",lineHeight:1.7,marginBottom:10}}>Your wardrobe and history are stored only in this browser using IndexedDB. Photos sent to AI are processed but not retained.</div>
                <button onClick={clearAllData} style={{padding:"7px 14px",border:"1px solid #3d1515",color:"var(--red)",fontSize:7,letterSpacing:3,fontFamily:"var(--sans)",background:"transparent",cursor:"pointer"}}>
                  CLEAR ALL DATA
                </button>
              </div>

              <div style={{border:"1px solid var(--ash)",padding:14,marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                  <div style={{fontSize:7,letterSpacing:4,color:"var(--gold)"}}>WEATHER · OPEN-METEO</div>
                  <div style={{fontSize:6,letterSpacing:2,color:"var(--green)"}}>● FREE</div>
                </div>
                <div style={{fontSize:10,color:"var(--silver)",marginBottom:9,lineHeight:1.6}}>
                  {weather ? `${weather.label} · ${weather.temp}°C · ${locationName || "Live"}` : "Locating..."}
                </div>
                <button onClick={getLocation} style={{padding:"7px 14px",border:"1px solid var(--ash)",color:"var(--silver)",fontSize:7,letterSpacing:3,background:"transparent",fontFamily:"var(--sans)",cursor:"pointer"}}>
                  REFRESH LOCATION
                </button>
              </div>

              <div style={{border:"1px solid var(--ash)",padding:14}}>
                <div style={{fontSize:7,letterSpacing:4,color:"var(--gold)",marginBottom:7}}>AI POWERED BY</div>
                <div style={{fontSize:10,color:"var(--silver)",lineHeight:1.7}}>
                  <div style={{marginBottom:4}}>✦ Anthropic Claude — Style suggestions</div>
                  <div>✦ ByteDance Seedance — Video generation</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MODAL */}
        {selectedItem && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:100,display:"flex",alignItems:"flex-end",backdropFilter:"blur(10px)"}} onClick={() => setSelectedItem(null)}>
            <div style={{background:"var(--charcoal)",width:"100%",maxWidth:480,margin:"0 auto",border:"1px solid var(--ash)",padding:20,animation:"slideUp .4s cubic-bezier(.16,1,.3,1)",paddingBottom:"calc(20px + env(safe-area-inset-bottom))"}} onClick={e => e.stopPropagation()}>
              <img src={selectedItem.url} alt={selectedItem.name} style={{width:"100%",height:240,objectFit:"contain",background:"var(--graphite)",marginBottom:13,display:"block"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontFamily:"var(--serif)",fontSize:20,marginBottom:3}}>{selectedItem.name}</div>
                  <div style={{fontSize:7,letterSpacing:3,color:"var(--gold)"}}>{selectedItem.categoryLabel} · WORN {selectedItem.wearCount}×</div>
                  {selectedItem.lastWorn && <div style={{fontSize:7,color:"var(--silver)",marginTop:2}}>Last worn {selectedItem.lastWorn}</div>}
                </div>
                <button onClick={() => setSelectedItem(null)} style={{border:"1px solid var(--ash)",color:"var(--silver)",width:28,height:28,fontSize:13,background:"none",cursor:"pointer"}}>×</button>
              </div>
              <button onClick={() => removeItem(selectedItem)} style={{width:"100%",padding:"11px",border:"1px solid #3d1515",color:"var(--red)",fontSize:7,letterSpacing:4,background:"transparent",fontFamily:"var(--sans)",cursor:"pointer"}}>
                REMOVE FROM WARDROBE
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
