import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptedSerializer, connectSessionStore } from '../session-store.js';
test('Redis session payloads encrypt tokens and reject tampering', () => {
  const serializer = encryptedSerializer('a'.repeat(32));
  const payload = { adsTokens: { refresh_token: 'sensitive-token' }, cookie: { expires: '2026-10-28' } };
  const stored = serializer.stringify(payload);
  assert.ok(!stored.includes('sensitive-token'));
  assert.deepEqual(serializer.parse(stored), payload);
  assert.notEqual(serializer.stringify(payload), stored);
  assert.throws(() => encryptedSerializer('b'.repeat(32)).parse(stored));
  const tampered = Buffer.from(stored, 'base64'); tampered[30] ^= 1;
  assert.throws(() => serializer.parse(tampered.toString('base64')));
});
test('Redis configuration requires a strong secret', async () => {
  assert.equal(await connectSessionStore({}), null);
  await assert.rejects(connectSessionStore({ REDIS_URL: 'redis://localhost:6379' }), /SESSION_SECRET/);
});
