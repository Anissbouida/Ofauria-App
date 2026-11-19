/**
 * G3-01 — environnement d'exécution : `APP_ENV` = production | staging | development.
 * À défaut, déduit de NODE_ENV (production → production, sinon development).
 * En staging : bandeau dans l'application et e-mails détournés (voir services/mailer.ts).
 */
export type AppEnv = 'production' | 'staging' | 'development';

export function appEnv(): AppEnv {
  const v = (process.env.APP_ENV || '').trim().toLowerCase();
  if (v === 'production' || v === 'staging' || v === 'development') return v;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

/**
 * Destinataire réel d'un e-mail. En staging, tout part vers STAGING_MAIL_TO (boîte de test) ;
 * sans cette variable, rien ne part (null). Hors staging, l'adresse d'origine.
 */
export function mailRecipient(original: string): string | null {
  if (appEnv() !== 'staging') return original;
  const to = (process.env.STAGING_MAIL_TO || '').trim();
  return to || null;
}
