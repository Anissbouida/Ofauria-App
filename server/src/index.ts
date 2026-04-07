import { env } from './config/env.js';
import app from './app.js';

// Prevent server crash on unhandled async errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

app.listen(env.PORT, () => {
  console.log(`🥐 Ofauria API running on http://localhost:${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
});
