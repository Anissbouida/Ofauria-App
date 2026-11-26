import { env } from './config/env.js';
import app from './app.js';
import { startScheduler } from './services/scheduler.js';
import { loadCompanyCurrency } from './services/currency.js';
import { loadCompanyTimezone } from './services/company-timezone.js';
import { loadCountryPack } from './services/country-pack.js';
import { logger } from './utils/logger.js';

// Prevent server crash on unhandled async errors
process.on('uncaughtException', (err) => {
  logger.error({ err: err }, 'Uncaught Exception:');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled Rejection:');
});

app.listen(env.PORT, () => {
  logger.info(`🥐 Kalum API running on http://localhost:${env.PORT}`);
  logger.info(`   Environment: ${env.NODE_ENV}`);
  startScheduler();
  void loadCompanyCurrency(); // devise de la société pour documents et messages (G6-06)
  void loadCompanyTimezone(); // fuseau de la société pour journées, échéances et documents (audit des profils)
  void loadCountryPack(); // pack pays : paramètres légaux pour les validateurs synchrones (G6-06)
});
