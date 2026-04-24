# VESTIA — Personal Style Intelligence

A luxury AI-powered personal stylist. Premium design, IndexedDB storage, PWA-ready, mobile-first.

---

## 🚀 Quick Deploy to Netlify (15 minutes total)

### Step 1: Get your API keys (5 min)

You need **2 free API keys**:

**A) Anthropic Claude key** → https://console.anthropic.com/settings/keys
- Sign up (free), get $5 free credit
- Create key, copy it (starts with `sk-ant-...`)

**B) fal.ai key** → https://fal.ai/dashboard/keys
- Sign up (free), get free credits
- Create key, copy it (starts with `fal-...` or similar)

### Step 2: Deploy to Netlify (5 min)

**Option A — Drag & Drop (easiest):**

1. Open a terminal in this folder
2. Run these commands:
   ```bash
   npm install
   npm run build
   ```
3. Go to **https://app.netlify.com/drop**
4. Drag the entire **project folder** (not just `dist/` — Netlify needs the `netlify/` folder for functions)

Wait — Netlify Drop only works for static sites, not functions. **Use Option B for functions.**

**Option B — Git-based deploy (required for functions):**

1. Create a free GitHub account if you don't have one
2. Create a new repo at https://github.com/new (call it "vestia", make it public or private)
3. In your terminal:
   ```bash
   cd vestia
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR-USERNAME/vestia.git
   git branch -M main
   git push -u origin main
   ```
4. Go to https://app.netlify.com/start
5. Click **"Import an existing project"** → choose GitHub → select your repo
6. Build settings auto-detect from `netlify.toml` — just click **"Deploy"**

### Step 3: Add your API keys to Netlify (3 min)

1. After deploy, go to your Netlify site dashboard
2. **Site settings → Environment variables → Add a variable**
3. Add these two:
   - Key: `ANTHROPIC_API_KEY` → Value: your `sk-ant-...` key
   - Key: `FAL_KEY` → Value: your fal key
4. Go to **Deploys → Trigger deploy → Deploy site**

### Step 4: Done! (2 min)

- Open your Netlify URL on your phone
- Tap "Add to Home Screen" to install as a PWA
- Build your wardrobe → generate outfits → generate AI videos

---

## 📦 Project Structure

```
vestia/
├── src/
│   ├── Vestia.jsx          # Main app component
│   ├── main.jsx            # Entry point
│   └── index.css           # Global styles
├── netlify/
│   └── functions/
│       ├── fal-proxy.mjs   # Secure fal.ai proxy
│       └── claude.mjs      # Secure Claude API proxy
├── public/
│   ├── manifest.json       # PWA manifest
│   ├── favicon.svg
│   ├── _redirects          # SPA routing
│   └── _headers            # Security headers
├── index.html
├── package.json
├── vite.config.js
├── netlify.toml
└── README.md
```

---

## 🧠 Features

- ✨ **AI outfit suggestions** — Claude analyzes your wardrobe + live weather
- 📅 **7-day outfit planning** — never repeats the same item more than twice
- 🎬 **AI video generation** — Seedance creates a cinematic 5-sec video of you in the suggested outfit
- 🌍 **Real GPS weather** via Open-Meteo (free, no key)
- 💾 **IndexedDB storage** — handles unlimited wardrobe photos locally
- 📸 **Smart compression** — photos auto-resized to 1200px @ 85% quality
- 📱 **PWA installable** — add to home screen, works like a native app
- 🤲 **Haptic feedback** on every tap
- 🎨 **Luxury editorial design** — Cormorant Garamond + Tenor Sans, dark obsidian palette
- 🔒 **Privacy-first** — wardrobe never leaves your device

---

## 💰 Cost Per User

**Per outfit suggestion:** ~$0.005 (Claude API)
**Per AI video:** ~$0.18 (Seedance Lite, 5sec @ 720p)
**Hosting:** $0 (Netlify free tier)
**Weather:** $0 (Open-Meteo free)

A casual user generating 1 outfit + 1 video per day = ~$5–6/month per user.

---

## 🛠 Local Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. **Note:** Functions only work after deploying to Netlify (or use `netlify dev` if you install Netlify CLI).

For local function testing:
```bash
npm install -g netlify-cli
netlify dev
```
Then add a `.env` file with your `ANTHROPIC_API_KEY` and `FAL_KEY`.

---

## 🔧 Troubleshooting

**"Generation failed" or "API error 500":**
→ Check Netlify dashboard → Site settings → Environment variables. Make sure `ANTHROPIC_API_KEY` and `FAL_KEY` are set, then redeploy.

**"FAL_KEY not configured":**
→ Same as above — environment variable missing.

**"Add profile photo first":**
→ Go to Profile tab → tap the avatar → upload a photo of yourself. This is required for video generation.

**Video takes longer than 2 minutes:**
→ Normal during peak hours. Seedance can take 30 seconds to 3 minutes depending on queue.

**Photos won't upload on mobile:**
→ This is fixed in the latest version. If still happens, make sure you're on the deployed Netlify URL (not a Claude artifact iframe).

---

## 🔒 Privacy & Security

- ✅ Wardrobe photos stored only in your browser (IndexedDB)
- ✅ API keys live only on Netlify's servers (never sent to browser)
- ✅ Photos sent to Claude/Seedance for processing aren't stored by them long-term
- ✅ No analytics, no tracking, no third-party scripts
- ✅ "Clear All Data" button in Profile wipes everything instantly

---

## 📄 License

MIT — your app, your rules.
