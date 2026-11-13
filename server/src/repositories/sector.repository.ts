import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import {
  ACTIVATABLE_MODULES, CORE_MODULES, MODULE_LABELS, canonicalModule, effectiveModules, missingDependencies,
  type AppModule, type ModuleOverrides,
} from '@ofauria/shared';

/**
 * Secteur d'activité (packs secteur, mig 468). Le secteur de la société est dans
 * company_settings.sector_pack ; chaque pack active une liste de modules. Le reste
 * du code lit `modules` (capacités), jamais le code du secteur : ajouter un secteur
 * = une ligne dans sector_packs, sans toucher au code.
 *
 * Activation (mig 507) : le secteur est un préréglage, ajusté module par module et
 * option par option (company_module_settings / company_feature_settings, écarts
 * seulement). Les modules et options EFFECTIFS se calculent ici et nulle part ailleurs.
 */
export type SectorPack = { code: string; label: string; modules: string[]; is_default: boolean; home_route?: string | null; report_keys?: string[]; features?: string[] };

export type FeatureDef = { key: string; module_key: string; label: string; description: string | null; sort_order: number };

export type Activation = {
  sector: SectorPack;
  /** Modules du préréglage, en clés canoniques. */
  packModules: AppModule[];
  packFeatures: string[];
  moduleOverrides: ModuleOverrides;
  featureOverrides: ModuleOverrides;
  catalog: FeatureDef[];
  modules: Set<AppModule>;
  /** Une option n'est effective que si son module l'est. */
  features: Set<string>;
};

export type AdjustmentChanges = { modules?: Record<string, boolean | null>; features?: Record<string, boolean | null> };

const mapPack = (r: Record<string, any>): SectorPack => ({
  code: r.code, label: r.label, modules: r.modules ?? [], is_default: r.is_default,
  home_route: r.home_route ?? null, report_keys: r.report_keys ?? [], features: r.features ?? [],
});

const PACK_COLUMNS = `sp.code, sp.label, sp.enabled_modules AS modules, sp.is_default, sp.home_route, sp.report_keys, sp.features`;

// Les modules effectifs sont lus à chaque requête par la garde serveur : cache court,
// vidé à chaque changement. Plusieurs instances serveur : le délai borne l'écart.
const CACHE_MS = 30_000;
let cache: { at: number; value: Activation } | null = null;

function computeFeatures(packFeatures: string[], overrides: ModuleOverrides, catalog: FeatureDef[], modules: Set<AppModule>): Set<string> {
  const set = new Set(packFeatures);
  for (const [k, on] of Object.entries(overrides)) {
    if (on === undefined) continue;
    if (on) set.add(k); else set.delete(k);
  }
  const moduleOf = new Map(catalog.map(f => [f.key, f.module_key]));
  return new Set([...set].filter(k => {
    const m = moduleOf.get(k);
    return m !== undefined && modules.has(canonicalModule(m as AppModule));
  }));
}

async function loadOverrides(table: 'company_module_settings' | 'company_feature_settings', key: string): Promise<ModuleOverrides> {
  const { rows } = await db.query(`SELECT ${key} AS k, enabled FROM ${table}`);
  const out: ModuleOverrides = {};
  for (const r of rows) out[r.k] = r.enabled;
  return out;
}

