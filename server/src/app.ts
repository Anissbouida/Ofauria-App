import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import pinoHttp from 'pino-http';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error.middleware.js';
import { originCheck } from './middleware/csrf.middleware.js';
import { runWithTimezone } from './utils/timezone.js';
import { logger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const IS_PROD = env.NODE_ENV === 'production';

// OWASP A09 : log structure de chaque requete (method, url, status, latence, id).
// Automatiquement applique la redaction definie dans logger.ts.
app.use(pinoHttp({
  logger,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // N'inclure le body que sur les erreurs (redaction deja appliquee par logger).
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
  },
}));

// ─── A05-4 Helmet complet + HSTS ─────────────────────────
// CSP stricte mais conservatrice : React SPA + API, pas d'inline scripts,
// styled-components autorise via 'unsafe-inline' sur styleSrc.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  // HSTS uniquement en prod (sinon bloque le dev HTTP).
  hsts: IS_PROD
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

// ─── A05-2 CORS environnemental ──────────────────────────
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost',
  'https://localhost',
  'http://10.0.2.2:3001',
];
// Toujours autoriser l'app Capacitor (mobile embarque).
const MOBILE_ORIGINS = ['capacitor://localhost', 'https://localhost'];
// Prod : liste explicite via env.ALLOWED_ORIGINS (CSV).
const PROD_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const allowedOrigins = IS_PROD
  ? [...PROD_ORIGINS, ...MOBILE_ORIGINS]
  : [...DEV_ORIGINS, ...MOBILE_ORIGINS];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Retourne false au lieu de throw => reponse sans ACAO, le navigateur
      // bloque la requete cote client. Le middleware originCheck retourne
      // 403 propre si la requete passe quand meme (non-browser).
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Timezone', 'X-CSRF-Token'],
}));

// Cookie parsing (OWASP A02-5 : JWT stocke en HttpOnly cookie)
app.use(cookieParser());

// OWASP A08 : Origin/Referer check anti-CSRF pour toute mutation.
// A faire AVANT les routes, APRES cors + cookieParser.
app.use('/api/v1', originCheck(allowedOrigins));

// Body parsing
app.use(express.json({ limit: '10kb' }));

// Capture user timezone from request header and store in async context
app.use((req, res, next) => {
  const timezone = req.headers['x-timezone'] as string || 'Africa/Casablanca';
  runWithTimezone(timezone, () => next());
});

// ─── A05-3 Static uploads durcis ─────────────────────────
// - X-Content-Type-Options: nosniff empeche le MIME sniffing d'un fichier.
// - Content-Disposition: inline force l'affichage, pas d'execution.
// - Cache-Control: public pour permettre CDN mais revalidation.
app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads'), {
  dotfiles: 'deny',
  index: false,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  },
}));

// API routes
app.use('/api/v1', routes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'Ofauria API' });
});

// Error handler
app.use(errorHandler);

export default app;
