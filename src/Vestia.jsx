import { useState, useEffect, useCallback, useMemo } from "react";
import { fal } from "@fal-ai/client";

const GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY || "";
const FAL_KEY_VAL = import.meta.env.VITE_FAL_KEY || "";
fal.config({ credentials: FAL_KEY_VAL });

// ─── CONSTANTS ──────────────────────────────────────────────────
const WMO_LABEL = {0:"Clear",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",45:"Foggy",48:"Icy Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",77:"Snow Grains",80:"Showers",81:"Showers",82:"Heavy Showers",85:"Snow Showers",86:"Snow Showers",95:"Thunder",96:"Thunder",99:"Thunder"};
const CATS = ["TOPS","BOTTOMS","SHOES","OUTERWEAR","ACCESSORIES"];
const CAT_KEY = {TOPS:"tops",BOTTOMS:"bottoms",SHOES:"shoes",OUTERWEAR:"outerwear",ACCESSORIES:"accessories"};
const TODAY_ISSUE = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}).toUpperCase();

// ─── INDEXEDDB ──────────────────────────────────────────────────
const DB_NAME = "vestia_db";
const DB_VERSION = 1;
const openDB = () => new Promise((res, rej) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onerror = () => rej(req.error);
  req.onsuccess = () => res(req.result);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" });
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
  };
});
const dbGet = async (store, key) => { const db = await openDB(); return new Promise((r, rj) => { const t = db.transaction(store,"readonly").objectStore(store).get(key); t.onsuccess = () => r(t.result); t.onerror = () => rj(t.error); }); };
const dbGetAll = async (store) => { const db = await openDB(); return new Promise((r, rj) => { const t = db.transaction(store,"readonly").objectStore(store).getAll(); t.onsuccess = () => r(t.result || []); t.onerror = () => rj(t.error); }); };
const dbPut = async (store, val) => { const db = await openDB(); return new Promise((r, rj) => { const t = db.transaction(store,"readwrite").objectStore(store).put(val); t.onsuccess = () => r(); t.onerror = () => rj(t.error); }); };
const dbDelete = async (store, key) => { const db = await openDB(); return new Promise((r, rj) => { const t = db.transaction(store,"readwrite").objectStore(store).delete(key); t.onsuccess = () => r(); t.onerror = () => rj(t.error); }); };
const dbClear = async () => { const db = await openDB(); return new Promise((r, rj) => { const tx = db.transaction(["photos","meta"],"readwrite"); tx.objectStore("photos").clear(); tx.objectStore("meta").clear(); tx.oncomplete = () => r(); tx.onerror = () => rj(tx.error); }); };

