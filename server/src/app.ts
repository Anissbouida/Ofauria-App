import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error.middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Security
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

// Body parsing
app.use(express.json());

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
