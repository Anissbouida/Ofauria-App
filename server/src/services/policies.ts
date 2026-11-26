import type { PoolClient } from 'pg';
import { db, withTransaction, inTransaction } from '../config/database.js';
import { parameterByKey, validateParameter, PARAMETERS, type ParamDef } from './parameters-catalog.js';
import { listWorkshops } from './workshops.js';
import { withCurrency } from './currency.js';
import { resolveConfig } from './config-resolver.js';
import { needsMet, PARAM_NEEDS } from '@ofauria/shared';

/**
 * Politiques à héritage (M1-02, mig 538).
 *
 * Une politique est un paramètre du catalogue (parameters-catalog.ts, stockage `policy`)
 * dont la valeur peut être posée à cinq niveaux. La valeur effective est la plus précise
 * qui existe pour le contexte demandé :
 *
 *     article → type d'ordre → atelier → établissement → société → défaut du catalogue
 *
 * Analogie Oracle : les options de profil d'E-Business Suite (FND_PROFILE.VALUE), où la
 * valeur de l'utilisateur l'emporte sur celle de la responsabilité, puis du site.
 *
 * Chaque écriture est tracée (journal du paramétrage) et crée une version de
 * configuration : restaurer une version remet aussi les politiques dans son état.
 */
export type PolicyScope = 'company' | 'store' | 'workshop' | 'order_type' | 'product';
/** Du plus précis au plus général : l'ordre de résolution. */
export const POLICY_SCOPES: PolicyScope[] = ['product', 'order_type', 'workshop', 'store', 'company'];
export const POLICY_SCOPE_LABELS: Record<PolicyScope | 'default', string> = {
  product: 'Article', order_type: 'Type d\'ordre', workshop: 'Atelier', store: 'Établissement', company: 'Société', default: 'Valeur par défaut',
};

export type PolicyContext = { productId?: string | null; orderType?: string | null; workshop?: string | null; storeId?: string | null };
export type PolicyRow = { key: string; scope_type: PolicyScope; scope_id: string; value: Record<string, unknown> };
export type ResolvedPolicy<T> = { value: T; source: PolicyScope | 'default'; scopeId: string };

type Queryable = Pick<PoolClient, 'query'> | typeof db;

// Lu à chaque calcul (coût, rendement, plan directeur) : cache court, vidé à l'écriture.
// La durée borne le décalage entre deux instances du serveur.
const CACHE_MS = 30_000;
let cache: { at: number; byKey: Map<string, PolicyRow[]> } | null = null;

export function invalidatePolicies() { cache = null; }

