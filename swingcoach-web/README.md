# SwingCoach (web) 🏌️

Describe what your golf shot did — contact, start line, curve, trajectory — and get an instant diagnosis of the likely swing fault, with fixes and practice drills. A self-hostable PWA with a small PHP + MySQL backend (built for DreamHost shared hosting): sign in with Google, and your shot history follows you across devices.

Built on the **ball flight laws**: the ball starts roughly where the clubface points at impact and curves away from the swing path, so from what you saw the ball do, the app works backward to what your swing was doing.

## What's in it

- **Shot logging, two speeds** — Detailed mode walks through contact/start/curve/trajectory and returns a full diagnosis (impact physics, ranked causes, fixes, drills). Quick mode is two taps (club + outcome) with an undo toast, built for on-course pace; quick shots feed the same trends and charts.
- **Rounds (digital scorecard)** — start a 9- or 18-hole round at a named course, tap in par and strokes per hole, and get live totals and to-par. Past rounds are listed by date and course with your best score per course. Works offline mid-round and syncs when you're back on signal.
- **History with sessions** — shots are stored in MySQL keyed to your Google account, and grouped automatically into range sessions/rounds (shots more than 3 hours apart start a new session), each with a flush-rate summary.
- **Fix tracking** — mark any diagnosed miss as your current focus and the app measures how often it shows up before vs. after ("Big slice: 45% → 20%"), synced across your devices. Past fixes keep their before/after record.
- **Progress charts** — flush rate per session, with your tracked miss overlaid, drawn on a dependency-free canvas.
- **Range plans** — one tap generates a drill prescription for your focus (or top miss), sized for a bucket of balls, with tap-to-check items and a tracked-shots finisher.
- **Practice priority** — the Practice tab ranks your recurring misses so range time goes where strokes leak.
- **Offline-first** — the app shell is cached by a service worker and shots save locally first, so everything works with no signal on the course; changes queue up and sync to the server when you're back online.
- **Google sign-in, enforced server-side** — only the emails allowlisted in `config.php` can log in or touch any data.
- **Optional AI coach** — the Anthropic API key lives in `config.php` on the server, never in the browser; the API proxies the calls.

Front end is plain HTML/CSS/JS (no build step); back end is a single `api.php` (no framework, no composer).

## Setup

### 1. Google OAuth client ID (one-time, ~5 min)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: set it up as **External**, fill in the app name and your email. Leave it in "Testing" mode — just add both allowed Gmail addresses as **test users** (Testing mode never needs Google review).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://yoursite.com` (add `http://localhost:8000` too if you want to test locally)
4. Copy the client ID (looks like `1234567890-abc123.apps.googleusercontent.com`). It goes in **two places**: `clientId` in `auth.js`, and `GOOGLE_CLIENT_ID` in `config.php`.

### 2. MySQL database (DreamHost panel, ~2 min)

1. In the DreamHost panel: **Websites → MySQL Databases**.
2. Create a hostname if you don't have one (e.g. `mysql.yoursite.com`).
3. **Add New Database**: name it (e.g. `swingcoach`), create a user and password.
4. That's all — the API creates its own tables on first request.

### 3. Configure and deploy

```sh
cp config.sample.php config.php
# edit config.php: DB credentials from step 2, client ID from step 1,
# the allowed emails, and optionally an Anthropic API key for the AI coach

rsync -av --exclude '.git' ./ you@yourserver:/home/you/yoursite.com/swingcoach/
```

Any directory your domain serves works — DreamHost runs PHP there natively. Requirements are just PHP 8+ with curl (DreamHost's default) and HTTPS (service workers and Google sign-in need it; DreamHost's free Let's Encrypt cert is fine).

**Never commit `config.php`** — it's gitignored because it holds the DB password and (optionally) the Anthropic key.

**On your iPhone:** open `https://yoursite.com/swingcoach/` in Safari → Share → **Add to Home Screen**. Sign in once with Google; the session lasts 30 days per device with sliding renewal (it only expires after 30 days *away*), so day-to-day it opens straight into the app — including offline.

### Updating later

After pushing new files, bump `CACHE_VERSION` in `sw.js` (v4 → v5, …) so phones drop the old cached app shell. Shot data is in MySQL and is never touched by redeploys.

## Optional: AI coach

Put an Anthropic API key (from [console.anthropic.com](https://console.anthropic.com)) in `ANTHROPIC_API_KEY` in `config.php`. Every diagnosis then gains a **"Get personalized AI advice"** button; the server builds the prompt and calls Claude, so the key never reaches any browser. Leave it `''` to disable — everything else works without it.

## How auth works (and what it protects)

- Signing in sends your Google credential to `api.php`, which verifies it with Google (right app, verified email) and checks the allowlist in `config.php` — the server is the only authority; there is no allowlist in the browser code.
- On success the server issues an opaque session token (30-day sliding expiry, stored in MySQL). Every data/AI request requires it, and all shots are scoped to the signed-in account — the API enforces per-account isolation, which the test suite covers (one account can't read, overwrite, or delete another's shots).
- Sign out (Settings tab) invalidates the session server-side.

The static app-shell files (HTML/CSS/JS) are still publicly fetchable — they contain no secrets and no data. If you ever want even those behind auth, put [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) or Cloudflare Access in front of the directory.

## Files

```
index.html            App shell and markup
app.css               Styles (dark-mode aware, mobile-first)
engine.js             Ball-flight-laws diagnosis engine + drill library
auth.js               Google sign-in UI — client ID lives here
app.js                State, tabs, rendering, offline sync queue, API calls
api.php               Backend: session auth, shot storage, AI proxy
config.sample.php     Copy to config.php and fill in (config.php is gitignored)
sw.js                 Service worker (offline cache) — bump CACHE_VERSION on deploy
manifest.webmanifest  PWA manifest ("Add to Home Screen")
icon-*.png            App icons
```

## Local development

```sh
cp config.sample.php config.php   # use DB_HOST 'sqlite:/tmp/swingcoach.sqlite' for a quick local DB
php -S localhost:8000
```

The API's integration tests (login paths, CRUD, account isolation, session lifecycle) run against SQLite with a stubbed Google endpoint — see the repo history for the harness.
