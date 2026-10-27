import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';

const app = express();
const root = fileURLToPath(new URL('.', import.meta.url));
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } } }));
// Serve only public assets; credentials and repository files are never exposed.
for (const [route, file] of Object.entries({ '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' })) {
  app.get(route, (_req, res) => res.sendFile(file, { root }));
}
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use((_req, res) => res.status(404).send('Not found'));
const port = Number(process.env.PORT || 8000);
app.listen(port, '0.0.0.0', () => console.log(`8LM listening on port ${port}`));
