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
