import 'dotenv/config';
import { connectSessionStore } from './session-store.js';
import { ranges, summarize, normalizeCampaign } from './reporting.js';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const random = () => randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const save = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));

export function createApp(config = process.env, clientFactory, sessionStore) {
  const origin = new URL(config.APP_ORIGIN || 'http://localhost:8000').origin;
  clientFactory ||= () => new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, `${origin}/auth/google/callback`);
  const secure = origin.startsWith('https:');
  if (secure && (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32)) throw new Error('Set SESSION_SECRET to a random value of at least 32 characters.');
  const ready = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
  const app = express();
  for (const method of ['get', 'post']) {
    const register = app[method].bind(app);
    app[method] = (path, ...handlers) => handlers.length ? register(path, ...handlers.map(handler => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next))) : register(path);
  }
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': secure ? [] : null } } }));
  app.use(express.json({ limit: '4kb' }));
  app.use(session({ ...(sessionStore ? { store: sessionStore } : {}), name: '8lm.sid', secret: config.SESSION_SECRET || random(), resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 } }));
  app.use(['/api', '/auth'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const protect = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please sign in again.' });
  const csrf = (req, res, next) => req.get('origin') === origin && equal(req.get('x-csrf-token'), req.session.csrf) ? next() : res.status(403).json({ error: 'Please refresh the page and try again.' });
  app.get('/api/session', (req, res) => {
    req.session.csrf ||= random();
    res.json({ configured: ready, user: req.session.user || null, adsConnected: Boolean(req.session.adsTokens), selectedAccount: req.session.selectedAccount || null, csrf: req.session.csrf });
  });
  app.get('/auth/google', async (req, res, next) => {
    try {
      if (!ready) return res.redirect('/?auth=not_configured');
      const ads = req.query.connect === 'ads';
      if (ads && !req.session.user) return res.redirect('/?auth=sign_in_first');
      const client = clientFactory();
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      req.session.oauth = { state: random(), nonce: random(), verifier: codeVerifier, expires: Date.now() + 600000, ads, sub: req.session.user?.sub };
      const url = client.generateAuthUrl({ scope: ['openid', 'email', 'profile', ...(ads ? [ADS_SCOPE] : [])], state: req.session.oauth.state, nonce: req.session.oauth.nonce,
        code_challenge: codeChallenge, code_challenge_method: 'S256', access_type: ads ? 'offline' : 'online', prompt: ads ? 'consent' : 'select_account', ...(ads ? { login_hint: req.session.user.email } : {}) });
      await save(req); res.redirect(url);
    } catch (error) { next(error); }
  });
  app.get('/auth/google/callback', async (req, res) => {
    const flow = req.session.oauth;
    delete req.session.oauth;
    await save(req);
    if (!flow || flow.expires < Date.now() || !equal(req.query.state, flow.state)) return res.redirect('/?auth=invalid_state');
    if (req.query.error) return res.redirect('/?auth=cancelled');
    if (typeof req.query.code !== 'string') return res.redirect('/?auth=failed');
    try {
      const client = clientFactory();
      const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: flow.verifier });
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email_verified || !equal(profile.nonce, flow.nonce)) throw new Error('Invalid identity');
      if (flow.ads) {
        if (profile.sub !== flow.sub || req.session.user?.sub !== flow.sub) return res.redirect('/?auth=wrong_account');
        if (!tokens.scope?.split(' ').includes(ADS_SCOPE)) return res.redirect('/?auth=ads_denied');
        req.session.adsTokens = tokens;
        delete req.session.accounts;
        delete req.session.selectedAccount;
      } else {
        await regenerate(req);
        req.session.user = { sub: profile.sub, email: profile.email, name: profile.name || profile.email };
        req.session.csrf = random();
      }
      await save(req); res.redirect('/');
    } catch { res.redirect('/?auth=failed'); }
  });
  app.get('/api/ads/accounts', protect, async (req, res) => {
    if (!req.session.adsTokens) return res.status(403).json({ error: 'Connect Google Ads first.' });
    try {
      const client = clientFactory();
      client.setCredentials(req.session.adsTokens);
      client.on('tokens', tokens => { req.session.adsTokens = { ...req.session.adsTokens, ...tokens }; });
      const version = config.GOOGLE_ADS_API_VERSION || 'v26';
      if (!/^v\d+$/.test(version)) throw new Error('Invalid API version');
      const { data } = await client.request({ url: `https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, timeout: 15000 });
      const accounts = (data.resourceNames || []).filter(name => /^customers\/\d+$/.test(name)).map(name => ({ id: name.split('/')[1] }));
      req.session.accounts = accounts;
      await save(req); res.json({ accounts });
    } catch { res.status(502).json({ error: 'Could not load Google Ads accounts. Check that Google Ads API is enabled and approved for your Cloud project, or reconnect your Google account.' }); }
  });
  app.post('/api/ads/select', protect, csrf, async (req, res) => {
    if (!req.session.accounts?.some(account => account.id === req.body.id)) return res.status(400).json({ error: 'Select an account from the available list.' });
    req.session.selectedAccount = req.body.id;
    await save(req); res.json({ selectedAccount: req.body.id });
  });
  app.get('/api/ads/dashboard', protect, async (req, res) => {
    const selected = req.session.selectedAccount;
    if (!selected || !req.session.adsTokens) return res.status(403).json({ error: 'Select a connected Google Ads account first.' });
    const range = req.query.range || 'LAST_30_DAYS';
    if (!ranges.includes(range)) return res.status(400).json({ error: 'Choose a supported date range.' });
    const child = req.query.customer;
    if (child !== undefined && (typeof child !== 'string' || !/^\d+$/.test(child))) return res.status(400).json({ error: 'Invalid client account.' });
    try {
      const client = clientFactory();
      client.setCredentials(req.session.adsTokens);
      client.on('tokens', tokens => { req.session.adsTokens = { ...req.session.adsTokens, ...tokens }; });
      const version = config.GOOGLE_ADS_API_VERSION || 'v26';
      if (!/^v\d+$/.test(version)) throw new Error('Invalid API version');
      const query = async (customer, statement, manager) => {
        const { data } = await client.request({ url: `https://googleads.googleapis.com/${version}/customers/${customer}/googleAds:searchStream`, method: 'POST',
          headers: manager ? { 'login-customer-id': selected } : {}, data: { query: statement }, timeout: 30000 });
        return data.flatMap(batch => batch.results || []);
      };
      const infoQuery = 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1';
      const rootRows = await query(selected, infoQuery, false);
      let account = rootRows[0]?.customer;
      if (!account) throw new Error('Account unavailable');
      let clients = [];
      if (account.manager) {
        const rows = await query(selected, 'SELECT customer_client.id, customer_client.descriptive_name FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = \'ENABLED\'', false);
        clients = rows.map(row => ({ id: String(row.customerClient.id), name: row.customerClient.descriptiveName || row.customerClient.id }));
        if (!child) { await save(req); return res.json({ manager: true, account, clients }); }
        if (!clients.some(item => item.id === child)) return res.status(403).json({ error: 'This client is not accessible through the selected manager.' });
        account = (await query(child, infoQuery, true))[0]?.customer;
        if (!account) throw new Error('Account unavailable');
      } else if (child && child !== selected) return res.status(403).json({ error: 'This client is not part of the selected account.' });
      const customer = child || selected;
      const rows = await query(customer, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING ${range} AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC`, Boolean(clients.length));
      const campaigns = rows.map(normalizeCampaign);
      await save(req);
      res.json({ account, clients, range, campaigns, totals: summarize(campaigns), fetchedAt: new Date().toISOString() });
    } catch (error) {
      const status = error.response?.status;
      const message = status === 401 ? 'Google authorization expired. Reconnect Google Ads.' : status === 403 ? 'Google denied reporting access. Check account permissions and your Cloud project’s Google Ads API access.' : status === 429 ? 'Google Ads is temporarily rate limiting requests. Try again shortly.' : 'Could not load campaign performance from Google Ads. Please try again.';
      res.status(502).json({ error: message });
    }
  });
  app.post('/api/logout', csrf, (req, res) => req.session.destroy(() => { res.clearCookie('8lm.sid', { httpOnly: true, secure, sameSite: 'lax' }); res.json({ ok: true }); }));
  for (const [route, file] of Object.entries({ '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' })) app.get(route, (_req, res) => res.sendFile(file, { root }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use((_req, res) => res.status(404).send('Not found'));
  app.use((_err, _req, res, _next) => res.status(500).json({ error: 'Something went wrong. Please try again.' }));
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8000);
  try {
    const shared = await connectSessionStore(process.env);
    if (!shared) console.warn('REDIS_URL is not configured; sessions remain temporary. Add Render Key Value to enable shared sessions.');
    const server = createApp(process.env, undefined, shared?.store).listen(port, '0.0.0.0', () => console.log(`8LM listening on port ${port}${shared ? ' with Redis sessions' : ''}`));
    process.on('SIGTERM', () => {
      server.close(async () => { if (shared) await shared.client.quit(); process.exit(0); });
      setTimeout(() => process.exit(1), 10000).unref();
    });
  } catch { console.error('Startup failed. Check REDIS_URL, SESSION_SECRET and APP_ORIGIN.'); process.exitCode = 1; }
}
