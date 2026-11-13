import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import {
  ACTIVATABLE_MODULES, CORE_MODULES, MODULE_LABELS, canonicalModule, effectiveModules, missingDependencies,
  type AppModule, type ModuleOverrides,
} from '@ofauria/shared';
import { describeDiff, diffActivation, type ActivationState, type ImpactDiff } from '../services/module-impact.js';

/**
 * Secteur d'activité (packs secteur, mig 468). Le secteur de la société est dans
 * company_settings.sector_pack ; chaque pack active une liste de modules. Le reste
 * du code lit `modules` (capacités), jamais le code du secteur : ajouter un secteur
 * = une ligne dans sector_packs, sans toucher au code.
 *
 * Activation (mig 507) : le secteur est un préréglage, ajusté module par module et
 * option par option (company_module_settings / company_feature_settings, écarts
 * seulement). Les modules et options EFFECTIFS se calculent ici et nulle part ailleurs.
 *
 * Versions (mig 508) : chaque changement enregistre l'état complet qui en résulte
 * (config_versions) ; on peut restaurer n'importe quelle version.
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

export type ConfigSnapshot = { sector: string; modules: ModuleOverrides; features: ModuleOverrides };

export type ConfigVersion = { id: number; created_at: string; created_by_name: string | null; label: string; snapshot: ConfigSnapshot };

type Target = { sector: SectorPack; modules: ModuleOverrides; features: ModuleOverrides };

const mapPack = (r: Record<string, any>): SectorPack => ({
  code: r.code, label: r.label, modules: r.modules ?? [], is_default: r.is_default,
  home_route: r.home_route ?? null, report_keys: r.report_keys ?? [], features: r.features ?? [],
});

const PACK_COLUMNS = `sp.code, sp.label, sp.enabled_modules AS modules, sp.is_default, sp.home_route, sp.report_keys, sp.features`;

// Les modules effectifs sont lus à chaque requête par la garde serveur : cache court,
// vidé à chaque changement. Plusieurs instances serveur : le délai borne l'écart.
const CACHE_MS = 30_000;
let cache: { at: number; value: Activation } | null = null;

const canonicalPack = (pack: SectorPack): AppModule[] => [...new Set(pack.modules.map(m => canonicalModule(m as AppModule)))];

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

/** Modules et options effectifs d'un état cible (secteur + écarts). */
function stateOf(target: Target, catalog: FeatureDef[]): ActivationState {
  const modules = effectiveModules(target.sector.modules, target.modules);
  return { modules, features: computeFeatures(target.sector.features ?? [], target.features, catalog, modules) };
}

/** Retire les écarts égaux au préréglage : les tables ne gardent que les vrais écarts. */
function normalize(target: Target): Target {
  const pack = canonicalPack(target.sector);
  const packFeatures = target.sector.features ?? [];
  const modules: ModuleOverrides = {};
  for (const [k, on] of Object.entries(target.modules)) {
    if (on !== undefined && on !== pack.includes(canonicalModule(k as AppModule))) modules[k] = on;
  }
  const features: ModuleOverrides = {};
  for (const [k, on] of Object.entries(target.features)) {
    if (on !== undefined && on !== packFeatures.includes(k)) features[k] = on;
  }
  return { sector: target.sector, modules, features };
}

const snapshotOf = (t: { sector: SectorPack; modules: ModuleOverrides; features: ModuleOverrides }): ConfigSnapshot =>
  ({ sector: t.sector.code, modules: t.modules, features: t.features });

async function loadOverrides(table: 'company_module_settings' | 'company_feature_settings', key: string): Promise<ModuleOverrides> {
  const { rows } = await db.query(`SELECT ${key} AS k, enabled FROM ${table}`);
  const out: ModuleOverrides = {};
  for (const r of rows) out[r.k] = r.enabled;
  return out;
}

async function syncOverrides(client: PoolClient, table: string, key: string, before: ModuleOverrides, after: ModuleOverrides, userId?: string | null) {
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
}