/** Toutes les valeurs posées, telles qu'en base (sert aussi de contenu d'une version). */
export async function policySnapshot(q: Queryable = db): Promise<PolicyRow[]> {
  const exists = (await q.query(`SELECT to_regclass('public.policy_values') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) return [];
  return (await q.query(`SELECT key, scope_type, scope_id, value FROM policy_values ORDER BY key, scope_type, scope_id`)).rows as PolicyRow[];
}

async function allPolicies(): Promise<Map<string, PolicyRow[]>> {
  const transactional=inTransaction();
  if (!transactional&&cache && Date.now() - cache.at < CACHE_MS) return cache.byKey;
  const byKey = new Map<string, PolicyRow[]>();
  for (const r of await policySnapshot()) {
    const list = byKey.get(r.key);
    if (list) list.push(r); else byKey.set(r.key, [r]);
  }
  if(!transactional)cache = { at: Date.now(), byKey };
  return byKey;
}

const policyDef = (key: string): ParamDef => {
  const def = parameterByKey(key);
  if (!def || def.storage.kind !== 'policy') throw new Error(`Politique inconnue : ${key}`);
  return def;
};

/** Politiques déclarées au catalogue. */
export const policyDefinitions = (): ParamDef[] => PARAMETERS.filter(p => p.storage.kind === 'policy');

/**
 * Valeur effective d'une politique pour un contexte, et le niveau d'où elle vient.
 * Un niveau absent du contexte est sauté. Les champs manquants d'une valeur posée
 * prennent le défaut du catalogue.
 */
export async function resolvePolicy<T = Record<string, unknown>>(key: string, ctx: PolicyContext = {}): Promise<ResolvedPolicy<T>> {
  const def = policyDef(key);
  const rows = (await allPolicies()).get(key) ?? [];
  const resolved = resolveConfig(def.defaults, rows, { product: ctx.productId ?? undefined, order_type: ctx.orderType ?? undefined,
    workshop: ctx.workshop ?? undefined, store: ctx.storeId ?? undefined }, { levels: POLICY_SCOPES });
  if (resolved.source !== 'default') return { value: { ...def.defaults, ...resolved.value } as T, source: resolved.source as PolicyScope, scopeId: resolved.scopeId };
  // Niveau société tenu par une colonne historique : c'est elle qui fait foi. Lue à chaque
  // fois (hors cache) : son écran d'origine la modifie sans passer par ce service.
  if (def.companyColumns) {
    const company = (await db.query(`SELECT * FROM company_settings WHERE id = 1`)).rows[0] ?? {};
    const value: Record<string, unknown> = { ...def.defaults };
    let found = false;
    for (const [field, col] of Object.entries(def.companyColumns)) {
      const raw = company[col];
      if (raw === null || raw === undefined) continue;
      const f = def.fields.find(x => x.name === field);
      value[field] = f && !['boolean', 'enum', 'time', 'date', 'list'].includes(f.type) ? Number(raw) : raw;
      found = true;
    }
    if (found) return { value: value as T, source: 'company', scopeId: '' };
  }
  return { value: { ...def.defaults } as T, source: 'default', scopeId: '' };
}

/** Raccourci pour un champ numérique : `await policyNumber('production.yield_target', 'pct', { workshop })`. */
export async function policyNumber(key: string, field: string, ctx: PolicyContext = {}): Promise<number> {
  const { value } = await resolvePolicy<Record<string, unknown>>(key, ctx);
  const n = Number(value[field]);
  return Number.isFinite(n) ? n : Number(policyDef(key).defaults[field]);
}

/** Le niveau existe-t-il (établissement, atelier, article) ? Retourne un message d'erreur ou null. */
async function checkScope(def: ParamDef, scopeType: PolicyScope, scopeId: string): Promise<string | null> {
  if (!POLICY_SCOPES.includes(scopeType)) return 'Niveau inconnu';
  if (!(def.scopes ?? ['company']).includes(scopeType)) return `« ${def.label} » ne se règle pas au niveau ${POLICY_SCOPE_LABELS[scopeType].toLowerCase()}`;
  if (scopeType === 'company') return scopeId === '' ? null : 'Le niveau société ne porte pas d\'identifiant';
  if (!scopeId) return 'Identifiant du niveau manquant';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (scopeType === 'store') {
    if (!uuid.test(scopeId) || !(await db.query(`SELECT 1 FROM stores WHERE id = $1`, [scopeId])).rows.length) return 'Établissement introuvable';
  } else if (scopeType === 'product') {
    if (!uuid.test(scopeId) || !(await db.query(`SELECT 1 FROM products WHERE id = $1`, [scopeId])).rows.length) return 'Article introuvable';
  } else if (scopeType === 'workshop') {
    if (!(await listWorkshops()).some(w => w.code === scopeId)) return 'Atelier introuvable';
  } else if (!/^[a-z0-9_]{1,40}$/.test(scopeId)) {
    return 'Type d\'ordre invalide';
  }
  return null;
}

/**
 * Pose (ou retire, avec `input = null`) la valeur d'une politique à un niveau.
 * Les champs absents de `input` gardent la valeur héritée du niveau au-dessus au moment
 * de la saisie. Crée une version de configuration.
 */
export async function setPolicy(
  key: string, scopeType: PolicyScope, scopeId: string, input: unknown, userId?: string | null,
): Promise<{ error: string } | { value: Record<string, unknown> | null }> {
  let def: ParamDef;
  try { def = policyDef(key); } catch { return { error: 'Politique inconnue' }; }
  const bad = await checkScope(def, scopeType, scopeId);
  if (bad) return { error: bad };

  const { sectorRepository } = await import('../repositories/sector.repository.js');
  try {
    return await withTransaction(async () => {
      await db.query(`SELECT id FROM company_settings WHERE id=1 FOR UPDATE`);
      let value: Record<string, unknown> | null = null;
      if (input !== null) {
        const current = (await db.query(
          `SELECT value FROM policy_values WHERE key = $1 AND scope_type = $2 AND scope_id = $3`, [key, scopeType, scopeId])).rows[0]?.value ?? {};
        const checked = validateParameter(def, input, current);
        if (typeof checked === 'string') return { error: checked };
        value = checked;
      }
      if (userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const before = await policySnapshot();
      if (value === null) {
        await db.query(`DELETE FROM policy_values WHERE key = $1 AND scope_type = $2 AND scope_id = $3`, [key, scopeType, scopeId]);
      } else {
        await db.query(
          `INSERT INTO policy_values (key, scope_type, scope_id, value, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (key, scope_type, scope_id) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, scopeType, scopeId, JSON.stringify(value), userId ?? null]);
      }
      const level = scopeType === 'company' ? 'société' : `${POLICY_SCOPE_LABELS[scopeType].toLowerCase()} ${scopeId}`;
      await sectorRepository.recordVersion(
        `Politique « ${def.label} » : ${value === null ? 'valeur retirée' : 'valeur posée'} (${level})`, userId, before);
      return {value};
    });
  } finally {
    // Aussi après un échec : une lecture faite pendant la transaction a pu mettre en cache
    // une valeur qui n'a pas été validée.
    invalidatePolicies();
  }
}

