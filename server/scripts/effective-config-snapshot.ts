// Instantané de la CONFIGURATION EFFECTIVE (plan d'exécution multi-industries, étape 0).
//
// Le chantier multi-industries remplace la copie des profils par un héritage, ajoute un
// catalogue de capacités, des spécialisations, une configuration versionnée… Chaque étape
// doit laisser IDENTIQUE la configuration vue par Ofauria. Ce script la photographie telle
// que le code la résout (dépôts et services, pas des requêtes recopiées), puis compare.
//
// LECTURE SEULE.
//
// Usage (depuis server/) :
//   npm run config:snapshot -- avant-etape-1
//   npm run config:compare -- avant-etape-1 apres-etape-1
//
// Sortie : server/scripts/reference/config-<nom>.json (dossier ignoré par git).
// `compare` rend le code de sortie 1 au premier écart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
const REF_DIR = path.join(here, 'reference');

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Tri profond et normalisation : deux configurations égales donnent le même texte. */
function stable(v: unknown): Json {
  if (v === null || v === undefined) return null;
  if (v instanceof Set) return [...v].map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(stable);
  if (typeof v === 'object') {
    const o: Record<string, Json> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) o[k] = stable(val);
    }
    return o;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v as Json;
}

async function capture(): Promise<Record<string, Json>> {
  const { sectorRepository } = await import('../src/repositories/sector.repository.js');
  const { policySnapshot } = await import('../src/services/policies.js');
  const { listWorkshops } = await import('../src/services/workshops.js');
  const { productionOrderTypeRepository } = await import('../src/repositories/production-order-type.repository.js');
  const { db } = await import('../src/config/database.js');

  const act = await sectorRepository.activation();
  const sector = act.sector.code;
  const labels = await sectorRepository.sectorLabels(sector);
  const overrides = await sectorRepository.labelOverrides();
  const strip = (o: Record<string, unknown>, keys: string[]) => {
    const c = { ...o };
    for (const k of keys) delete c[k];
    return c;
  };
  const policies = (await policySnapshot()).map((p) => strip(p as unknown as Record<string, unknown>, ['updated_at', 'updated_by']));
  const orderTypes = (await productionOrderTypeRepository.list(true)).map((t) =>
    strip(t as unknown as Record<string, unknown>, ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']));
  const workshops = (await listWorkshops()).map((w) => strip(w as unknown as Record<string, unknown>, ['id']));

  // Capacités (étape 1) : lues si le service existe dans cette version du code.
  let capabilities: unknown;
  try {
    const m = await import('../src/services/capabilities.js' as string);
    capabilities = m.effectiveCapabilities ? await m.effectiveCapabilities() : undefined;
  } catch { capabilities = undefined; }

  await db.pool.end().catch(() => undefined);
  return stable({
    sector,
    packModules: act.packModules,
    packFeatures: act.packFeatures,
    moduleOverrides: act.moduleOverrides,
    featureOverrides: act.featureOverrides,
    modules: act.modules,
    features: act.features,
    home_route: act.sector.home_route ?? null,
    report_keys: act.sector.report_keys ?? [],
    labels,
    labelOverrides: overrides.map((o) => ({ key: o.label_key, value: o.label_value })),
    policies,
    orderTypes,
    workshops,
    capabilities,
  }) as Record<string, Json>;
}

function diff(a: Json, b: Json, at: string, out: string[]) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diff((a as Record<string, Json>)[k] ?? null, (b as Record<string, Json>)[k] ?? null, `${at}.${k}`, out);
    }
    return;
  }
  out.push(`${at}\n    avant : ${JSON.stringify(a)}\n    après : ${JSON.stringify(b)}`);
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  fs.mkdirSync(REF_DIR, { recursive: true });
  const file = (n: string) => path.join(REF_DIR, `config-${n}.json`);
  if (cmd === 'capture' && a) {
    const snap = await capture();
    fs.writeFileSync(file(a), JSON.stringify(snap, null, 2));
    console.log(`Configuration effective enregistrée : ${file(a)}`);
    return;
  }
  if (cmd === 'compare' && a && b) {
    const before = JSON.parse(fs.readFileSync(file(a), 'utf8'));
    const after = JSON.parse(fs.readFileSync(file(b), 'utf8'));
    // Le catalogue de capacités n'existe qu'à partir de l'étape 1 : on ne compare que ce
    // que les deux captures ont en commun pour cette clé.
    if (!('capabilities' in before)) delete after.capabilities;
    const out: string[] = [];
    diff(before, after, 'config', out);
    if (out.length === 0) { console.log('Configuration effective identique.'); return; }
    console.log(`${out.length} écart(s) :\n  ${out.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Usage : capture <nom> | compare <avant> <après>');
  process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
