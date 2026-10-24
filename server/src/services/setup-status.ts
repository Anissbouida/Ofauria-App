import type { SettingsSection } from '@ofauria/shared';
import { db } from '../config/database.js';

/**
 * Accueil de la configuration (refonte lot B) : état du paramétrage domaine par
 * domaine, à la façon de la liste « Configuration » d'Odoo et de la
 * « Configuration assistée » de Dynamics BC. Lecture seule, calculée à la
 * demande : aucune table, aucun état mémorisé (rien à désynchroniser).
 *
 * Statuts : ok (fait), todo (requis, à faire), warn (recommandé, à faire),
 * info (choix par défaut acceptable, à vérifier une fois).
 * Seuls les points « requis » comptent dans l'avancement.
 */

export type SetupStatus = 'ok' | 'todo' | 'warn' | 'info';

export interface SetupCheck {
  key: string;
  /** Page des paramètres qui règle ce point (?page=…) ; 'users' = écran Utilisateurs. */
  page: string;
  section: SettingsSection | null;
  label: string;
  detail: string;
  status: SetupStatus;
  required: boolean;
  /** Ancre du réglage dans la page (même règle que settingAnchor côté client). */
  anchor?: string;
}

const anchor = (title: string) => 'set-' + title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function exists(table: string): Promise<boolean> {
  return (await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`])).rows[0].ok as boolean;
}
async function count(table: string, where = 'TRUE'): Promise<number | null> {
  if (!(await exists(table))) return null;
  return Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)).rows[0].n);
}
const filled = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export async function setupStatus(): Promise<SetupCheck[]> {
  // to_jsonb : tient même si une colonne récente (mig 326/331) n'est pas encore là.
  const cs = ((await db.query(`SELECT to_jsonb(c) AS j FROM company_settings c WHERE id = 1`)).rows[0]?.j ?? {}) as Record<string, any>;
  const checks: SetupCheck[] = [];
  const add = (c: SetupCheck) => checks.push(c);

  // ── Entreprise › Société ──
  const legalMissing = [
    ['legal_name', 'raison sociale'], ['legal_address', 'adresse'], ['legal_city', 'ville'],
    ['legal_rc', 'RC'], ['legal_if', 'IF'], ['legal_ice', 'ICE'],
  ].filter(([k]) => !filled(cs[k])).map(([, l]) => l);
  add({ key: 'company.legal', page: 'company', section: 'company', required: true, anchor: anchor('Identité légale'),
    label: 'Identité légale', status: legalMissing.length ? 'todo' : 'ok',
    detail: legalMissing.length ? `Manque : ${legalMissing.join(', ')}` : 'Mentions obligatoires des factures renseignées' });
  const banks = await count('company_bank_accounts', 'is_active');
  if (banks !== null) {
    const def = (await count('company_bank_accounts', 'is_active AND is_default')) ?? 0;
    add({ key: 'company.bank', page: 'company', section: 'company', required: true, anchor: anchor('Comptes bancaires'),
      label: 'Compte bancaire', status: banks === 0 ? 'todo' : def === 0 ? 'warn' : 'ok',
      detail: banks === 0 ? 'Aucun RIB : il ne peut pas figurer sur les factures'
        : def === 0 ? `${plural(banks, 'compte')}, aucun par défaut` : `${plural(banks, 'compte')}, dont un par défaut` });
  }

  // ── Entreprise › Établissements ──
  const stores = (await count('stores', 'is_active')) ?? 0;
  const hasHq = 'is_headquarters' in ((await db.query(`SELECT to_jsonb(s) AS j FROM stores s LIMIT 1`)).rows[0]?.j ?? {});
  const hq = hasHq ? ((await count('stores', 'is_active AND is_headquarters')) ?? 0) : 1;
  const incomplete = (await count('stores', `is_active AND (coalesce(trim(address), '') = '' OR coalesce(trim(phone), '') = '')`)) ?? 0;
  add({ key: 'stores.list', page: 'stores', section: 'stores', required: true,
    label: 'Établissements', status: stores === 0 ? 'todo' : incomplete > 0 ? 'warn' : 'ok',
    detail: stores === 0 ? 'Aucun établissement actif'
      : incomplete > 0 ? `${plural(incomplete, 'établissement')} sans adresse ou téléphone` : `${plural(stores, 'établissement')} actif${stores > 1 ? 's' : ''}` });
  if (stores > 0) {
    add({ key: 'stores.hq', page: 'stores', section: 'stores', required: false,
      label: 'Siège social désigné', status: hq > 0 ? 'ok' : 'warn',
      detail: hq > 0 ? 'Adresse du siège connue' : 'Aucun établissement marqué comme siège' });
  }

  // ── Entreprise › Apparence ──
  add({ key: 'appearance.logo', page: 'print', section: 'print', required: false, anchor: anchor('Logo'),
    label: 'Logo', status: filled(cs.logo_url) ? 'ok' : 'warn',
    detail: filled(cs.logo_url) ? 'Imprimé sur les tickets, factures et bons de commande' : 'Aucun logo : les documents partent sans' });

  // ── Ventes et caisse ──
  add({ key: 'print.receipt', page: 'print', section: 'print', required: false, anchor: anchor('Contenu du reçu'),
    label: 'Ticket de caisse', status: filled(cs.receipt_footer) || filled(cs.receipt_header) ? 'ok' : 'info',
    detail: filled(cs.receipt_footer) || filled(cs.receipt_header) ? 'En-tête ou pied de ticket personnalisé' : 'Ticket standard, sans message' });
  const channels = await count('sales_channels', 'is_active');
  if (channels !== null) {
    const defCh = (await count('sales_channels', 'is_active AND is_default')) ?? 0;
    add({ key: 'channels.list', page: 'channels', section: 'production', required: true,
      label: 'Canaux de vente', status: channels === 0 ? 'todo' : defCh === 0 ? 'warn' : 'ok',
      detail: channels === 0 ? 'Aucun canal actif' : defCh === 0 ? `${plural(channels, 'canal', 'canaux')}, aucun par défaut` : `${plural(channels, 'canal', 'canaux')} actif${channels > 1 ? 's' : ''}` });
  }
  add({ key: 'sachets.ratio', page: 'sachets', section: 'sachets', required: false, anchor: anchor('Réglage global'),
    label: 'Contrôle des sachets', status: Number(cs.default_articles_per_sachet) > 0 ? 'ok' : 'info',
    detail: Number(cs.default_articles_per_sachet) > 0 ? `${cs.default_articles_per_sachet} articles par sachet` : 'Ratio non défini' });

  // ── Achats et production ──
  const charges = Number(cs.production_charge_loyer ?? 0) + Number(cs.production_charge_energie ?? 0) + Number(cs.production_charge_autres ?? 0);
  add({ key: 'production.charges', page: 'production', section: 'production', required: true,
    label: 'Charges fixes de production', status: charges > 0 ? 'ok' : 'todo',
    detail: charges > 0 ? `${charges.toLocaleString('fr-FR')} DH par mois répartis dans les coûts` : 'Coûts de revient calculés sans loyer ni énergie' });
  add({ key: 'production.markup', page: 'production', section: 'production', required: false, anchor: anchor('Majoration globale'),
    label: 'Majoration des prix', status: Number(cs.production_markup_percent) > 0 ? 'ok' : 'warn',
    detail: Number(cs.production_markup_percent) > 0 ? `${cs.production_markup_percent} % appliqués au coût` : 'Aucune majoration : prix suggéré = coût' });
  const purchasingSet = await count('module_parameters', `key LIKE 'purchasing.%'`);
  add({ key: 'purchasing.rules', page: 'purchasing', section: 'business', required: false,
    label: 'Règles d’achat et de réception', status: purchasingSet ? 'ok' : 'info',
    detail: purchasingSet ? `${plural(purchasingSet, 'règle')} ajustée${purchasingSet > 1 ? 's' : ''}` : 'Valeurs par défaut (tolérance, DLC, contrôle des factures)' });

  // ── Comptabilité ──
  const taxes = await count('tax_codes', `valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)`);
  if (taxes !== null) {
    add({ key: 'tax.rates', page: 'tax', section: 'tax', required: true,
      label: 'Taux de TVA en vigueur', status: taxes > 0 ? 'ok' : 'todo',
      detail: taxes > 0 ? `${plural(taxes, 'taux', 'taux')} applicable${taxes > 1 ? 's' : ''} aujourd'hui` : "Aucun taux valable à la date du jour" });
  }
  const series = await count('document_sequences');
  if (series !== null) {
    add({ key: 'numbering.series', page: 'numbering', section: 'numbering', required: true,
      label: 'Séries de numérotation', status: series > 0 ? 'ok' : 'todo',
      detail: series > 0 ? `${plural(series, 'série')} (factures, BC, réceptions…)` : 'Aucune série : la numérotation des pièces est impossible' });
  }
  if (await exists('document_templates')) {
    const inv = (await db.query(`SELECT payment_terms, late_penalty FROM document_templates WHERE doc_type = 'invoice'`)).rows[0];
    const miss = !inv ? ['modèle de facture'] : [!filled(inv.payment_terms) && 'conditions de paiement', !filled(inv.late_penalty) && 'pénalités de retard'].filter(Boolean);
    add({ key: 'documents.invoice', page: 'documents', section: 'documents', required: true,
      label: 'Mentions des factures', status: miss.length ? 'todo' : 'ok',
      detail: miss.length ? `Manque : ${miss.join(', ')} (loi 69-21 sur les délais de paiement)` : 'Conditions et pénalités de retard imprimées' });
  }
  const posting = (await exists('module_parameters'))
    ? (await db.query(`SELECT value FROM module_parameters WHERE key = 'ledger.posting_mode'`)).rows[0]?.value : undefined;
  add({ key: 'ledger.mode', page: 'ledger', section: 'business', required: false,
    label: 'Passation des écritures', status: posting !== undefined ? 'ok' : 'info',
    detail: posting !== undefined ? 'Mode choisi' : 'Mode par défaut : à confirmer avec le comptable' });

  // ── Données de base ──
  const cats = await count('expense_categories');
  if (cats !== null) {
    add({ key: 'referentiel.categories', page: 'referentiel', section: 'referentiel', required: true,
      label: 'Catégories (achats, stock, charges)', status: cats > 0 ? 'ok' : 'todo',
      detail: cats > 0 ? `${plural(cats, 'catégorie')}` : 'Aucune catégorie : achats et charges non classables' });
  }
  const suppliers = (await count('suppliers')) ?? 0;
  const products = (await count('products')) ?? 0;
  add({ key: 'data.base', page: 'data', section: 'data', required: true,
    label: 'Fournisseurs et produits', status: suppliers > 0 && products > 0 ? 'ok' : 'todo',
    detail: suppliers > 0 && products > 0 ? `${plural(suppliers, 'fournisseur')}, ${plural(products, 'produit')}`
      : `À importer : ${[suppliers === 0 && 'fournisseurs', products === 0 && 'produits'].filter(Boolean).join(', ')}` });

  // ── Sécurité et contrôle ──
  const activeUsers = (await count('users', 'is_active')) ?? 0;
  const admins = (await count('users', `is_active AND role = 'admin'`)) ?? 0;
  add({ key: 'users.accounts', page: 'users', section: null, required: true,
    label: 'Comptes utilisateurs', status: activeUsers > 1 ? 'ok' : 'todo',
    detail: activeUsers > 1 ? `${plural(activeUsers, 'compte')} actif${activeUsers > 1 ? 's' : ''}, ${plural(admins, 'administrateur')}`
      : 'Un seul compte : créez ceux de l’équipe, chacun avec son rôle' });
  const mode = cs.security_module_enforcement as string | undefined;
  if (mode !== undefined) {
    add({ key: 'users.enforcement', page: 'users', section: null, required: false,
      label: 'Contrôle des droits', status: mode === 'enforce' ? 'ok' : 'warn',
      detail: mode === 'enforce' ? 'Accès refusés hors droits' : mode === 'log' ? 'En observation : les accès hors droits sont tracés, pas bloqués' : 'Désactivé' });
  }
  const rules = await count('notification_rules', 'NOT enabled');
  if (rules !== null) {
    add({ key: 'notifications.rules', page: 'notifications', section: 'notifications', required: false,
      label: 'Notifications', status: 'info',
      detail: rules > 0 ? `${plural(rules, 'alerte')} désactivée${rules > 1 ? 's' : ''}` : 'Toutes les alertes actives, destinataires par défaut' });
  }

  return checks;
}

