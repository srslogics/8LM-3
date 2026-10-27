import RedisStore from 'connect-redis';
import { createClient } from 'redis';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function encryptedSerializer(secret) {
  const key = createHash('sha256').update(`8lm-session:${secret}`).digest();
  return {
    stringify(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    parse(value) {
      const data = Buffer.from(value, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
    }
  };
}
export async function connectSessionStore(config) {
  if (!config.REDIS_URL) return null;
  if (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32) throw new Error('Redis sessions require SESSION_SECRET of at least 32 characters.');
  const client = createClient({ url: config.REDIS_URL, disableOfflineQueue: true, socket: { connectTimeout: 10000, reconnectStrategy: retries => retries < 5 ? Math.min(500 * (retries + 1), 3000) : new Error('Session store unavailable') } });
  client.on('error', () => console.error('Session store connection error. Check Render Key Value availability.'));
  await client.connect();
  return { client, store: new RedisStore({ client, prefix: '8lm:sess:', ttl: 28800, serializer: encryptedSerializer(config.SESSION_SECRET) }) };
}
