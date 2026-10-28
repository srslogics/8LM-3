/* app.js – auth + shell toggle */
let mode = 'login';
const $ = id => document.getElementById(id);

/* ── Toast ───────────────────────────────────────── */
let toastTimer;
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 4000);
}

/* ── Fetch helper ────────────────────────────────── */
async function request(path, body) {
  const response = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}

/* ── Render signed-in / signed-out state ─────────── */
function renderUser(user) {
  $('auth-screen').hidden = Boolean(user);
  $('app-shell').hidden   = !user;
  $('password').value     = '';
  $('status').textContent = '';

  if (user) {
    $('nav-email').textContent = user.email;
    $('nav-avatar').textContent = (user.email[0] || '?').toUpperCase();
    window.dispatchEvent(new Event('signed-in'));
  }
}

/* ── Auth mode toggle ────────────────────────────── */
$('switch').onclick = () => {
  mode = mode === 'login' ? 'signup' : 'login';
  const signup = mode === 'signup';
  $('heading').textContent       = signup ? 'Create an account' : 'Log in';
  $('intro').textContent         = signup ? 'Your email and a password are all you need.' : 'Use your 8LM account to continue';
  $('submit').textContent        = signup ? 'Create account' : 'Sign in';
  $('switch-label').textContent  = signup ? 'Already have an account?' : 'New to 8LM?';
  $('switch').textContent        = signup ? 'Sign in' : 'Create an account';
  $('password').autocomplete     = signup ? 'new-password' : 'current-password';
  $('password').minLength        = signup ? 12 : 1;
  $('hint').hidden               = !signup;
  $('status').textContent        = '';
};

/* ── Show / hide password ────────────────────────── */
$('show').onclick = () => {
  const visible = $('password').type === 'password';
  $('password').type = visible ? 'text' : 'password';
  $('show').textContent = visible ? 'Hide' : 'Show';
  $('show').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  $('show').setAttribute('aria-pressed', String(visible));
};

/* ── Submit ──────────────────────────────────────── */
$('form').onsubmit = async event => {
  event.preventDefault();
  await initialSession;
  $('submit').disabled = true;
  $('switch').disabled = true;
  $('status').textContent = '';
  try {
    const data = await request(`/api/auth/${mode}`, {
      email: $('email').value,
      password: $('password').value,
    });
    renderUser(data.user);
  } catch (e) {
    $('status').textContent = e.message;
    $('status').className = '';
  } finally {
    $('submit').disabled = false;
    $('switch').disabled = false;
  }
};

/* ── Logout ──────────────────────────────────────── */
$('nav-signout-btn').onclick = async () => {
  try {
    await request('/api/logout', {});
    renderUser(null);
  } catch (e) {
    toast(e.message, 'error');
  }
};

/* ── Boot: check session ─────────────────────────── */
const initialSession = request('/api/me')
  .then(data => renderUser(data.user))
  .catch(() => { $('status').textContent = 'Could not connect. Please refresh and try again.'; });
