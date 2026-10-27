const form = document.querySelector('#login-form');
const identity = document.querySelector('#identity');
const password = document.querySelector('#password');
const toggle = document.querySelector('#password-toggle');
const status = document.querySelector('#form-status');

document.querySelector('#year').textContent = new Date().getFullYear();

toggle.addEventListener('click', () => {
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  toggle.textContent = visible ? 'Hide' : 'Show';
  toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  toggle.setAttribute('aria-pressed', String(visible));
});

identity.addEventListener('input', () => identity.setCustomValidity(''));
form.addEventListener('input', () => { status.textContent = ''; });
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!identity.value.trim()) {
    identity.setCustomValidity('Please enter your username or email.');
    identity.reportValidity();
    return;
  }
  // Connect the authentication service here. Never store passwords in the browser.
  status.textContent = 'Login is not connected yet. Please try again once account sign-in is available.';
});

const connectionStatus = document.querySelector('#connection-status');
const authMessages = {
  not_configured: 'Google sign-in is not configured yet. Please contact the app owner.',
  sign_in_first: 'Sign in before connecting Google Ads.',
  invalid_state: 'Your sign-in link expired. Please try again.',
  cancelled: 'Google authorization was cancelled. You can try again.',
  failed: 'Google sign-in could not be completed. Please try again.',
  wrong_account: 'Connect Ads using the same Google account you used to sign in.',
  ads_denied: 'Google Ads permission was not granted. Please reconnect and allow access.'
};
const authError = new URLSearchParams(location.search).get('auth');
if (authError) { connectionStatus.textContent = authMessages[authError] || 'Please try signing in again.'; history.replaceState({}, '', '/'); }
let csrfToken;
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}
async function loadAccounts(selected) {
  const container = document.querySelector('#ads-accounts');
  container.textContent = 'Loading accounts…';
  try {
    const { accounts } = await api('/api/ads/accounts');
    container.replaceChildren();
    if (!accounts.length) { container.textContent = 'No directly accessible Google Ads accounts were found for this Google account.'; return; }
    const label = document.createElement('label');
    label.htmlFor = 'ads-account'; label.textContent = 'Google Ads account';
    const select = document.createElement('select'); select.id = 'ads-account';
    for (const account of accounts) {
      const option = document.createElement('option'); option.value = account.id; option.textContent = account.id; select.append(option);
    }
    if (selected && accounts.some(a => a.id === selected)) select.value = selected;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'submit'; button.textContent = 'Use this account';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api('/api/ads/select', { id: select.value }); connectionStatus.textContent = `Google Ads account ${select.value} selected.`; }
      catch (error) { connectionStatus.textContent = error.message; }
      finally { button.disabled = false; }
    });
    container.append(label, select, button);
    if (selected && !authError) connectionStatus.textContent = `Google Ads account ${selected} selected.`;
  } catch (error) {
    container.textContent = error.message;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button'; retry.textContent = 'Try again'; retry.addEventListener('click', () => loadAccounts(selected)); container.append(retry);
  }
}
async function initSession() {
  try {
    const state = await api('/api/session'); csrfToken = state.csrf;
    if (!state.user) return;
    document.querySelector('#login-content').hidden = true;
    document.querySelector('#account-content').hidden = false;
    document.querySelector('#login-title').textContent = 'Your Google Ads';
    document.querySelector('.subtitle').hidden = true;
    document.querySelector('#signed-in-email').textContent = state.user.email;
    if (state.adsConnected) { document.querySelector('#connect-ads').textContent = 'Reconnect Google Ads'; await loadAccounts(state.selectedAccount); }
  } catch { connectionStatus.textContent = 'Could not check your session. Please refresh the page.'; }
}
document.querySelector('#logout').addEventListener('click', async () => {
  try { await api('/api/logout', {}); location.assign('/'); }
  catch (error) { connectionStatus.textContent = error.message; }
});
initSession();