export const sectorRepository = {
  /** Tous les secteurs disponibles. */
  async list(): Promise<SectorPack[]> {
    const { rows } = await db.query(`SELECT ${PACK_COLUMNS} FROM sector_packs sp ORDER BY sp.is_default DESC, sp.label`);
    return rows.map(mapPack);
  },

  async pack(code: string): Promise<SectorPack | null> {
    const { rows } = await db.query(`SELECT ${PACK_COLUMNS} FROM sector_packs sp WHERE sp.code = $1`, [code]);
    return rows[0] ? mapPack(rows[0]) : null;
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
    const state = stateOf({ sector, modules: moduleOverrides, features: featureOverrides }, catalog);
    const value: Activation = {
      sector, packModules: canonicalPack(sector), packFeatures: sector.features ?? [],
      moduleOverrides, featureOverrides, catalog, modules: state.modules, features: state.features,
    };
    cache = { at: Date.now(), value };
    return value;
  },

  invalidate() { cache = null; },

  featureLabel(act: Activation) {
    const byKey = new Map(act.catalog.map(f => [f.key, f.label]));
    return (key: string) => byKey.get(key) ?? key;
  },

  /**
   * Calcule l'état visé par des ajustements, sans rien écrire : true = activer,
   * false = désactiver, null = revenir au préréglage. Refuse un module inconnu, un
   * module socle désactivé, une option inconnue, et toute configuration où un module
   * actif perd une dépendance (le client propose les dépendances avant d'envoyer).
   */
  async planAdjustments(changes: AdjustmentChanges): Promise<{ error: string } | { current: Activation; target: Target; diff: ImpactDiff }> {
    const current = await this.activation();
    const modules: ModuleOverrides = { ...current.moduleOverrides };
    const features: ModuleOverrides = { ...current.featureOverrides };

    for (const [rawKey, value] of Object.entries(changes.modules ?? {})) {
      const key = canonicalModule(rawKey as AppModule);
      if (!ACTIVATABLE_MODULES.includes(key)) return { error: `Module inconnu : ${rawKey}` };
      if (value === false && CORE_MODULES.has(key)) return { error: `Le module « ${MODULE_LABELS[key]} » ne peut pas être désactivé` };
      if (value === null) delete modules[key]; else modules[key] = value;
    }
    const known = new Set(current.catalog.map(f => f.key));
    for (const [key, value] of Object.entries(changes.features ?? {})) {
      if (!known.has(key)) return { error: `Option inconnue : ${key}` };
      if (value === null) delete features[key]; else features[key] = value;
    }

    const target = normalize({ sector: current.sector, modules, features });
    const after = stateOf(target, current.catalog);
    const missing = missingDependencies(after.modules);
    if (missing.length) {
      const m = missing[0];
      return { error: `« ${MODULE_LABELS[m.module]} » a besoin de : ${m.missing.map(d => `« ${MODULE_LABELS[d]} »`).join(', ')}` };
    }
    return { current, target, diff: diffActivation(current, after) };
  },

  async applyAdjustments(changes: AdjustmentChanges, userId?: string | null): Promise<{ error: string } | { activation: Activation }> {
    const plan = await this.planAdjustments(changes);
    if ('error' in plan) return plan;
    await this.commit(plan.current, plan.target, userId);
    return { activation: await this.activation() };
  },

  /** Revient au préréglage du secteur : supprime tous les ajustements. */
  async resetAdjustments(userId?: string | null): Promise<Activation> {
    const current = await this.activation();
    await this.commit(current, { sector: current.sector, modules: {}, features: {} }, userId, 'Retour au préréglage du secteur');
    return this.activation();
  },

  /** Change le secteur de la société. Renvoie null si le code n'existe pas.
   *  keepAdjustments = false : repart du préréglage du nouveau secteur. Avec true, les
   *  écarts devenus égaux au nouveau préréglage sont retirés (plus de faux « Ajusté »). */
  async setSector(code: string, opts: { keepAdjustments?: boolean; userId?: string | null } = {}): Promise<SectorPack | null> {
    const pack = await this.pack(code);
    if (!pack) return null;
    const current = await this.activation();
    const keep = opts.keepAdjustments !== false;
    const target = normalize({
      sector: pack,
      modules: keep ? current.moduleOverrides : {},
      features: keep ? current.featureOverrides : {},
    });
    await this.commit(current, target, opts.userId, `Secteur : ${pack.label}${keep ? '' : ' (préréglage)'}`);
    return this.current();
  },

  /**
   * Écrit un état cible dans une transaction : secteur, écarts (seules les lignes qui
   * changent, pour un journal du paramétrage lisible), puis une version. Si
   * l'historique est vide, l'état de départ est d'abord enregistré comme
   * « Configuration initiale » : le tout premier changement reste annulable.
   */
  async commit(current: Activation, target: Target, userId?: string | null, label?: string) {
    const before = { sector: current.sector, modules: current.moduleOverrides, features: current.featureOverrides };
    const after = stateOf(target, current.catalog);
    const summary = describeDiff(diffActivation(current, after), this.featureLabel(current));
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, userId);
      const { rows: existing } = await client.query(`SELECT 1 FROM config_versions LIMIT 1`);
      if (!existing.length) {
        await client.query(`INSERT INTO config_versions (created_by, label, snapshot) VALUES (NULL, $1, $2)`,
          ['Configuration initiale', JSON.stringify(snapshotOf(before))]);
      }
      if (target.sector.code !== current.sector.code) {
        await client.query(`UPDATE company_settings SET sector_pack = $1, updated_at = now() WHERE id = 1`, [target.sector.code]);
      }
      await syncOverrides(client, 'company_module_settings', 'module_key', current.moduleOverrides, target.modules, userId);
      await syncOverrides(client, 'company_feature_settings', 'feature_key', current.featureOverrides, target.features, userId);
      await client.query(`INSERT INTO config_versions (created_by, label, snapshot) VALUES ($1, $2, $3)`,
        [userId ?? null, label ? `${label} — ${summary}` : summary, JSON.stringify(snapshotOf(target))]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
      this.invalidate();
    }
  },

  /** Historique des configurations, de la plus récente à la plus ancienne. */
  async versions(limit = 50): Promise<ConfigVersion[]> {
    const { rows } = await db.query(
      `SELECT v.id::int AS id, v.created_at, v.label, v.snapshot,
              NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS created_by_name
         FROM config_versions v
         LEFT JOIN users u ON u.id = v.created_by
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT $1`, [limit]);
    return rows as ConfigVersion[];
  },

  /** Restaure une version : son secteur et ses écarts redeviennent la configuration
   *  courante (la restauration crée elle-même une nouvelle version). */
  async restoreVersion(id: number, userId?: string | null): Promise<{ error: string } | { activation: Activation }> {
    const { rows } = await db.query(`SELECT id, created_at, snapshot FROM config_versions WHERE id = $1`, [id]);
    if (!rows[0]) return { error: 'Version introuvable' };
    const snap = rows[0].snapshot as ConfigSnapshot;
    const pack = await this.pack(snap.sector);
    if (!pack) return { error: `Le secteur « ${snap.sector} » de cette version n'existe plus` };
    const current = await this.activation();
    const known = new Set(current.catalog.map(f => f.key));
    // Clés disparues depuis (module retiré, option supprimée) : ignorées.
    const modules: ModuleOverrides = {};
    for (const [k, on] of Object.entries(snap.modules ?? {})) {
      const key = canonicalModule(k as AppModule);
      if (ACTIVATABLE_MODULES.includes(key) && !(on === false && CORE_MODULES.has(key))) modules[key] = on;
    }
    const features: ModuleOverrides = {};
    for (const [k, on] of Object.entries(snap.features ?? {})) if (known.has(k)) features[k] = on;
    const target = normalize({ sector: pack, modules, features });
    const date = new Date(rows[0].created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Casablanca' });
    await this.commit(current, target, userId, `Restauration de la version du ${date}`);
    return { activation: await this.activation() };
  },
};
