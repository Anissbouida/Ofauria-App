import { env } from './config/env.js';
import app from './app.js';

app.listen(env.PORT, () => {
  console.log(`🥐 Ofauria API running on http://localhost:${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
});