// ─── IMAGE COMPRESSION ─────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════
export default function Vestia() {
  const [booted, setBooted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);

  const [wardrobe, setWardrobe] = useState([]);
  const [userPhoto, setUserPhoto] = useState(null);
  const [history, setHistory] = useState([]);

  const [tab, setTab] = useState("today");
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

  // ─── Boot ───────────────────────────────────────────────────────
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
      } catch(e) { console.error(e); }
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

  // ─── Weather ────────────────────────────────────────────────────
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
        week: d.daily.time.map((t, i) => ({
          day: new Date(t + "T12:00:00").toLocaleDateString("en", { weekday: "short" }).toUpperCase().slice(0,3),
          label: WMO_LABEL[d.daily.weather_code[i]] || "",
          high: Math.round(d.daily.temperature_2m_max[i]),
          low: Math.round(d.daily.temperature_2m_min[i]),
        })),
      });
      if (gRes?.ok) {
        const gd = await gRes.json();
        if (gd.results?.[0]) setLocationName(`${gd.results[0].name}${gd.results[0].country_code ? ", " + gd.results[0].country_code : ""}`);
      }
    } catch (e) { console.error(e); }
    setWLoading(false);
  }, []);

  const getLocation = useCallback(() => {
    setWLoading(true);
    if (!navigator.geolocation) { fetchWeather(48.8566, 2.3522); return; }
    navigator.geolocation.getCurrentPosition(
      pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
      () => { showToast("Using Paris", "info"); fetchWeather(48.8566, 2.3522); },
      { timeout: 10000, maximumAge: 600000 }
    );
  }, [fetchWeather, showToast]);

  useEffect(() => { if (booted) getLocation(); }, [booted, getLocation]);

  // ─── Uploads ───────────────────────────────────────────────────
  const handleClothingUpload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    const items = [];
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        const { dataUrl, base64, mediaType } = await compressImage(f, 1200, 0.85);
        const item = {
          id: `c_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
          type: "clothing",
          category: CAT_KEY[activeCat],
          categoryLabel: activeCat,
          url: dataUrl, base64, mediaType,
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
      showToast(`Added ${items.length} piece${items.length > 1 ? "s" : ""}`, "success");
    } catch(e) { console.error(e); showToast("Upload failed", "error"); }
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
      showToast("Photo updated", "success");
    } catch(e) { showToast("Failed to save", "error"); }
    setUploading(false);
  };

  const removeItem = async (item) => {
    await dbDelete("photos", item.id);
    setWardrobe(w => w.filter(i => i.id !== item.id));
    setSelectedItem(null);
    haptic(25);
    showToast("Removed");
  };

  // ─── Outfit suggestion ──────────────────────────────────────────
  const getSuggestion = async () => {
    if (wardrobe.length < 2) return showToast("Add 2+ pieces first", "error");
    setLoading(true); setSuggestion(null); setSdVideo(null); setSdError(null);
    haptic(15);

    try {
      const desc = wardrobe.map((i, x) => `[${x+1}] ${i.categoryLabel}: "${i.name}" (worn ${i.wearCount}×, last:${i.lastWorn || "never"})`).join("\n");
      const w = weather;
      const promptText = `World-class personal stylist for an editorial fashion app.

LIVE WEATHER: ${w?.label || "Clear"}, ${w?.temp || 20}°C, feels ${w?.feel || 19}°C, humidity ${w?.humidity || 50}%, wind ${w?.wind || 10}km/h.

WARDROBE:
${desc}

${userPhoto ? "First image = user's photo. Remaining = wardrobe items." : "Images = wardrobe items."}

Reply ONLY with valid JSON (no markdown, no backticks):
{
  "outfit": {"top":"name","bottom":"name","shoes":"name","outerwear":null,"accessories":null},
  "mood": "one evocative word — like 'Composed' or 'Intimate'",
  "reasoning": "2 sentences in fashion editor voice — restrained, observational",
  "styleScore": 88,
  "weatherScore": 94,
  "tips": ["tip 1", "tip 2"],
  "occasion": "Editorial / Work / Soirée / Leisure",
  "colorStory": "palette harmony in 1 sentence",
  "videoPrompt": "Cinematic fashion editorial. Subject wearing [describe each piece in detail]. Slow camera dolly, soft natural light, minimal background, shallow depth of field, 5 seconds."
}`;

      const parts = [
        ...(userPhoto ? [{ inline_data: { mime_type: userPhoto.mediaType, data: userPhoto.base64 } }] : []),
        ...wardrobe.slice(0, 6).map(i => ({ inline_data: { mime_type: i.mediaType, data: i.base64 } })),
        { text: promptText },
      ];
      const reqBody = {
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 1200, responseMimeType: "application/json" },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

      let data;
      if (window.Capacitor?.isNativePlatform?.()) {
        const resp = await window.Capacitor.Plugins.CapacitorHttp.post({
          url,
          headers: { "Content-Type": "application/json" },
          data: reqBody,
        });
        if (resp.status >= 400) throw new Error(resp.data?.error?.message || `API error ${resp.status}`);
        data = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
      } else {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const errText = await res.text();
          let errMsg = `API error ${res.status}`;
          try { const j = JSON.parse(errText); errMsg = j.error?.message || j.error || errMsg; } catch {}
          throw new Error(errMsg);
        }
        data = await res.json();
      }
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setSuggestion(parsed);

      const entry = { date: new Date().toISOString(), outfit: parsed.outfit, mood: parsed.mood, weather: { temp: w?.temp, label: w?.label } };
      const newHistory = [entry, ...history].slice(0, 50);
      setHistory(newHistory);
      await dbPut("meta", { key: "history", value: newHistory });

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
      console.error(e);
      setSuggestion({ error: true, message: e.message });
      showToast("Generation failed", "error");
    }
    setLoading(false);
  };

  // ─── Week plan ──────────────────────────────────────────────────
  const getWeekPlan = async () => {
    if (wardrobe.length < 5) return showToast("Add 5+ pieces first", "error");
    setLoadingWeek(true); setWeekPlan(null); haptic(15);
    try {
      const desc = wardrobe.map((i, x) => `[${x+1}] ${i.categoryLabel}: "${i.name}"`).join("\n");
      const forecast = weather?.week?.map(d => `${d.day}: ${d.label}, ${d.high}°/${d.low}°C`).join("\n") || "Mild week";

      const isNative = window.Capacitor?.isNativePlatform?.();
      const promptText = `Editorial personal stylist. Plan 7 days of outfits. Each item used max twice.

FORECAST:
${forecast}

WARDROBE:
${desc}

Reply ONLY with JSON:
{"days":[{"day":"MON","outfit":{"top":"...","bottom":"...","shoes":"...","outerwear":null},"mood":"word","note":"one elegant sentence"}],"philosophy":"one sentence"}`;
      const reqBody = {
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 1500, responseMimeType: "application/json" },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
      let data;
      if (isNative) {
        const resp = await window.Capacitor.Plugins.CapacitorHttp.post({
          url,
          headers: { "Content-Type": "application/json" },
          data: reqBody,
        });
        if (resp.status >= 400) throw new Error(`API error ${resp.status}`);
        data = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
      } else {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        data = await res.json();
      }
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      setWeekPlan(JSON.parse(text.replace(/```json|```/g, "").trim()));
      haptic([10,30,10]);
    } catch(e) { console.error(e); showToast("Week plan failed", "error"); }
    setLoadingWeek(false);
  };

  // ─── Video generation ───────────────────────────────────────────
  const generateVideo = async () => {
    if (!suggestion?.videoPrompt) return;
    if (!userPhoto) return showToast("Add profile photo first", "error");

    setSdLoading(true);
    setSdVideo(null);
    setSdError(null);
    setSdStatus("Submitting to Seedance...");
    haptic(15);

    try {
      const result = await fal.subscribe("fal-ai/bytedance/seedance/v1/lite/image-to-video", {
        input: {
          prompt: suggestion.videoPrompt,
          image_url: userPhoto.url,
          duration: "5",
          resolution: "720p",
          aspect_ratio: "9:16",
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_QUEUE") setSdStatus("In queue...");
          else if (update.status === "IN_PROGRESS") {
            const lastLog = update.logs?.[update.logs.length - 1]?.message || "Generating...";
            setSdStatus(lastLog.slice(0, 50));
          }
        },
      });

      const videoUrl = result.data?.video?.url;
      if (!videoUrl) throw new Error("No video URL");
      setSdVideo(videoUrl);
      setSdStatus("");
      showToast("Video ready", "success");
      haptic([20,50,20,50,20]);
    } catch (e) {
      console.error(e);
      setSdError(e.message || "Video generation failed");
      showToast("Video failed", "error");
    }
    setSdLoading(false);
  };

  const installPWA = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") showToast("Installed", "success");
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

  // ── Boot screen ──
  if (!booted) {
    return (
      <div className="boot-loader">
        <div className="boot-mark">V</div>
      </div>
    );
  }

  // ── Onboarding ──
  if (showOnboarding) {
    const steps = [
      { eyebrow: "WELCOME", title: "An editorial of one.", body: "Vestia treats your wardrobe like a magazine treats its archive — with care, perspective, and an eye for what matters." },
      { eyebrow: "STEP I", title: "Build the archive.", body: "Photograph each piece you own. Tops, bottoms, shoes, outerwear. The more Vestia sees, the sharper its recommendations." },
      { eyebrow: "STEP II", title: "Read the day.", body: "Live weather. Real conditions. Vestia composes outfits for the day you're actually living — not an imagined one." },
      { eyebrow: "STEP III", title: "Style with intention.", body: "Daily looks. Week-ahead planning. Cinematic AI previews. Everything private. Everything yours." },
    ];
    const step = steps[onboardStep];
    return (
      <div className="onboard">
        <div className="onboard-mark">VESTIA</div>
        <div className="onboard-num">{String(onboardStep + 1).padStart(2,'0')} / {String(steps.length).padStart(2,'0')}</div>

        <div className="onboard-content">
          <div key={onboardStep} className="fade-up">
            <div className="onboard-eyebrow">{step.eyebrow}</div>
            <h1 className="onboard-title">{step.title}</h1>
            <p className="onboard-body">{step.body}</p>
          </div>
        </div>

        <div className="onboard-progress">
          {steps.map((_, i) => (
            <div key={i} className={`onboard-dot${i <= onboardStep ? " done" : ""}`} />
          ))}
        </div>

        <button className="btn btn-block btn-dark" onClick={() => { haptic(15); onboardStep < steps.length - 1 ? setOnboardStep(onboardStep + 1) : finishOnboarding(); }}>
          <span>{onboardStep < steps.length - 1 ? "Continue" : "Begin"}</span>
        </button>

        {onboardStep < steps.length - 1 && (
          <button className="btn-text" style={{marginTop: 12, width: "100%"}} onClick={finishOnboarding}>
            Skip introduction
          </button>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN APP
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="shell">
      <div className="frame">

        {toast && (
          <div className={`toast ${toast.type}`}>{toast.msg}</div>
        )}

        {installPrompt && (
          <div className="install-banner">
            <div style={{flex:1}}>
              <div style={{fontFamily:"var(--sans)",fontSize:9,letterSpacing:".22em",color:"var(--ochre-pale)",marginBottom:2}}>INSTALL VESTIA</div>
              <div style={{fontFamily:"var(--serif)",fontStyle:"italic",fontSize:13,color:"var(--bone)"}}>Add to home screen</div>
            </div>
            <button className="btn-text" style={{color:"var(--bone)"}} onClick={installPWA}>Install</button>
            <button className="btn-text" style={{color:"var(--ash)"}} onClick={() => setInstallPrompt(null)}>×</button>
          </div>
        )}

        {/* MASTHEAD */}
        <header className="masthead">
          <div className="masthead-content">
            <div className="masthead-row">
              <div>
                <h1 className="wordmark"><span className="v-italic">V</span>estia</h1>
                <div className="wordmark-tagline">Editorial Style Intelligence</div>
              </div>
              <button onClick={() => { haptic(10); getLocation(); }} style={{textAlign:"right"}}>
                {wLoading ? (
                  <div className="loader" style={{color:"var(--stone)"}}>
                    <span className="loader-dot"/><span className="loader-dot"/><span className="loader-dot"/>
                  </div>
                ) : weather ? (
                  <>
                    <div style={{fontFamily:"var(--serif)",fontStyle:"italic",fontSize:24,fontWeight:300,lineHeight:1,fontVariationSettings:'"opsz" 144'}}>
                      {weather.temp}°
                    </div>
                    <div style={{fontFamily:"var(--sans)",fontSize:8,letterSpacing:".22em",color:"var(--stone)",marginTop:3,textTransform:"uppercase"}}>
                      {(locationName || weather.label).slice(0, 22)}
                    </div>
                  </>
                ) : (
                  <div style={{fontSize:9,letterSpacing:".22em",color:"var(--stone)"}}>TAP FOR WEATHER</div>
                )}
              </button>
            </div>
            <nav className="nav">
              {[{id:"today",l:"Today"},{id:"wardrobe",l:"Wardrobe"},{id:"week",l:"Week"},{id:"history",l:"History"},{id:"profile",l:"Profile"}].map(t => (
                <button key={t.id} onClick={() => { haptic(8); setTab(t.id); }} className={`nav-item${tab === t.id ? " active" : ""}`}>
                  {t.l}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {/* ISSUE BAR */}
        <div className="issue">
          <div className="issue-label">Issue №{String(history.length + 1).padStart(3, '0')}</div>
          <div className="issue-num">{TODAY_ISSUE}</div>
        </div>

        {/* ─── TODAY ─── */}
        {tab === "today" && (
          <div className="fade-up">
            <div className="section">
              <div className="editorial-head">
                <div>
                  <div className="numeral">№ 01</div>
                  <h2 className="type-headline" style={{marginTop:6}}>The Look,<br/><span className="type-italic">today.</span></h2>
                </div>
              </div>
            </div>

            {weather && (
              <div className="weather">
                <div className="weather-row">
                  <div className="weather-temp">
                    {weather.temp}<span className="deg">°</span>
                  </div>
                  <div className="weather-meta">
                    <div className="weather-meta-row"><span className="weather-meta-label">Feels</span><span className="weather-meta-val">{weather.feel}°</span></div>
                    <div className="weather-meta-row"><span className="weather-meta-label">Humidity</span><span className="weather-meta-val">{weather.humidity}%</span></div>
                    <div className="weather-meta-row"><span className="weather-meta-label">Wind</span><span className="weather-meta-val">{weather.wind}<span style={{fontSize:9,fontStyle:"normal"}}>km/h</span></span></div>
                  </div>
                </div>
                <div className="weather-label">{weather.label}</div>
                {locationName && <div className="weather-loc">{locationName}</div>}
              </div>
            )}

            <div className="section">
              <button className="btn btn-block btn-dark" onClick={getSuggestion} disabled={loading}>
                {loading ? (
                  <>
                    <span className="loader"><span className="loader-dot"/><span className="loader-dot"/><span className="loader-dot"/></span>
                    <span>Composing</span>
                  </>
                ) : <span>Compose Today's Look</span>}
              </button>
            </div>

            {suggestion && !suggestion.error && (
              <div className="fade-up">
                {/* Mood */}
                <div className="mood-mark">
                  <div className="mood-word">{suggestion.mood}</div>
                  <div className="mood-sub">{suggestion.occasion}</div>
                </div>

                {/* The look */}
                <div className="section">
                  <div className="divider">
                    <span className="divider-label">The Composition</span>
                  </div>
                  <div>
                    {Object.entries(suggestion.outfit||{}).filter(([,v])=>v).map(([part, val], i) => (
                      <div key={part} className="composition-row">
                        <span className="composition-num">{String(i+1).padStart(2,'0')}</span>
                        <span className="composition-label">{part}</span>
                        <span className="composition-name">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scores */}
                <div className="scores">
                  <div className="score">
                    <div className="score-num">{suggestion.styleScore}<span className="of">/100</span></div>
                    <div className="score-label">Style Index</div>
                  </div>
                  <div className="score">
                    <div className="score-num">{suggestion.weatherScore}<span className="of">/100</span></div>
                    <div className="score-label">Weather Fit</div>
                  </div>
                </div>

                {/* Reasoning */}
                <div className="section">
                  <p className="pull-quote">{suggestion.reasoning}</p>
                </div>

                {/* Color story */}
                {suggestion.colorStory && (
                  <div className="section">
                    <div className="divider"><span className="divider-label">Color Story</span></div>
                    <p className="type-italic" style={{fontSize:17,lineHeight:1.6,color:"var(--graphite)"}}>{suggestion.colorStory}</p>
                  </div>
                )}

                {/* Notes */}
                {suggestion.tips && (
                  <div className="section">
                    <div className="divider"><span className="divider-label">Stylist's Notes</span></div>
                    <ul className="notes">
                      {suggestion.tips.map((t, i) => (
                        <li key={i} className="note-item">
                          <span className="note-num">{String(i+1).padStart(2,'0')}.</span>
                          <span className="note-text">{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Cinema (video) */}
                <div className="section" style={{padding:0}}>
                  <div className="cinema">
                    <div className="cinema-eyebrow">
                      <span className="cinema-label">Cinema</span>
                      <span className="cinema-attribution">Seedance × ByteDance</span>
                    </div>
                    <h3 className="cinema-title">A moving portrait,<br/><span className="type-italic">in five seconds.</span></h3>
                    <p className="cinema-body">Generate a cinematic vertical video of you wearing this exact composition. Renders in 30–90 seconds.</p>
                    <button className="btn btn-block" onClick={generateVideo} disabled={sdLoading || !userPhoto}>
                      {sdLoading ? (
                        <>
                          <span className="loader"><span className="loader-dot"/><span className="loader-dot"/><span className="loader-dot"/></span>
                          <span>{sdStatus || "Rendering"}</span>
                        </>
                      ) : !userPhoto ? <span>Add Profile Photo First</span> : <span>Generate Video</span>}
                    </button>
                    {sdVideo && (
                      <div style={{marginTop: 16, border: "0.5px solid var(--ochre-deep)"}}>
                        <video src={sdVideo} controls autoPlay loop muted playsInline style={{width: "100%", display: "block"}}/>
                        <a href={sdVideo} download="vestia-look.mp4" target="_blank" rel="noopener"
                          style={{display: "block", padding: "12px", textAlign: "center", fontFamily: "var(--sans)", fontSize: 9, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--ochre-pale)", background: "var(--ink-soft)", textDecoration: "none", borderTop: "0.5px solid var(--graphite)"}}>
                          Download Video
                        </a>
                      </div>
                    )}
                    {sdError && <div style={{marginTop: 12, padding: "10px 14px", fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12, color: "var(--rust)", background: "rgba(160,74,46,.1)", border: "0.5px solid var(--rust)"}}>{sdError}</div>}
                  </div>
                </div>
              </div>
            )}

            {suggestion?.error && (
              <div className="section">
                <div style={{padding: "16px 18px", border: "0.5px solid var(--rust)", color: "var(--rust)", fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14, lineHeight: 1.5}}>
                  {suggestion.message || "Unable to generate. Try again."}
                </div>
              </div>
            )}

            {!suggestion && !loading && wardrobe.length < 2 && (
              <div className="section">
                <div className="empty">
                  <div className="empty-mark">◇</div>
                  <h3 className="empty-title">Begin with the wardrobe.</h3>
                  <p className="empty-body">Add at least two pieces — Vestia composes from what you have.</p>
                  <button className="btn" onClick={() => setTab("wardrobe")}>
                    <span>Build Wardrobe</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── WARDROBE ─── */}
        {tab === "wardrobe" && (
          <div className="fade-up">
            <div className="section">
              <div className="editorial-head">
                <div>
                  <div className="numeral">№ 02</div>
                  <h2 className="type-headline" style={{marginTop:6}}>The <span className="type-italic">Archive</span></h2>
                </div>
                <div style={{textAlign:"right"}}>
                  <div className="type-num" style={{fontSize:42,fontStyle:"italic"}}>{wardrobe.length}</div>
                  <div className="type-meta" style={{color:"var(--stone)"}}>Pieces</div>
                </div>
              </div>
            </div>

            <div className="pills">
              {CATS.map(cat => {
                const cnt = wardrobe.filter(i => i.categoryLabel === cat).length;
                return (
                  <button key={cat} onClick={() => { haptic(8); setActiveCat(cat); }} className={`pill${activeCat === cat ? " active" : ""}`}>
                    {cat}{cnt > 0 && <span className="pill-count">({cnt})</span>}
                  </button>
                );
              })}
            </div>

            <div className="section">
              <label className="upload">
                <input className="upload-input" type="file" accept="image/*" multiple onChange={e => handleClothingUpload(e.target.files)}/>
                <div className="upload-mark">{uploading ? "◌" : "+"}</div>
                <div className="upload-title">{uploading ? "Adding…" : `Add to ${activeCat.toLowerCase()}`}</div>
                <div className="upload-hint">Tap · Multiple OK</div>
              </label>

              {filtered.length > 0 ? (
                <div className="grid-2 stagger">
                  {filtered.map((item, i) => (
                    <div key={item.id} className="tile" onClick={() => { haptic(10); setSelectedItem(item); }}>
                      <div className="tile-image">
                        <img src={item.url} alt={item.name}/>
                      </div>
                      <div className="tile-meta">
                        <div className="tile-name">{item.name}</div>
                        <div className="tile-num">{item.wearCount}×</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty" style={{padding:"48px 0"}}>
                  <div className="empty-mark">∅</div>
                  <p className="type-italic" style={{fontSize:18,color:"var(--graphite)"}}>No {activeCat.toLowerCase()} yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── WEEK ─── */}
        {tab === "week" && (
          <div className="fade-up">
            <div className="section">
              <div className="editorial-head">
                <div>
                  <div className="numeral">№ 03</div>
                  <h2 className="type-headline" style={{marginTop:6}}>Seven days,<br/><span className="type-italic">composed.</span></h2>
                </div>
              </div>
            </div>

            {weather?.week && (
              <div style={{padding:"0 var(--s-5)"}}>
                <div className="forecast">
                  {weather.week.slice(0,7).map((d, i) => (
                    <div key={i} className="forecast-day">
                      <div className="forecast-name">{d.day}</div>
                      <div className="forecast-hi">{d.high}°</div>
                      <div className="forecast-lo">{d.low}°</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="section">
              <button className="btn btn-block btn-dark" onClick={getWeekPlan} disabled={loadingWeek}>
                {loadingWeek ? (
                  <>
                    <span className="loader"><span className="loader-dot"/><span className="loader-dot"/><span className="loader-dot"/></span>
                    <span>Planning</span>
                  </>
                ) : <span>Plan the Week</span>}
              </button>

              {weekPlan?.days?.map((d, i) => (
                <div key={i} className="day-card stagger">
                  <div>
                    <div className="day-head">
                      <div className="day-name">{d.day}</div>
                      <div className="day-mood">{d.mood}</div>
                    </div>
                    <div className="day-pieces">
                      {Object.values(d.outfit || {}).filter(Boolean).map((v, j, arr) => (
                        <span key={j}>
                          {v}{j < arr.length - 1 && <span className="sep">·</span>}
                        </span>
                      ))}
                    </div>
                    {d.note && <div className="day-note">— {d.note}</div>}
                  </div>
                </div>
              ))}

              {weekPlan?.philosophy && (
                <div className="mood-mark" style={{marginTop:32}}>
                  <div className="mood-sub" style={{marginBottom:12}}>The Week's Philosophy</div>
                  <p className="type-italic" style={{fontSize:20,lineHeight:1.5,color:"var(--graphite)"}}>{weekPlan.philosophy}</p>
                </div>
              )}

              {!weekPlan && !loadingWeek && (
                <div className="empty" style={{padding:"48px 0 0"}}>
                  <div className="empty-mark">◈</div>
                  <p className="type-italic" style={{fontSize:18,color:"var(--graphite)",marginBottom:8}}>Five pieces, minimum.</p>
                  <p className="type-caption">You have {wardrobe.length}.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── HISTORY ─── */}
        {tab === "history" && (
          <div className="fade-up">
            <div className="section">
              <div className="editorial-head">
                <div>
                  <div className="numeral">№ 04</div>
                  <h2 className="type-headline" style={{marginTop:6}}>The <span className="type-italic">Archive</span><br/>of looks.</h2>
                </div>
              </div>
            </div>

            <div className="section">
              {history.length > 0 ? (
                <div className="stagger">
                  {history.map((h, i) => (
                    <div key={i} className="day-card">
                      <div className="day-head">
                        <div className="day-name" style={{fontSize:24}}>{h.mood}</div>
                        <div style={{textAlign:"right"}}>
                          <div className="type-meta" style={{color:"var(--stone)",fontSize:9}}>
                            {new Date(h.date).toLocaleDateString("en", {month:"short",day:"numeric"})}
                          </div>
                          {h.weather && (
                            <div className="type-italic" style={{fontSize:11,color:"var(--ochre)",marginTop:2}}>
                              {h.weather.temp}° · {h.weather.label}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="day-pieces">
                        {Object.values(h.outfit || {}).filter(Boolean).map((v, j, arr) => (
                          <span key={j}>{v}{j < arr.length - 1 && <span className="sep">·</span>}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-mark">◌</div>
                  <h3 className="empty-title">The archive is empty.</h3>
                  <p className="empty-body">Compose your first look to begin.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── PROFILE ─── */}
        {tab === "profile" && (
          <div className="fade-up">
            <div className="section">
              <div className="editorial-head">
                <div>
                  <div className="numeral">№ 05</div>
                  <h2 className="type-headline" style={{marginTop:6}}>The <span className="type-italic">subject.</span></h2>
                </div>
              </div>
            </div>

            <div className="section">
              <label className="profile-photo-wrap" style={{cursor:"pointer", display:"block"}}>
                <input className="upload-input" type="file" accept="image/*" onChange={e => handleUserPhoto(e.target.files[0])}/>
                {userPhoto ? (
                  <img src={userPhoto.url} alt="You" className="profile-photo"/>
                ) : (
                  <div className="profile-placeholder">
                    <div className="profile-placeholder-mark">{uploading ? "◌" : "+"}</div>
                  </div>
                )}
              </label>
              <p className="text-center type-caption" style={{marginBottom:24}}>Tap to {userPhoto ? "change" : "upload"} · Used by AI for personalized videos</p>

              <div className="stats">
                <div className="stat">
                  <div className="stat-num">{wardrobe.length}</div>
                  <div className="stat-label">Pieces</div>
                </div>
                <div className="stat">
                  <div className="stat-num">{totalWears}</div>
                  <div className="stat-label">Wears</div>
                </div>
                <div className="stat">
                  <div className="stat-num">{history.length}</div>
                  <div className="stat-label">Looks</div>
                </div>
              </div>

              <div style={{marginBottom:24}}>
                <div className="divider"><span className="divider-label">Privacy</span></div>
                <p className="type-body" style={{color:"var(--graphite)",fontSize:15,lineHeight:1.6,marginBottom:16}}>
                  Your wardrobe, your photo, your history — all stored locally in this browser. Nothing syncs. Nothing tracks.
                </p>
                <button className="btn-text" onClick={clearAllData} style={{color:"var(--rust)"}}>
                  Clear all data →
                </button>
              </div>

              <div style={{marginBottom:24}}>
                <div className="divider"><span className="divider-label">Weather</span></div>
                <p className="type-body" style={{color:"var(--graphite)",fontSize:15,marginBottom:8}}>
                  {weather ? <><span className="type-italic">{weather.label}</span> · {weather.temp}°C · {locationName || "Live"}</> : "Locating..."}
                </p>
                <button className="btn-text" onClick={getLocation}>Refresh location →</button>
              </div>

              <div>
                <div className="divider"><span className="divider-label">Powered By</span></div>
                <div className="type-body" style={{color:"var(--graphite)",fontSize:14,lineHeight:1.7}}>
                  <div style={{marginBottom:6}}><span className="numeral">i.</span> Anthropic Claude — Style intelligence</div>
                  <div style={{marginBottom:6}}><span className="numeral">ii.</span> ByteDance Seedance — Cinematic video</div>
                  <div><span className="numeral">iii.</span> Open-Meteo — Real-time weather</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{height: 80}}/>

        {/* MODAL */}
        {selectedItem && (
          <div className="modal-backdrop" onClick={() => setSelectedItem(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
                <div className="numeral">Item details</div>
                <button onClick={() => setSelectedItem(null)} style={{fontFamily:"var(--serif)",fontStyle:"italic",fontSize:24,color:"var(--ink)",lineHeight:1}}>×</button>
              </div>
              <img src={selectedItem.url} alt={selectedItem.name} style={{width:"100%",aspectRatio:"3/4",objectFit:"cover",marginBottom:20,border:"0.5px solid var(--ash)"}}/>
              <h3 className="type-title type-italic" style={{marginBottom:12}}>{selectedItem.name}</h3>
              <div className="composition-row">
                <span className="composition-num">i.</span>
                <span className="composition-label">Category</span>
                <span className="composition-name">{selectedItem.categoryLabel}</span>
              </div>
              <div className="composition-row">
                <span className="composition-num">ii.</span>
                <span className="composition-label">Worn</span>
                <span className="composition-name">{selectedItem.wearCount} times</span>
              </div>
              {selectedItem.lastWorn && (
                <div className="composition-row">
                  <span className="composition-num">iii.</span>
                  <span className="composition-label">Last</span>
                  <span className="composition-name">{selectedItem.lastWorn}</span>
                </div>
              )}
              <div style={{marginTop:24}}>
                <button className="btn btn-block" onClick={() => removeItem(selectedItem)} style={{borderColor:"var(--rust)",color:"var(--rust)"}}>
                  <span>Remove from wardrobe</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
