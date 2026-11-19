import { afterEach, describe, expect, it } from 'vitest';
import { appEnv, mailRecipient } from '../config/app-env.js';

// G3-01 : environnement et détournement des e-mails en staging.
const saved = { APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV, STAGING_MAIL_TO: process.env.STAGING_MAIL_TO };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('appEnv', () => {
  it('lit APP_ENV, sinon déduit de NODE_ENV', () => {
    process.env.APP_ENV = 'Staging'; expect(appEnv()).toBe('staging');
    process.env.APP_ENV = 'n-importe'; process.env.NODE_ENV = 'production'; expect(appEnv()).toBe('production');
    delete process.env.APP_ENV; process.env.NODE_ENV = 'test'; expect(appEnv()).toBe('development');
  });
});

describe('mailRecipient', () => {
  it('hors staging : adresse d\'origine', () => {
    process.env.APP_ENV = 'production'; process.env.STAGING_MAIL_TO = 'test@exemple.ma';
    expect(mailRecipient('client@exemple.ma')).toBe('client@exemple.ma');
  });
  it('en staging : boîte de test, ou rien sans STAGING_MAIL_TO', () => {
    process.env.APP_ENV = 'staging'; process.env.STAGING_MAIL_TO = 'test@exemple.ma';
    expect(mailRecipient('client@exemple.ma')).toBe('test@exemple.ma');
    delete process.env.STAGING_MAIL_TO;
    expect(mailRecipient('client@exemple.ma')).toBeNull();
  });
});
