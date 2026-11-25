import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { invalidateWorkshops } from './workshops.js';
import { invalidateProcessRefs } from './process-referentials.js';
import { applyLayers, cleanLayers, describeLayers, type ProfileLayers } from './industry-profile.js';
import { invalidatePolicies } from './policies.js';
import { writeCompositionLines, type LineIngredient } from '../repositories/composition-lines.helper.js';

/**
 * Données de départ par secteur (phase 9.3, enrichi au lot P7 du plan Production générique).
 *
 * Le point clé : ces données ne sont PAS dans les migrations (sinon toute société neuve
 * recevrait les recettes de croissants). Elles vivent ici, en code, et se chargent À LA
 * DEMANDE pour le secteur choisi. Une société « Générique » ne reçoit que des catégories
 * transverses ; la boulangerie ne charge rien (son référentiel existe déjà).
 *
 * Le chargement est idempotent et n'écrase rien : chaque élément est repéré par son code
 * ou son slug et n'est créé que s'il manque. Un atelier ou un libellé modifié par la
 * société reste tel quel.
 */

type StarterCategory = { name: string; slug: string };
type StarterRef = { code: string; label: string; metadata?: Record<string, unknown> };
type StarterMaterial = { name: string; unit: string; unitCost: number; quantity: number };

type StarterPack = {
  categories: StarterCategory[];
  units?: StarterRef[];
  stepTypes?: StarterRef[];
  equipmentTypes?: StarterRef[];
  /** Atelier créé seulement si aucun atelier actif n'existe ; rattaché à la catégorie. */
  workshop?: { code: string; label: string; categorySlug: string };
  /** Nomenclature de démonstration : un article fabriqué, sa fiche et ses matières. */
  demo?: { productName: string; productSlug: string; categorySlug: string; price: number; materials: StarterMaterial[] };
  /** Couches production du profil (C-01, mig 586) : types d'ordre, politiques, impressions. */
  layers?: ProfileLayers;
};

const STARTER: Record<string, StarterPack> = {
  boulangerie: { categories: [] },
  generique: {
    categories: [
      { name: 'Marchandises', slug: 'starter-marchandises' },
      { name: 'Services', slug: 'starter-services' },
      { name: 'Divers', slug: 'starter-divers' },
    ],
  },
  negoce: {
    categories: [
      { name: 'Marchandises', slug: 'starter-marchandises' },
      { name: 'Accessoires', slug: 'starter-accessoires' },
    ],
  },
  // Industrie / Fabrication (mig 510) : produits fabriqués, revente et prestations,
  // plus de quoi lancer un premier ordre de fabrication sans rien paramétrer.
  fabrication: {
    categories: [
      { name: 'Produits finis', slug: 'starter-produits-finis' },
      { name: 'Marchandises', slug: 'starter-marchandises' },
      { name: 'Services', slug: 'starter-services' },
    ],
    // Mêmes conventions que la mig 513 (metadata ccp / default_param).
    stepTypes: [
      { code: 'preparation',     label: 'Préparation' },
      { code: 'usinage',         label: 'Usinage' },
      { code: 'assemblage',      label: 'Assemblage' },
      { code: 'controle',        label: 'Contrôle qualité', metadata: { default_param: 'poids' } },
      { code: 'conditionnement', label: 'Conditionnement' },
    ],
    equipmentTypes: [
      { code: 'machine',      label: 'Machine' },
      { code: 'poste_manuel', label: 'Poste manuel' },
      { code: 'outillage',    label: 'Outillage' },
    ],
    workshop: { code: 'atelier_principal', label: 'Atelier principal', categorySlug: 'starter-produits-finis' },
    // Le tube se stocke au mètre (unité ajoutée au référentiel par la mig 515).
    demo: {
      productName: 'Étagère métallique (démo)',
      productSlug: 'starter-demo-etagere',
      categorySlug: 'starter-produits-finis',
      price: 450,
      materials: [
        { name: 'Tôle acier (démo)', unit: 'kg',   unitCost: 14,  quantity: 6.5 },
        { name: 'Tube carré (démo)', unit: 'm',    unitCost: 22,  quantity: 4 },
        { name: 'Vis M6 (démo)',     unit: 'unit', unitCost: 0.3, quantity: 24 },
        { name: 'Peinture (démo)',   unit: 'l',    unitCost: 90,  quantity: 0.4 },
      ],
    },
  },
};

export type StarterResult = {
  categories: number;
  units: number;
  stepTypes: number;
  equipmentTypes: number;
  workshops: number;
  demo: number;
  /** Couches production appliquées (C-01). */
  orderTypes: number;
  policies: number;
  printTemplates: number;
  /** Spécialisations activées (modèle v3, mig 633). */
  specializations?: number;
};