export const sectorRepository = {
  /** Tous les secteurs disponibles. */
  async list(): Promise<SectorPack[]> {
    const { rows } = await db.query(`SELECT ${PACK_COLUMNS} FROM sector_packs sp ORDER BY sp.is_default DESC, sp.label`);
    return rows.map(mapPack);
  },

  /** Secteur courant de la société (préréglage, sans les ajustements). Repli sur le
   *  pack par défaut si company_settings.sector_pack est vide ou pointe un code inconnu. */
  async current(): Promise<SectorPack> {
    const { rows } = await db.query(
      `SELECT ${PACK_COLUMNS}
         FROM company_settings cs
         JOIN sector_packs sp ON sp.code = cs.sector_pack
        WHERE cs.id = 1`);
    if (rows[0]) return mapPack(rows[0]);
    const { rows: def } = await db.query(`SELECT ${PACK_COLUMNS} FROM sector_packs sp ORDER BY sp.is_default DESC LIMIT 1`);
    return def[0] ? mapPack(def[0]) : { code: 'boulangerie', label: 'Boulangerie / Pâtisserie', modules: [], is_default: true, features: [] };
  },

  /** Libellés d'un secteur (phase 9.1) : clé neutre → valeur affichée. */
  async labels(code: string): Promise<Record<string, string>> {
    const { rows } = await db.query(`SELECT label_key, label_value FROM sector_labels WHERE sector_pack = $1`, [code]);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.label_key] = r.label_value;
    return map;
  },

  /** Préréglage + ajustements → modules et options effectifs (mis en cache). */
  async activation(): Promise<Activation> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    const [sector, moduleOverrides, featureOverrides, catalogRes] = await Promise.all([
      this.current(),
      loadOverrides('company_module_settings', 'module_key'),
      loadOverrides('company_feature_settings', 'feature_key'),
      db.query(`SELECT key, module_key, label, description, sort_order FROM app_features ORDER BY module_key, sort_order, label`),
    ]);
    const catalog = catalogRes.rows as FeatureDef[];
    const packModules = [...new Set(sector.modules.map(m => canonicalModule(m as AppModule)))];
    const modules = effectiveModules(sector.modules, moduleOverrides);
    const packFeatures = sector.features ?? [];
    const value: Activation = {
      sector, packModules, packFeatures, moduleOverrides, featureOverrides, catalog,
      modules, features: computeFeatures(packFeatures, featureOverrides, catalog, modules),
    };
    cache = { at: Date.now(), value };
    return value;
  },

  invalidate() { cache = null; },

  /**
   * Applique des ajustements : true = activer, false = désactiver, null = revenir au
   * préréglage. Refuse un module inconnu, un module socle désactivé, une option
   * inconnue, et toute configuration où un module actif perd une dépendance (le
   * client propose les dépendances avant d'envoyer). Un ajustement égal au
   * préréglage n'est pas stocké : les tables ne gardent que les écarts.
   */
  async applyAdjustments(changes: AdjustmentChanges, userId?: string | null): Promise<{ error: string } | { activation: Activation }> {
    const current = await this.activation();
    const nextModules: ModuleOverrides = { ...current.moduleOverrides };
    const nextFeatures: ModuleOverrides = { ...current.featureOverrides };

    for (const [rawKey, value] of Object.entries(changes.modules ?? {})) {
      const key = canonicalModule(rawKey as AppModule);
      if (!ACTIVATABLE_MODULES.includes(key)) return { error: `Module inconnu : ${rawKey}` };
      if (value === false && CORE_MODULES.has(key)) return { error: `Le module « ${MODULE_LABELS[key]} » ne peut pas être désactivé` };
      if (value === null || value === current.packModules.includes(key)) delete nextModules[key];
      else nextModules[key] = value;
    }
    const known = new Set(current.catalog.map(f => f.key));
    for (const [key, value] of Object.entries(changes.features ?? {})) {
      if (!known.has(key)) return { error: `Option inconnue : ${key}` };
      if (value === null || value === current.packFeatures.includes(key)) delete nextFeatures[key];
      else nextFeatures[key] = value;
    }

    const missing = missingDependencies(effectiveModules(current.sector.modules, nextModules));
    if (missing.length) {
      const m = missing[0];
      return { error: `« ${MODULE_LABELS[m.module]} » a besoin de : ${m.missing.map(d => `« ${MODULE_LABELS[d]} »`).join(', ')}` };
    }

    await this.writeOverrides(nextModules, nextFeatures, current, userId);
    return { activation: await this.activation() };
  },

  /** Revient au préréglage du secteur : supprime tous les ajustements. */
  async resetAdjustments(userId?: string | null): Promise<Activation> {
    await this.writeOverrides({}, {}, await this.activation(), userId);
    return this.activation();
  },

  /** Réécrit les écarts dans une transaction, en ne touchant que les lignes qui
   *  changent (le journal du paramétrage ne garde que les vrais changements). */
  async writeOverrides(nextModules: ModuleOverrides, nextFeatures: ModuleOverrides, current: Activation, userId?: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, userId);
      const sync = async (table: string, key: string, before: ModuleOverrides, after: ModuleOverrides) => {
        for (const k of Object.keys(before)) {
          if (after[k] === undefined) await client.query(`DELETE FROM ${table} WHERE ${key} = $1`, [k]);
        }
        for (const [k, on] of Object.entries(after)) {
          if (on === undefined || before[k] === on) continue;
          await client.query(
            `INSERT INTO ${table} (${key}, enabled, updated_by, updated_at) VALUES ($1, $2, $3, now())
             ON CONFLICT (${key}) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [k, on, userId ?? null]);
        }
      };
      await sync('company_module_settings', 'module_key', current.moduleOverrides, nextModules);
      await sync('company_feature_settings', 'feature_key', current.featureOverrides, nextFeatures);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
      this.invalidate();
    }
  },

  /** Change le secteur de la société. Renvoie null si le code n'existe pas.
   *  keepAdjustments = false : repart du préréglage du nouveau secteur. */
  async setSector(code: string, opts: { keepAdjustments?: boolean; userId?: string | null } = {}): Promise<SectorPack | null> {
    const exists = (await db.query(`SELECT 1 FROM sector_packs WHERE code = $1`, [code])).rows[0];
    if (!exists) return null;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, opts.userId);
      await client.query(`UPDATE company_settings SET sector_pack = $1, updated_at = now() WHERE id = 1`, [code]);
      if (opts.keepAdjustments === false) {
        await client.query(`DELETE FROM company_module_settings`);
        await client.query(`DELETE FROM company_feature_settings`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
      this.invalidate();
    }
    return this.current();
  },
};
