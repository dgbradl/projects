# SwingCoach (web) 🏌️

Describe what your golf shot did — contact, start line, curve, trajectory — and get an instant diagnosis of the likely swing fault, with fixes and practice drills. This is the web/PWA version of the SwingCoach iOS app in this repo: same diagnosis engine, no sideloading, no 7-day expiry.

Built on the **ball flight laws**: the ball starts roughly where the clubface points at impact and curves away from the swing path, so from what you saw the ball do, the app works backward to what your swing was doing.

## What's in it

- **New Shot** — tap through what happened and get a diagnosis: what happened at impact, likely causes ranked, what to work on, and drills with instructions.
- **History** — shots are saved in the browser (localStorage); tap to re-read a diagnosis.
- **Trends** — after a few shots, shows your most common miss and where practice time pays off.
- **Settings** — left/right-handed support and an optional AI coach.
- **Works offline** — a service worker caches the app, so it keeps working with no signal on the course (everything except the AI coach).

No build step, no dependencies, no server code — plain HTML/CSS/JS.

## Deploy

Copy this directory to anywhere your web server serves static files:

```sh
rsync -av swingcoach-web/ you@yourserver:/var/www/yoursite/swingcoach/
```

Then open `https://yoursite/swingcoach/` on your phone.

Two requirements:

- **HTTPS** (or localhost) — service workers won't register on plain HTTP, so offline mode and "Add to Home Screen" need TLS. Any Let's Encrypt setup is fine.
- Serve the files as-is; all paths are relative, so any subdirectory works.

**On your iPhone:** open the URL in Safari → Share → **Add to Home Screen**. You get an icon and a full-screen, app-like launch.

### Updating

Shot history lives in the browser, so redeploys never touch it. The service worker caches aggressively — when you change the app, bump `CACHE_VERSION` in `sw.js` (e.g. `swingcoach-v2`) so phones pick up the new files on next load.

## Optional: AI coach

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. Paste it in the app's **Settings** tab.
3. Each diagnosis gains a **"Get personalized AI advice"** button that sends your shot description (including free-text notes) to Claude.

The key is stored in the browser's localStorage and sent only to Anthropic's API, directly from the browser (via Anthropic's CORS opt-in header). That's a reasonable setup for a personal app on your own devices — but anyone with access to the browser profile could read the key, so use a key with a spending limit and don't paste it on shared machines. If you ever want the key server-side instead, the `askAI()` function in `app.js` is the one place to swap in a proxy endpoint.

## Files

```
index.html            App shell and markup
app.css               Styles (dark-mode aware, mobile-first)
engine.js             Ball-flight-laws diagnosis engine + drill library
app.js                State, tabs, rendering, storage, AI call
sw.js                 Service worker (offline cache) — bump CACHE_VERSION on deploy
manifest.webmanifest  PWA manifest ("Add to Home Screen")
icon-*.png            App icons
```
