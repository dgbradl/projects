# SwingCoach (web) 🏌️

Describe what your golf shot did — contact, start line, curve, trajectory — and get an instant diagnosis of the likely swing fault, with fixes and practice drills. A self-hostable PWA: open it on your phone, add it to your home screen, and it behaves like an app.

Built on the **ball flight laws**: the ball starts roughly where the clubface points at impact and curves away from the swing path, so from what you saw the ball do, the app works backward to what your swing was doing.

## What's in it

- **New Shot** — tap through what happened and get a diagnosis: what happened at impact, likely causes ranked, what to work on, and drills with instructions.
- **History** — shots are saved in the browser (localStorage); tap to re-read a diagnosis.
- **Trends** — after a few shots, shows your most common miss and where practice time pays off.
- **Settings** — left/right-handed support and an optional AI coach.
- **Works offline** — a service worker caches the app, so it keeps working with no signal on the course (everything except the AI coach).

No build step, no dependencies, no server code — plain HTML/CSS/JS.

## Google sign-in (one-time setup)

The app is gated behind Google sign-in, restricted to the emails listed in `auth.js` (`AUTH_CONFIG.allowedEmails`). Before first deploy you need a Google OAuth client ID:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: set it up as **External**, fill in the app name and your email. You can leave it in "Testing" mode — just add both allowed Gmail addresses as **test users** (Testing mode caps you at 100 test users, which is plenty here, and never needs Google review).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://yoursite.com` (add `http://localhost:8000` too if you want to test locally)
4. Copy the client ID (looks like `1234567890-abc123.apps.googleusercontent.com`) into `clientId` in `auth.js`.

Sign-in is remembered for 30 days per device (renewed on every visit), so day-to-day you go straight into the app — including offline. Sign out from the Settings tab. To change who's allowed, edit `allowedEmails` in `auth.js` and redeploy.

### What this does and doesn't protect

This is a **client-side gate**: it stops anyone who isn't allowlisted from using the app, which is the right level of protection for a personal tool — there's nothing sensitive in the files themselves, and all shot data lives in each user's own browser, not on the server. A determined person could still fetch the raw JS/CSS from the server directly.

If you ever want hard, server-enforced access control instead, put [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) in front of the directory (nginx `auth_request` + `--email-domain`/`--authenticated-emails-file` with the same two addresses), or if the site is behind Cloudflare, use Cloudflare Access with a Google login policy — both give you real authentication before a single byte is served, with no changes to the app.

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
auth.js               Google sign-in gate — client ID + allowed emails live here
sw.js                 Service worker (offline cache) — bump CACHE_VERSION on deploy
manifest.webmanifest  PWA manifest ("Add to Home Screen")
icon-*.png            App icons
```
