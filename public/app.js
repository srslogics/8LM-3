let mode = 'login';
const $ = id => document.getElementById(id);
async function request(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}
function renderUser(user) { $('auth').hidden = Boolean(user); $('account').hidden = !user; $('account-email').textContent = user?.email || ''; $('password').value = ''; $('status').textContent = ''; document.body.classList.toggle('signed-in', Boolean(user)); if (user) window.dispatchEvent(new Event('signed-in')); }
$('switch').onclick = () => { mode = mode === 'login' ? 'signup' : 'login'; const signup = mode === 'signup'; $('heading').textContent = signup ? 'Create an account' : 'Log in'; $('intro').textContent = signup ? 'Your email and a password are all you need.' : 'Enter your email and password.'; $('submit').textContent = signup ? 'Create account' : 'Log in'; $('switch-label').textContent = signup ? 'Already have an account?' : 'New to 8LM?'; $('switch').textContent = signup ? 'Log in' : 'Create an account'; $('password').autocomplete = signup ? 'new-password' : 'current-password'; $('password').minLength = signup ? 12 : 1; $('hint').hidden = !signup; $('status').textContent = ''; document.body.classList.toggle('signed-in', Boolean(user)); if (user) window.dispatchEvent(new Event('signed-in')); };
$('show').onclick = () => { const visible = $('password').type === 'password'; $('password').type = visible ? 'text' : 'password'; $('show').textContent = visible ? 'Hide' : 'Show'; $('show').setAttribute('aria-label', visible ? 'Hide password' : 'Show password'); $('show').setAttribute('aria-pressed', String(visible)); };
$('form').onsubmit = async event => { event.preventDefault(); $('submit').disabled = true; $('switch').disabled = true; $('status').textContent = 'Please wait…'; try { const data = await request(`/api/auth/${mode}`, { email: $('email').value, password: $('password').value }); renderUser(data.user); } catch(e) { $('status').textContent = e.message; } finally { $('submit').disabled = false; $('switch').disabled = false; } };
$('logout').onclick = async () => { try { await request('/api/logout', {}); renderUser(null); } catch(e) { $('status').textContent = e.message; } };
request('/api/me').then(data => renderUser(data.user)).catch(() => { $('status').textContent = 'Could not connect. Please refresh and try again.'; });
