/**
 * Feature flags du noyau comptable.
 *
 * Lecture depuis l'environnement, valeurs typees, defaut OFF en production.
 * Pour activer en dev, exporter ou ajouter dans .env :
 *   LEDGER_AUTOGEN=on
 *   LEDGER_BACKED_DEBTS=on
 *
 * Comportement :
 *   LEDGER_AUTOGEN     : a la creation d'une facture/paiement/vente, genere
 *                        automatiquement l'ecriture comptable correspondante.
 *                        Echec de generation = log + continue (graceful).
 *
 *   LEDGER_BACKED_DEBTS: l'endpoint /invoices/debts lit le solde non-lettre
 *                        depuis les ecritures plutot que SUM(payments). En
 *                        mode shadow (LEDGER_SHADOW_MODE), calcule les deux
 *                        et logue les divergences sans servir le ledger.
 *
 *   LEDGER_SHADOW_MODE : double calcul legacy + ledger pour les Dettes. La
 *                        reponse renvoyee reste celle de legacy. Utilise pour
 *                        observer les divergences avant bascule.
 */

function parseFlag(envValue: string | undefined, defaultValue: boolean): boolean {
  if (envValue === undefined || envValue === '') return defaultValue;
  return ['on', '1', 'true', 'yes'].includes(envValue.toLowerCase());
}

const isDev = process.env.NODE_ENV !== 'production';

export const FLAGS = {
  /** Generation automatique des ecritures lors de la creation d'une entite metier. */
  LEDGER_AUTOGEN: parseFlag(process.env.LEDGER_AUTOGEN, isDev),

  /** Dettes lit depuis le ledger (au lieu de SUM(payments)). */
  LEDGER_BACKED_DEBTS: parseFlag(process.env.LEDGER_BACKED_DEBTS, false),

  /** Mode shadow : double calcul, sert legacy, logue les divergences. */
  LEDGER_SHADOW_MODE: parseFlag(process.env.LEDGER_SHADOW_MODE, false),
} as const;

// Log au demarrage pour visibilite
if (FLAGS.LEDGER_AUTOGEN || FLAGS.LEDGER_BACKED_DEBTS || FLAGS.LEDGER_SHADOW_MODE) {
  // eslint-disable-next-line no-console
  console.log('[feature-flags] LEDGER_AUTOGEN=%s LEDGER_BACKED_DEBTS=%s LEDGER_SHADOW_MODE=%s',
    FLAGS.LEDGER_AUTOGEN, FLAGS.LEDGER_BACKED_DEBTS, FLAGS.LEDGER_SHADOW_MODE);
}
