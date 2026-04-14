import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error.middleware.js';
import { runWithTimezone } from './utils/timezone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Security
app.use(helmet({
  contentSecurityPolicy: false,  // Désactivé pour compatibilité mobile Capacitor
  crossOriginResourcePolicy: { policy: 'cross-origin' },  // Permet le chargement des images/uploads
}));
app.use(cors({
  origin: (origin, callback) => {
    // Autorise le web (localhost dev), l'app mobile Capacitor, et les requêtes sans origin
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:4173',
      'http://localhost',
      'https://localhost',
      'capacitor://localhost',
      'http://10.0.2.2:3001',
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // En dev, accepter tout. En prod, restreindre.
    }
  },
  credentials: true,
}));

// Body parsing
app.use(express.json());

// Capture user timezone from request header and store in async context
app.use((req, res, next) => {
  const timezone = req.headers['x-timezone'] as string || 'Africa/Casablanca';
  runWithTimezone(timezone, () => next());
});

// Static files (uploaded images)
app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads')));

// API routes
app.use('/api/v1', routes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'Ofauria API' });
});

// Error handler
app.use(errorHandler);

export default app;