type Client = Awaited<ReturnType<typeof db.getClient>>;

async function insertRefs(client: Client, tableId: string, refs: StarterRef[] | undefined): Promise<number> {
  let created = 0;
  for (const [i, r] of (refs ?? []).entries()) {
    const res = await client.query(
      `INSERT INTO ref_entries (table_id, code, label, display_order, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (table_id, code) DO NOTHING RETURNING id`,
      [tableId, r.code, r.label, 200 + i * 10, JSON.stringify(r.metadata ?? {})]);
    if (res.rows[0]) created++;
  }
  return created;
}

async function categoryId(client: Client, slug: string): Promise<number | null> {
  const r = await client.query(`SELECT id FROM categories WHERE slug = $1`, [slug]);
  return r.rows[0]?.id ?? null;
}

async function loadWorkshop(client: Client, w: NonNullable<StarterPack['workshop']>): Promise<number> {
  // Une société qui a déjà ses ateliers les garde : on ne crée que le premier.
  const any = await client.query(`SELECT 1 FROM production_workshops WHERE is_active LIMIT 1`);
  if (any.rows[0]) return 0;
  const hasDefault = await client.query(`SELECT 1 FROM production_workshops WHERE is_default LIMIT 1`);
  const ins = await client.query(
    `INSERT INTO production_workshops (code, label, is_default, is_active, sort_order, updated_at)
     VALUES ($1, $2, $3, true, 10, now()) ON CONFLICT (code) DO NOTHING RETURNING code`,
    [w.code, w.label, !hasDefault.rows[0]]);
  if (!ins.rows[0]) return 0;
  const cat = await categoryId(client, w.categorySlug);
  if (cat != null) {
    await client.query(
      `INSERT INTO production_workshop_categories (category_id, workshop_code) VALUES ($1, $2) ON CONFLICT (category_id) DO NOTHING`,
      [cat, w.code]);
  }
  return 1;
}

async function loadDemo(client: Client, d: NonNullable<StarterPack['demo']>): Promise<number> {
  const exists = await client.query(`SELECT 1 FROM products WHERE slug = $1`, [d.productSlug]);
  if (exists.rows[0]) return 0;
  const cost = Math.round(d.materials.reduce((s, m) => s + m.unitCost * m.quantity, 0) * 100) / 100;
  const product = await client.query(
    `INSERT INTO products (name, slug, category_id, description, price, cost_price, sale_type, item_kind)
     VALUES ($1, $2, $3, $4, $5, $6, 'commande', 'manufactured') RETURNING id`,
    [d.productName, d.productSlug, await categoryId(client, d.categorySlug),
     'Article de démonstration chargé avec les données de départ. Vous pouvez le modifier ou le supprimer.',
     d.price, cost]);
  const recipe = await client.query(
    `INSERT INTO recipes (product_id, name, yield_quantity, yield_unit, total_cost)
     VALUES ($1, $2, 1, 'unit', $3) RETURNING id`,
    [product.rows[0].id, d.productName, cost]);
  const lines: LineIngredient[] = [];
  for (const m of d.materials) {
    // Matière réutilisée si elle existe déjà sous ce nom (rejeu après suppression de l'article).
    const found = await client.query(`SELECT id FROM ingredients WHERE name = $1 LIMIT 1`, [m.name]);
    const ingredientId = found.rows[0]?.id ?? (await client.query(
      `INSERT INTO ingredients (name, unit, unit_cost) VALUES ($1, $2, $3) RETURNING id`,
      [m.name, m.unit, m.unitCost])).rows[0].id;
    lines.push({ ingredientId, quantity: m.quantity, unit: m.unit });
  }
  // Pas 2b-1 : composition dans la nomenclature du format par défaut (seul modèle lu).
  await writeCompositionLines(client, recipe.rows[0].id, { ingredients: lines });
  return 1;
}

/**
 * Pack d'un secteur : en code pour les secteurs livrés, en base (sector_packs.starter,
 * mig 517) pour un secteur personnalisé issu d'un modèle de configuration (P10).
 */
