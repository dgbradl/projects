/* Google sign-in gate.
 *
 * This is CLIENT-SIDE access control: it keeps the app UI behind a Google
 * login for the allowlisted emails below. Because this is a static site, a
 * determined person could still fetch the raw files — see the README for
 * server-side enforcement options if you ever need that. All shot data lives
 * in each signed-in user's own browser either way.
 *
 * Setup (one-time): create an OAuth client ID in Google Cloud Console and
 * paste it below. Full steps in README.md.
 */

const AUTH_CONFIG = {
  // From console.cloud.google.com → APIs & Services → Credentials.
  // Looks like: 1234567890-abc123.apps.googleusercontent.com
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',

  allowedEmails: [
    'dgbradl@gmail.com',
    'jacksoncooperbradl@gmail.com',
  ],

  // How long a sign-in is remembered on this device. Renewed on every visit,
  // so it only expires after this long *away* from the app.
  sessionDays: 30,
};

const STORAGE_AUTH = 'swingcoach.auth';

function authSession() {
  try {
    const raw = localStorage.getItem(STORAGE_AUTH);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.email || !s.expires || Date.now() > s.expires) return null;
    if (!isAllowed(s.email)) return null; // allowlist may have changed
    return s;
  } catch { return null; }
}

function isAllowed(email) {
  return AUTH_CONFIG.allowedEmails.some(e => e.toLowerCase() === String(email).toLowerCase());
}

function saveAuthSession(email) {
  localStorage.setItem(STORAGE_AUTH, JSON.stringify({
    email,
    expires: Date.now() + AUTH_CONFIG.sessionDays * 24 * 60 * 60 * 1000,
  }));
}

function authSignOut() {
  localStorage.removeItem(STORAGE_AUTH);
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  location.reload();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* Decode the payload of a Google ID token (JWT). No signature verification —
 * that would require Google's certs and adds nothing here, since client-side
 * checks are bypassable by design. The gate's job is the allowlist. */
function decodeJwtPayload(token) {
  const part = token.split('.')[1];
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

function handleCredential(response) {
  let payload;
  try {
    payload = decodeJwtPayload(response.credential);
  } catch {
    showAuthError('Could not read the sign-in response. Try again.');
    return;
  }
  if (!payload.email || payload.email_verified !== true) {
    showAuthError('This Google account has no verified email.');
    return;
  }
  if (!isAllowed(payload.email)) {
    showAuthError(payload.email + ' is not on the allowed list for this app.');
    return;
  }
  saveAuthSession(payload.email);
  unlockApp(payload.email);
}

function unlockApp(email) {
  document.getElementById('auth-gate').classList.add('hidden');
  const who = document.getElementById('signed-in-as');
  if (who) who.textContent = 'Signed in as ' + email;
}

function showGate() {
  document.getElementById('auth-gate').classList.remove('hidden');

  if (AUTH_CONFIG.clientId.startsWith('YOUR_CLIENT_ID')) {
    showAuthError('Setup needed: paste your Google OAuth client ID into auth.js (see README).');
    return;
  }

  // Load Google Identity Services only when we actually need the login UI.
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    google.accounts.id.initialize({
      client_id: AUTH_CONFIG.clientId,
      callback: handleCredential,
      auto_select: true,
    });
    google.accounts.id.renderButton(document.getElementById('gsi-button'), {
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
    });
  };
  script.onerror = () => {
    showAuthError('Could not reach Google sign-in. Are you online? The app needs a connection for the first sign-in; after that it works offline.');
  };
  document.head.appendChild(script);
}

/* ------------------------------------------------------------------- init */

(function initAuth() {
  const session = authSession();
  if (session) {
    // Sliding renewal: signing in once keeps working as long as the app is
    // opened at least every AUTH_CONFIG.sessionDays.
    saveAuthSession(session.email);
    unlockApp(session.email);
  } else {
    showGate();
  }
  const signOutBtn = document.getElementById('sign-out-btn');
  if (signOutBtn) signOutBtn.addEventListener('click', authSignOut);
})();