/**
 * Remet les politiques dans l'état d'une version (appelé par la restauration d'une
 * version de configuration, dans sa transaction). Les clés et niveaux disparus sont ignorés.
 */
export async function restorePolicies(client: Queryable, list: PolicyRow[], userId?: string | null): Promise<void> {
  const exists = (await client.query(`SELECT to_regclass('public.policy_values') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) return;
  const known = list.filter(r => {
    const def = parameterByKey(r.key);
    return def?.storage.kind === 'policy' && POLICY_SCOPES.includes(r.scope_type) && (r.scope_type === 'company') === (r.scope_id === '');
  });
  const json = JSON.stringify(known);
  await client.query(
    `DELETE FROM policy_values pv
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS x(key text, scope_type text, scope_id text)
                         WHERE x.key = pv.key AND x.scope_type = pv.scope_type AND x.scope_id = pv.scope_id)`, [json]);
  await client.query(
    `INSERT INTO policy_values (key, scope_type, scope_id, value, updated_by)
     SELECT x.key, x.scope_type, x.scope_id, x.value, $2::uuid
       FROM jsonb_to_recordset($1::jsonb) AS x(key text, scope_type text, scope_id text, value jsonb)
     ON CONFLICT (key, scope_type, scope_id) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     WHERE policy_values.value IS DISTINCT FROM EXCLUDED.value`, [json, userId ?? null]);
  invalidatePolicies();
}

/**
 * Politiques de production pour l'écran Production › Paramétrage › Politiques (M1-04) et
 * pour les écrans qui lisent un seuil : valeur effective dans le contexte demandé, niveau
 * d'où elle vient, et toutes les valeurs posées avec le nom de leur niveau.
 */
export async function listPolicies(ctx: PolicyContext = {}) {
  // Audit des profils (L5) : politiques de ce que la société n'a pas retirées de l'écran.
  const needsCtx = await (await import('../repositories/sector.repository.js')).sectorRepository.needsContext();
  const defs = policyDefinitions().filter(d => needsMet(PARAM_NEEDS[d.key], needsCtx));
  const [rows, stores, workshops, orderTypes] = await Promise.all([
    policySnapshot(),
    db.query(`SELECT id, name FROM stores ORDER BY name`),
    listWorkshops(),
    // Types d'ordre (M2-01) : le niveau « type d'ordre » porte leur code.
    db.query(`SELECT code, label FROM production_order_types WHERE is_active ORDER BY display_order, label`),
  ]);
  const productIds = [...new Set(rows.filter(r => r.scope_type === 'product').map(r => r.scope_id))];
  const products = productIds.length
    ? (await db.query(`SELECT id, name FROM products WHERE id::text = ANY($1)`, [productIds])).rows
    : [];
  const names: Record<string, Map<string, string>> = {
    store: new Map(stores.rows.map(s => [s.id as string, s.name as string])),
    workshop: new Map(workshops.map(w => [w.code, w.label])),
    product: new Map(products.map(p => [p.id as string, p.name as string])),
    order_type: new Map(orderTypes.rows.map(t => [t.code as string, t.label as string])),
  };
  const scopeLabel = (type: PolicyScope, id: string) =>
    type === 'company' ? 'Société' : (names[type]?.get(id) ?? id);

  const policies = await Promise.all(defs.map(async def => {
    const effective = await resolvePolicy(def.key, ctx);
    const company = await resolvePolicy(def.key, {});
    return {
      key: def.key, label: withCurrency(def.label), help: withCurrency(def.help), fields: withCurrency(def.fields), defaults: def.defaults,
      scopes: def.scopes ?? ['company'],
      // Niveau société tenu par un autre écran (colonne historique) : affiché, non modifiable ici.
      companyManagedElsewhere: Boolean(def.companyColumns),
      effective: { ...effective, sourceLabel: POLICY_SCOPE_LABELS[effective.source], scopeLabel: effective.source === 'default' ? '' : scopeLabel(effective.source, effective.scopeId) },
      company: { value: company.value, source: company.source },
      overrides: rows.filter(r => r.key === def.key).map(r => ({
        scopeType: r.scope_type, scopeId: r.scope_id, scopeTypeLabel: POLICY_SCOPE_LABELS[r.scope_type],
        scopeLabel: scopeLabel(r.scope_type, r.scope_id), value: { ...def.defaults, ...r.value },
      })),
    };
  }));
  return {
    policies,
    levels: {
      stores: stores.rows.map(s => ({ id: s.id as string, label: s.name as string })),
      workshops: workshops.filter(w => w.isActive).map(w => ({ id: w.code, label: w.label })),
      orderTypes: orderTypes.rows.map(t => ({ id: t.code as string, label: t.label as string })),
    },
  };
}