export async function starterPackFor(sectorCode: string): Promise<StarterPack> {
  const { rows } = await db.query(`SELECT starter, profile, is_custom, base_sector FROM sector_packs WHERE code = $1`, [sectorCode]);
  const row = rows[0];
  // Mig 633 : couches héritées de toute la chaîne de parents (l'enfant l'emporte).
  const { sectorRepository } = await import('../repositories/sector.repository.js');
  const layers = cleanLayers((await sectorRepository.resolvedProfile(sectorCode)) ?? row?.profile ?? {}, []);
  if (STARTER[sectorCode]) return { ...STARTER[sectorCode], layers };
  // Profil de référence livré (mig 586) : données de départ de son secteur de base + ses couches.
  // Mig 633 : le plus proche parent de la chaîne qui a des données de départ livrées.
  if (row && !row.is_custom) {
    const lineage = (await sectorRepository.pack(sectorCode))?.lineage ?? [];
    for (const c of [...lineage].reverse()) if (STARTER[c]) return { ...STARTER[c], layers };
  }
  const st = (row?.is_custom ? row.starter ?? {} : {}) as { units?: StarterRef[]; stepTypes?: StarterRef[]; equipmentTypes?: StarterRef[] };
  return { categories: [], units: st.units ?? [], stepTypes: st.stepTypes ?? [], equipmentTypes: st.equipmentTypes ?? [], layers };
}

export async function loadSectorStarter(sectorCode: string, userId?: string, opts: { demo?: boolean } = {}): Promise<StarterResult> {
  const pack = await starterPackFor(sectorCode);
  const result: StarterResult = { categories: 0, units: 0, stepTypes: 0, equipmentTypes: 0, workshops: 0, demo: 0, orderTypes: 0, policies: 0, printTemplates: 0 };
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await setAuditUser(client, userId);
    for (const c of pack.categories) {
      const r = await client.query(
        `INSERT INTO categories (name, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
        [c.name, c.slug]);
      if (r.rows[0]) result.categories++;
    }
    result.units = await insertRefs(client, 'units', pack.units);
    result.stepTypes = await insertRefs(client, 'production_step_types', pack.stepTypes);
    result.equipmentTypes = await insertRefs(client, 'production_equipment_types', pack.equipmentTypes);
    if (pack.workshop) result.workshops = await loadWorkshop(client, pack.workshop);
    if (pack.demo && opts.demo !== false) result.demo = await loadDemo(client, pack.demo);
    if (pack.layers) {
      const l = await applyLayers(client, pack.layers, userId);
      result.orderTypes = l.orderTypes; result.policies = l.policies; result.printTemplates = l.printTemplates;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    invalidateWorkshops();
    invalidateProcessRefs();
    // Politiques du profil écrites hors de setPolicy (applyLayers) : vider le cache des politiques.
    invalidatePolicies();
  }
  // Modèle v3 (mig 633) : spécialisations du secteur enregistré, activées sans rien écraser.
  const sp = await db.query(`SELECT starter->'specializations' AS s FROM sector_packs WHERE code = $1 AND is_custom`, [sectorCode]);
  const wanted = Array.isArray(sp.rows[0]?.s) ? (sp.rows[0].s as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (wanted.length) {
    const { specializationRepository } = await import('../repositories/specialization.repository.js');
    const active = new Set(await specializationRepository.active());
    for (const code of wanted) {
      if (active.has(code)) continue;
      const r = await specializationRepository.enable(code, userId);
      if (!('error' in r)) result.specializations = (result.specializations ?? 0) + 1;
    }
  }
  return result;
}

/** Aperçu de ce qui serait chargé (sans écrire) : catégories, puis une ligne par famille. */
export async function sectorStarterPreview(sectorCode: string): Promise<{ categories: string[]; items: string[] }> {
  const pack = await starterPackFor(sectorCode);
  const names = (refs?: StarterRef[]) => (refs ?? []).map(r => r.label).join(', ');
  const items: string[] = [];
  if (pack.categories.length) items.push(`Catégories : ${pack.categories.map(c => c.name).join(', ')}`);
  if (pack.units?.length) items.push(`Unités : ${names(pack.units)}`);
  if (pack.stepTypes?.length) items.push(`Types d'étape : ${names(pack.stepTypes)}`);
  if (pack.equipmentTypes?.length) items.push(`Types d'équipement : ${names(pack.equipmentTypes)}`);
  if (pack.workshop) items.push(`Atelier : ${pack.workshop.label} (seulement si aucun atelier n'existe)`);
  if (pack.demo) items.push(`Nomenclature de démonstration : ${pack.demo.productName}, ${pack.demo.materials.length} matières`);
  if (pack.layers) items.push(...describeLayers(pack.layers));
  return { categories: pack.categories.map(c => c.name), items };
}

/** Le pack du secteur contient-il une nomenclature de démonstration ? (mise en route P9) */
export function sectorStarterDemoSlug(sectorCode: string): string | null {
  return STARTER[sectorCode]?.demo?.productSlug ?? null;
}
