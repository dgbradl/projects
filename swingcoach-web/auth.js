/* Google sign-in gate, enforced server-side.
 *
 * The Google credential is sent to api.php, which verifies it with Google
 * (audience, verified email) and checks the allowlist in config.php — the
 * allowlist lives ONLY on the server. On success the server issues an opaque
 * session token with a sliding 30-day expiry; every data/AI request requires
 * it, so the gate is real access control, not just a hidden UI.
 *
 * Setup (one-time): create an OAuth client ID in Google Cloud Console and
 * paste it below AND into config.php on the server. Full steps in README.md.
 */

const AUTH_CONFIG = {
  // From console.cloud.google.com → APIs & Services → Credentials.
  // Looks like: 1234567890-abc123.apps.googleusercontent.com
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
};

const STORAGE_AUTH = 'swingcoach.auth';

/* Session shape: {token, email, expires (ms), ai (bool)} — issued by api.php. */
function getAuth() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_AUTH) || 'null');
    if (!s || !s.token || !s.expires || Date.now() > s.expires) return null;
    return s;
  } catch { return null; }
}

function clearAuth() {
  localStorage.removeItem(STORAGE_AUTH);
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function handleCredential(response) {
  showAuthError('Checking with the server…');
  try {
    const res = await fetch('api.php', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'login', credential: response.credential }),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) {
      throw new Error((json && json.error) || 'Sign-in failed (HTTP ' + res.status + ')');
    }
    localStorage.setItem(STORAGE_AUTH, JSON.stringify(json));
    unlockApp(json.email);
    if (typeof window.onSignedIn === 'function') window.onSignedIn();
  } catch (err) {
    showAuthError(err.message || String(err));
  }
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

function authSignOut() {
  const auth = getAuth();
  const finish = () => {
    clearAuth();
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
    location.reload();
  };
  if (auth && navigator.onLine) {
    // Best-effort server-side invalidation; sign out locally regardless.
    fetch('api.php', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'logout', token: auth.token }),
    }).catch(() => {}).finally(finish);
  } else {
    finish();
  }
}

/* ------------------------------------------------------------------- init */

(function initAuth() {
  const session = getAuth();
  if (session) {
    // Valid stored session: open straight into the app (works offline too).
    // The server renews the session on every authorized call; app.js mirrors
    // the sliding expiry locally.
    unlockApp(session.email);
  } else {
    showGate();
  }
  const signOutBtn = document.getElementById('sign-out-btn');
  if (signOutBtn) signOutBtn.addEventListener('click', authSignOut);
})();
