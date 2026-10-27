import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('OAuth sign-in, Ads consent, account authorization and logout', async () => {
  let options;
  let scope = '';
  const mock = {
    generateCodeVerifierAsync: async () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' }),
    generateAuthUrl: value => { options = value; scope = value.scope.join(' '); return `https://accounts.google.com/o/oauth2/v2/auth?state=${value.state}`; },
    getToken: async value => { assert.equal(value.codeVerifier, 'verifier'); return { tokens: { id_token: 'identity', access_token: 'SECRET_TOKEN', scope } }; },
    verifyIdToken: async () => ({ getPayload: () => ({ sub: 'user1', email: 'test@example.com', email_verified: true, nonce: options.nonce }) }),
    setCredentials() {}, on() {}, request: async () => ({ data: { resourceNames: ['customers/1234567890'] } })
  };
  const app = createApp({ GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'secret', APP_ORIGIN: 'http://localhost:8000' }, () => mock);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  let cookie = '';
  const call = async (path, body, csrf, origin = 'http://localhost:8000') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual', headers: { cookie, ...(body ? { 'Content-Type': 'application/json', Origin: origin, 'X-CSRF-Token': csrf || '' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  try {
    assert.equal((await call('/.env')).status, 404);
    assert.equal((await call('/api/ads/accounts')).status, 401);
    assert.match((await call('/auth/google/callback?state=bad')).headers.get('location'), /invalid_state/);
    await call('/auth/google');
    assert.equal(options.code_challenge_method, 'S256');
    assert.equal(options.scope.includes('https://www.googleapis.com/auth/adwords'), false);
    let state = options.state;
    assert.equal((await call(`/auth/google/callback?code=ok&state=${state}`)).headers.get('location'), '/');
    let session = await (await call('/api/session')).json();
    assert.equal(session.user.email, 'test@example.com');
    assert.equal((await call('/api/ads/accounts')).status, 403);
    await call('/auth/google?connect=ads'); state = options.state;
    assert.equal(options.access_type, 'offline');
    await call(`/auth/google/callback?code=ok&state=${state}`);
    assert.match((await call(`/auth/google/callback?code=ok&state=${state}`)).headers.get('location'), /invalid_state/);
    session = await (await call('/api/session')).json();
    assert.equal(session.adsConnected, true);
    assert.equal(JSON.stringify(session).includes('SECRET_TOKEN'), false);
    assert.equal((await (await call('/api/ads/accounts')).json()).accounts[0].id, '1234567890');
    assert.equal((await call('/api/ads/select', { id: '1234567890' })).status, 403);
    assert.equal((await call('/api/ads/select', { id: '1234567890' }, session.csrf, 'https://evil.example')).status, 403);
    assert.equal((await call('/api/ads/select', { id: '999' }, session.csrf)).status, 400);
    assert.equal((await call('/api/ads/select', { id: '1234567890' }, session.csrf)).status, 200);
    assert.equal((await call('/api/logout', {}, session.csrf)).status, 200);
    assert.equal((await call('/api/ads/accounts')).status, 401);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
test('hosted configuration requires a strong session secret', () => {
  assert.throws(() => createApp({ APP_ORIGIN: 'https://eightlm-3.onrender.com' }), /SESSION_SECRET/);
});
