import * as XLSX from 'xlsx';
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { listDefs, coerce, mergeValues, type CfEntity, type FieldDef } from './custom-fields.js';

/**
 * Import générique de données (lot 7 étendu, mig 370).
 *
 *   1. modèle téléchargeable (colonnes de la fiche + champs personnalisés actifs) ;
 *   2. aperçu : les colonnes du fichier sont associées aux champs (automatiquement par
 *      leur nom, modifiable), chaque ligne est classée « création », « mise à jour »,
 *      « ignorée » ou « erreur » selon le mode, avec le motif par cellule ;
 *   3. validation : tout ou rien, refusée s'il reste une erreur ; une cellule vide ne
 *      remplace jamais une valeur existante ;
 *   4. journal (data_imports) et annulation du dernier import d'un type de fiche.
 * Les colonnes absentes de la base (migrations non passées) sont ignorées.
 */

type ColType = 'text' | 'email' | 'phone' | 'ice' | 'enum' | 'number' | 'integer' | 'boolean' | 'expense_category' | 'product_category' | 'custom';
export type ImportMode = 'upsert' | 'create' | 'update';
interface Column {
  header: string;
  field: string;            // colonne SQL, ou « cf:<code> » pour un champ personnalisé
  type: ColType;
  required?: boolean;       // exigé à la création
  max?: number;
  options?: string[];
  example: string;
  help?: string;
  cf?: FieldDef;
}
interface EntityDef {
  key: 'suppliers' | 'customers' | 'ingredients' | 'packaging_items' | 'products';
  label: string;
  table: string;
  cfEntity: CfEntity;
  columns: Column[];
  /** Clé de rapprochement avec une fiche existante, par ordre de priorité. */
  matchOn: string[];
  /** Modes permis (produits : mise à jour seulement, la création passe par la fiche technique). */
  modes: ImportMode[];
  /** Valeurs posées à la création si la colonne est vide. */
  createDefaults?: Record<string, unknown>;
  note?: string;
}

const UNITS = ['kg', 'g', 'l', 'ml', 'unit', 'piece'];

export const IMPORT_ENTITIES: EntityDef[] = [
  {
    key: 'suppliers', label: 'Fournisseurs', table: 'suppliers', cfEntity: 'supplier', matchOn: ['ice', 'name'], modes: ['upsert', 'create', 'update'],
    columns: [
      { header: 'Nom', field: 'name', type: 'text', required: true, max: 150, example: 'Moulins du Maghreb' },
      { header: 'Raison sociale', field: 'legal_name', type: 'text', max: 150, example: 'MOULINS DU MAGHREB SA' },
      { header: 'ICE', field: 'ice', type: 'ice', example: '001234567000089', help: '15 chiffres' },
      { header: 'Contact', field: 'contact_name', type: 'text', max: 100, example: 'M. Alaoui' },
      { header: 'Téléphone', field: 'phone', type: 'phone', example: '0522 00 00 00' },
      { header: 'E-mail', field: 'email', type: 'email', example: 'commandes@moulins.ma' },
      { header: 'Adresse', field: 'address', type: 'text', max: 300, example: 'Zone industrielle, lot 12' },
      { header: 'Ville', field: 'city', type: 'text', max: 100, example: 'Casablanca' },
      { header: 'Régime TVA', field: 'vat_regime', type: 'enum', options: ['assujetti', 'non_assujetti', 'exonere'], example: 'assujetti' },
      { header: 'Notes', field: 'notes', type: 'text', max: 1000, example: '' },
    ],
  },
  {
    key: 'customers', label: 'Clients', table: 'customers', cfEntity: 'customer', matchOn: ['email', 'phone'], modes: ['upsert', 'create', 'update'],
    createDefaults: { customer_type: 'particulier' },
    columns: [
      { header: 'Prénom', field: 'first_name', type: 'text', max: 100, example: 'Salma' },
      { header: 'Nom', field: 'last_name', type: 'text', max: 100, example: 'Bennani' },
      { header: 'Société', field: 'company_name', type: 'text', max: 150, example: '' },
      { header: 'Type', field: 'customer_type', type: 'enum', options: ['particulier', 'professionnel', 'association', 'revendeur'], example: 'particulier' },
      { header: 'Téléphone', field: 'phone', type: 'phone', example: '0661 00 00 00' },
      { header: 'E-mail', field: 'email', type: 'email', example: 'salma@example.ma' },
      { header: 'Adresse', field: 'address', type: 'text', max: 300, example: '' },
      { header: 'Ville', field: 'city', type: 'text', max: 100, example: 'Mohammedia' },
      { header: 'ICE', field: 'ice', type: 'ice', example: '', help: 'Clients professionnels : 15 chiffres' },
      { header: 'Délai de paiement (jours)', field: 'delai_paiement_jours', type: 'integer', example: '' },
      { header: 'Remise (%)', field: 'remise_pct', type: 'number', example: '' },
      { header: 'Plafond de crédit', field: 'credit_limit', type: 'number', example: '' },
      { header: 'Notes', field: 'notes', type: 'text', max: 1000, example: '' },
    ],
  },
  {
    key: 'ingredients', label: 'Matières premières', table: 'ingredients', cfEntity: 'ingredient', matchOn: ['name'], modes: ['upsert', 'create', 'update'],
    createDefaults: { unit_cost: 0 },
    note: 'Le stock ne s\'importe pas ici : il se saisit à la réception ou par un inventaire.',
    columns: [
      { header: 'Nom', field: 'name', type: 'text', required: true, max: 200, example: 'Farine T55' },
      { header: 'Unité', field: 'unit', type: 'enum', required: true, options: UNITS, example: 'kg', help: 'kg, g, l, ml, unit ou piece' },
      { header: 'Coût unitaire', field: 'unit_cost', type: 'number', example: '6.50', help: 'En DH par unité' },
      { header: 'Catégorie', field: 'category_id', type: 'expense_category', example: 'Farines', help: 'Nom d\'une catégorie du référentiel' },
      { header: 'Fournisseur habituel', field: 'supplier', type: 'text', max: 150, example: 'Moulins du Maghreb' },
      { header: 'Taille du contenant', field: 'container_size', type: 'number', example: '25', help: 'Quantité par sac, seau, carton…' },
      { header: 'Durée de conservation (jours)', field: 'default_shelf_life_days', type: 'integer', example: '' },
    ],
  },
  {
    key: 'packaging_items', label: 'Consommables', table: 'packaging_items', cfEntity: 'packaging_item', matchOn: ['name'], modes: ['upsert', 'create', 'update'],
    note: 'Le stock ne s\'importe pas ici : il se saisit à la réception ou par un inventaire.',
    columns: [
      { header: 'Nom', field: 'name', type: 'text', required: true, max: 200, example: 'Boîte pâtissière 20 cm' },
      { header: 'Format', field: 'format', type: 'text', max: 100, example: '20 x 20 x 8' },
      { header: 'Unité', field: 'unit', type: 'enum', options: UNITS, example: 'piece' },
      { header: 'Coût unitaire', field: 'unit_cost', type: 'number', example: '2.40' },
      { header: 'Catégorie', field: 'category_id', type: 'expense_category', example: 'Emballages', help: 'Nom d\'une catégorie du référentiel' },
      { header: 'Fournisseur', field: 'supplier', type: 'text', max: 150, example: '' },
      { header: 'Notes', field: 'notes', type: 'text', max: 1000, example: '' },
    ],
  },
  {
    key: 'products', label: 'Produits (mise à jour)', table: 'products', cfEntity: 'product', matchOn: ['sku', 'name'], modes: ['update'],
    note: 'Mise à jour seulement : un nouveau produit se crée avec sa fiche technique.',
    columns: [
      { header: 'Nom', field: 'name', type: 'text', max: 200, example: 'Croissant au beurre', help: 'Sert à retrouver le produit' },
      { header: 'Référence', field: 'sku', type: 'text', max: 60, example: '', help: 'Sert à retrouver le produit en priorité' },
      { header: 'Prix de vente', field: 'price', type: 'number', example: '6.00' },
      { header: 'Catégorie', field: 'category_id', type: 'product_category', example: 'Viennoiseries' },
      { header: 'Disponible', field: 'is_available', type: 'boolean', example: 'oui' },
      { header: 'Description', field: 'description', type: 'text', max: 1000, example: '' },
    ],
  },
];

export const entityByKey = (k: string) => IMPORT_ENTITIES.find(e => e.key === k);

/** Colonnes de l'entité réellement présentes dans la base, plus les champs personnalisés actifs. */
async function columnsFor(def: EntityDef): Promise<Column[]> {
  const r = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [def.table]);
  const cols = new Set(r.rows.map((x: { column_name: string }) => x.column_name));
  const base = def.columns.filter(c => cols.has(c.field));
  if (!cols.has('custom_fields')) return base;
  const defs = await listDefs(def.cfEntity);
  return [...base, ...defs.map(d => ({
    header: d.label, field: `cf:${d.code}`, type: 'custom' as const, required: d.required, cf: d,
    options: d.field_type === 'select' ? d.options : undefined,
    example: d.field_type === 'select' ? d.options[0] ?? '' : d.field_type === 'boolean' ? 'oui' : d.field_type === 'date' ? '31/12/2026' : '',
    help: d.help ?? ({ text: 'Texte', number: 'Nombre', date: 'Date JJ/MM/AAAA', select: `Une de : ${d.options.join(', ')}`, boolean: 'oui ou non' } as const)[d.field_type],
  }))];
}

/** Modèle Excel : feuille de saisie (en-têtes + exemple) et feuille de consignes. */
export async function buildTemplate(def: EntityDef): Promise<Buffer> {
  const cols = await columnsFor(def);
  const wb = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([cols.map(c => c.header), cols.map(c => c.example)]);
  data['!cols'] = cols.map(c => ({ wch: Math.max(14, c.header.length + 2) }));
  XLSX.utils.book_append_sheet(wb, data, def.label.slice(0, 31));
  const help = XLSX.utils.aoa_to_sheet([
    ['Colonne', 'Obligatoire à la création', 'Format'],
    ...cols.map(c => [c.header, c.required ? 'Oui' : 'Non',
      c.options && c.type !== 'custom' ? `Une de : ${c.options.join(', ')}` : c.help ?? (c.type === 'email' ? 'Adresse e-mail' : c.type === 'integer' ? 'Nombre entier' : c.type === 'number' ? 'Nombre' : c.type === 'boolean' ? 'oui ou non' : 'Texte')]),
    [],
    ['La ligne 2 est un exemple : remplacez-la. Une cellule vide ne modifie pas une fiche existante.'],
    [`Fiche existante retrouvée par : ${def.matchOn.map(f => cols.find(c => c.field === f)?.header ?? f).join(', puis ')}.`],
    ...(def.note ? [[def.note]] : []),
  ]);
  help['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, help, 'Consignes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export interface PreviewRow {
  line: number;
  action: 'create' | 'update' | 'error' | 'skip';
  values: Record<string, unknown>;
  matchedId: string | null;
  errors: { column: string; message: string }[];
  reason?: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

type Lookups = { expense: Map<string, string[]>; product: Map<string, string[]> };
async function loadLookups(cols: Column[]): Promise<Lookups> {
  const expense = new Map<string, string[]>(); const product = new Map<string, string[]>();
  if (cols.some(c => c.type === 'expense_category')) {
    // Feuilles d'abord : une catégorie « Farines » feuille l'emporte sur un nœud homonyme.
    const r = await db.query(`SELECT e.id, e.name FROM expense_categories e
                               WHERE e.is_active IS NOT FALSE ORDER BY (EXISTS (SELECT 1 FROM expense_categories c WHERE c.parent_id = e.id)), e.name`);
    for (const x of r.rows) expense.set(norm(x.name), [...(expense.get(norm(x.name)) ?? []), x.id]);
  }
  if (cols.some(c => c.type === 'product_category')) {
    const r = await db.query(`SELECT id, name FROM categories`);
    for (const x of r.rows) product.set(norm(x.name), [...(product.get(norm(x.name)) ?? []), String(x.id)]);
  }
  return { expense, product };
}

function convert(c: Column, raw: unknown, lk: Lookups): { value?: unknown; error?: string } {
  if (c.type === 'custom') {
    const r = coerce(c.cf!, raw);
    return r.error ? { error: r.error } : r.value === null ? {} : { value: r.value };
  }
  if (raw instanceof Date) raw = raw.toISOString().slice(0, 10);
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!s) return {};
  switch (c.type) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s.toLowerCase() } : { error: 'e-mail invalide' };
    case 'phone': {
      const p = s.replace(/[^\d+]/g, '');
      return p.length >= 9 && p.length <= 15 ? { value: s } : { error: 'téléphone invalide' };
    }
    case 'ice': { const d = s.replace(/\s/g, ''); return /^\d{15}$/.test(d) ? { value: d } : { error: 'ICE : 15 chiffres' }; }
    case 'enum': {
      const v = s.toLowerCase().replace(/[\s-]+/g, '_');
      const alias: Record<string, string> = { pieces: 'piece', 'pièce': 'piece', unite: 'unit', 'unité': 'unit', u: 'unit', litre: 'l', litres: 'l', kilo: 'kg', kilos: 'kg', gramme: 'g', grammes: 'g' };
      const val = c.options!.includes(v) ? v : alias[v];
      return val && c.options!.includes(val) ? { value: val } : { error: `valeur attendue : ${c.options!.join(', ')}` };
    }
    case 'integer': case 'number': {
      const n = Number(s.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return { error: 'nombre positif attendu' };
      if (c.type === 'integer' && !Number.isInteger(n)) return { error: 'nombre entier attendu' };
      return { value: n };
    }
    case 'boolean': {
      const v = s.toLowerCase();
      if (['oui', 'o', 'yes', '1', 'true', 'vrai', 'x'].includes(v)) return { value: true };
      if (['non', 'n', 'no', '0', 'false', 'faux'].includes(v)) return { value: false };
      return { error: 'oui ou non attendu' };
    }
    case 'expense_category': case 'product_category': {
      const hits = (c.type === 'expense_category' ? lk.expense : lk.product).get(norm(s)) ?? [];
      return hits.length ? { value: hits[0] } : { error: `catégorie « ${s} » introuvable` };
    }
    default: return c.max && s.length > c.max ? { error: `${c.max} caractères maximum` } : { value: s };
  }
}

export type PreviewOptions = { mapping?: Record<string, string> | null; mode?: ImportMode };

/**
 * Classeur Excel, ou CSV lu en UTF-8 (sinon les accents arrivent en Latin-1 : « UnitÃ© »).
 * Séparateur « ; » reconnu : c'est celui d'Excel en français.
 */
export function readWorkbook(buffer: Buffer) {
  const isZip = buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b; // .xlsx
  const isOle = buffer.length > 3 && buffer[0] === 0xd0 && buffer[1] === 0xcf; // .xls
  if (isZip || isOle) return XLSX.read(buffer, { type: 'buffer', cellDates: true });
  let text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) text = buffer.toString('latin1'); // CSV enregistré en Windows-1252
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const semi = (first.match(/;/g) ?? []).length; const comma = (first.match(/,/g) ?? []).length;
  // raw : cellules gardées en texte (sinon « 7,5 » devient 75, la virgule lue comme séparateur de milliers) ;
  // nombres et dates sont convertis ensuite par l'import (virgule décimale, JJ/MM/AAAA).
  return XLSX.read(text, { type: 'string', raw: true, ...(semi > comma ? { FS: ';' } : {}) });
}

/** Lecture du fichier et classement de chaque ligne, sans rien écrire. */
export async function previewImport(def: EntityDef, buffer: Buffer, opts: PreviewOptions = {}) {
  const mode: ImportMode = opts.mode && def.modes.includes(opts.mode) ? opts.mode : def.modes[0];
  const wb = readWorkbook(buffer);
  const sheet = wb.Sheets[wb.SheetNames.find(n => n !== 'Consignes') ?? wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false, raw: true });
  const cols = await columnsFor(def);
  const fields = cols.map(c => ({ key: c.field, header: c.header, required: !!c.required, custom: c.type === 'custom', match: def.matchOn.includes(c.field) }));
  if (!matrix.length) return { rows: [] as PreviewRow[], headers: [], mapping: {}, fields, unknownHeaders: [], columns: cols.map(c => c.header), mode, modes: def.modes };

  // Association colonnes du fichier → champs : celle fournie, sinon par le nom.
  const headers = (matrix[0] as unknown[]).map(h => String(h ?? '').trim());
  const mapping: Record<string, string> = {};
  headers.forEach(h => {
    if (!h) return;
    if (opts.mapping && h in opts.mapping) { mapping[h] = opts.mapping[h]; return; }
    const c = cols.find(x => norm(x.header) === norm(h) || norm(x.field.replace(/^cf:/, '')) === norm(h));
    mapping[h] = c?.field ?? '';
  });
  const colIndex = new Map<Column, number>();
  headers.forEach((h, i) => {
    const c = cols.find(x => x.field === mapping[h]);
    if (c && !colIndex.has(c)) colIndex.set(c, i);
  });
  const unknownHeaders = headers.filter(h => h && !mapping[h]);
  const lk = await loadLookups(cols);

  // Fiches existantes pour le rapprochement (et leurs champs personnalisés).
  const matchCols = def.matchOn.filter(f => cols.some(c => c.field === f));
  const existing = (await db.query(`SELECT id, custom_fields, ${matchCols.join(', ')} FROM ${def.table}`)).rows as Record<string, any>[];
  const byId = new Map(existing.map(r => [r.id as string, r]));
  const keyOf = (f: string, v: unknown) => (f === 'phone' ? String(v ?? '').replace(/\D/g, '').slice(-9) : f === 'name' ? norm(String(v ?? '')) : String(v ?? '').toLowerCase().trim());
  const index = new Map<string, Map<string, string>>(matchCols.map(f => [f, new Map(existing.filter(r => r[f]).map(r => [keyOf(f, r[f]), r.id as string]))]));
  const seen = new Map<string, number>();
  const cfDefs = cols.filter(c => c.type === 'custom').map(c => c.cf!);

  const rows: PreviewRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i] as unknown[];
    const values: Record<string, unknown> = {};
    const errors: PreviewRow['errors'] = [];
    for (const [c, idx] of colIndex) {
      const r = convert(c, raw[idx], lk);
      if (r.error) errors.push({ column: c.header, message: r.error });
      else if (r.value !== undefined) values[c.field] = r.value;
    }
    if (Object.keys(values).length === 0 && errors.length === 0) {
      rows.push({ line: i + 1, action: 'skip', values, matchedId: null, errors: [], reason: 'ligne vide' });
      continue;
    }
    let matchedId: string | null = null;
    for (const f of matchCols) {
      if (values[f] === undefined) continue;
      const k = keyOf(f, values[f]);
      const dup = seen.get(`${f}:${k}`);
      if (dup) errors.push({ column: cols.find(c => c.field === f)!.header, message: `en double avec la ligne ${dup}` });
      seen.set(`${f}:${k}`, i + 1);
      matchedId = matchedId ?? index.get(f)?.get(k) ?? null;
    }
    // Mode : une fiche retrouvée en « créer seulement », ou introuvable en « mettre à jour seulement », est ignorée.
    if (matchedId && mode === 'create') { rows.push({ line: i + 1, action: 'skip', values, matchedId, errors: [], reason: 'fiche déjà existante' }); continue; }
    if (!matchedId && mode === 'update') {
      rows.push({ line: i + 1, action: errors.length ? 'error' : 'skip', values, matchedId: null, errors, reason: 'fiche introuvable' });
      continue;
    }
    if (!matchedId) {
      for (const c of cols.filter(x => x.required && x.type !== 'custom')) if (values[c.field] === undefined) errors.push({ column: c.header, message: 'obligatoire' });
      if (def.key === 'customers' && !values.first_name && !values.last_name && !values.company_name) errors.push({ column: 'Nom', message: 'nom, prénom ou société requis' });
    }
    // Champs personnalisés : obligatoires contrôlés sur le résultat (création ou fiche existante complétée).
    const cfInput = Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith('cf:')).map(([k, v]) => [k.slice(3), v]));
    if (cfDefs.length) {
      const current = matchedId ? (byId.get(matchedId)?.custom_fields ?? {}) : {};
      const m = mergeValues(cfDefs, current, cfInput);
      for (const [code, msg] of Object.entries(m.errors)) {
        if (!errors.some(e => e.column === cfDefs.find(d => d.code === code)?.label)) errors.push({ column: cfDefs.find(d => d.code === code)!.label, message: msg.split(' : ').slice(1).join(' : ') || msg });
      }
    }
    rows.push({ line: i + 1, action: errors.length ? 'error' : matchedId ? 'update' : 'create', values, matchedId, errors });
  }
  return { rows, headers: headers.filter(Boolean), mapping, fields, unknownHeaders, columns: cols.map(c => c.header), mode, modes: def.modes };
}

/** Écriture tout ou rien, journalisée ; refusée s'il reste une erreur. */
export async function commitImport(def: EntityDef, buffer: Buffer, ctx: { actorId?: string; storeId?: string | null; fileName?: string } & PreviewOptions) {
  const p = await previewImport(def, buffer, ctx);
  const errors = p.rows.filter(r => r.action === 'error');
  if (errors.length) return { ok: false as const, errors: errors.length };
  const client = await db.getClient();
  let created = 0, updated = 0;
  try {
    await client.query('BEGIN');
    await setAuditUser(client, ctx.actorId);
    const imp = await client.query(
      `INSERT INTO data_imports (entity, file_name, mode, mapping, skipped_count, store_id, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id`,
      [def.key, ctx.fileName ?? null, p.mode, JSON.stringify(p.mapping), p.rows.filter(r => r.action === 'skip').length, ctx.storeId ?? null, ctx.actorId ?? null]);
    const importId = imp.rows[0].id as string;
    for (const r of p.rows) {
      if (r.action !== 'create' && r.action !== 'update') continue;
      const dbFields = Object.entries(r.values).filter(([k]) => !k.startsWith('cf:'));
      const cfPatch = Object.fromEntries(Object.entries(r.values).filter(([k]) => k.startsWith('cf:')).map(([k, v]) => [k.slice(3), v]));
      if (r.action === 'create') {
        const extra = Object.entries(def.createDefaults ?? {}).filter(([k]) => !(k in r.values));
        const all: [string, unknown][] = [...dbFields, ...extra, ['custom_fields', JSON.stringify(cfPatch)]];
        const ins = await client.query(
          `INSERT INTO ${def.table} (${all.map(e => e[0]).join(', ')}) VALUES (${all.map((e, i) => (e[0] === 'custom_fields' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')}) RETURNING id`,
          all.map(e => e[1]));
        const id = ins.rows[0].id as string;
        // Matière : ligne de stock du magasin, comme la création depuis la fiche.
        if (def.key === 'ingredients' && ctx.storeId) {
          await client.query(`INSERT INTO inventory (ingredient_id, store_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, ctx.storeId]);
        }
        await client.query(`INSERT INTO data_import_rows (import_id, line, record_id, action) VALUES ($1, $2, $3, 'create')`, [importId, r.line, id]);
        created++;
      } else {
        const cols = dbFields.map(e => e[0]);
        const before = (await client.query(`SELECT ${[...cols, 'custom_fields'].join(', ')} FROM ${def.table} WHERE id = $1 FOR UPDATE`, [r.matchedId])).rows[0];
        const sets = dbFields.map((e, i) => `${e[0]} = $${i + 2}`);
        if (Object.keys(cfPatch).length) sets.push(`custom_fields = custom_fields || $${dbFields.length + 2}::jsonb`);
        if (sets.length) {
          await client.query(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = $1`,
            [r.matchedId, ...dbFields.map(e => e[1]), ...(Object.keys(cfPatch).length ? [JSON.stringify(cfPatch)] : [])]);
        }
        await client.query(`INSERT INTO data_import_rows (import_id, line, record_id, action, before) VALUES ($1, $2, $3, 'update', $4::jsonb)`,
          [importId, r.line, r.matchedId, JSON.stringify(before)]);
        updated++;
      }
    }
    await client.query(`UPDATE data_imports SET created_count = $2, updated_count = $3 WHERE id = $1`, [importId, created, updated]);
    await client.query('COMMIT');
    return { ok: true as const, created, updated, importId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listImports(limit = 30) {
  const r = await db.query(
    `SELECT i.*, concat_ws(' ', u.first_name, u.last_name) AS by_name, concat_ws(' ', uu.first_name, uu.last_name) AS undone_by_name,
            (i.status = 'done' AND i.created_at = (SELECT max(x.created_at) FROM data_imports x WHERE x.entity = i.entity AND x.status = 'done')) AS can_undo
       FROM data_imports i LEFT JOIN users u ON u.id = i.created_by LEFT JOIN users uu ON uu.id = i.undone_by
      ORDER BY i.created_at DESC LIMIT $1`, [limit]);
  return r.rows.map(x => ({ ...x, entity_label: entityByKey(x.entity)?.label ?? x.entity }));
}

/**
 * Annulation : valeurs d'avant remises sur les fiches mises à jour ; fiches créées
 * supprimées, ou désactivées si déjà utilisées (référencées ailleurs) ; sinon conservées.
 */
export async function undoImport(importId: string, actorId: string) {
  const client: PoolClient = await db.getClient();
  try {
    await client.query('BEGIN');
    await setAuditUser(client, actorId);
    const imp = (await client.query(`SELECT * FROM data_imports WHERE id = $1 FOR UPDATE`, [importId])).rows[0];
    if (!imp) { await client.query('ROLLBACK'); return { error: 'not_found' as const }; }
    if (imp.status !== 'done') { await client.query('ROLLBACK'); return { error: 'Import déjà annulé' }; }
    // Comparaison en SQL : created_at relu en JS perd les microsecondes (l'import se verrait « plus récent » que lui-même).
    const later = await client.query(
      `SELECT 1 FROM data_imports x WHERE x.entity = $1 AND x.status = 'done' AND x.id <> $2
          AND x.created_at > (SELECT created_at FROM data_imports WHERE id = $2)`, [imp.entity, importId]);
    if (later.rowCount) { await client.query('ROLLBACK'); return { error: 'Un import plus récent de ce type existe : annulez-le d\'abord' }; }
    const def = entityByKey(imp.entity);
    if (!def) { await client.query('ROLLBACK'); return { error: 'Type de données inconnu' }; }
    const hasActive = (await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'is_active'`, [def.table])).rowCount;
    const rows = (await client.query(`SELECT * FROM data_import_rows WHERE import_id = $1 ORDER BY line DESC`, [importId])).rows;
    let restored = 0, deleted = 0, deactivated = 0, kept = 0;
    for (const r of rows) {
      if (r.action === 'update') {
        const before = (r.before ?? {}) as Record<string, unknown>;
        const keys = Object.keys(before);
        if (!keys.length) continue;
        await client.query(`UPDATE ${def.table} SET ${keys.map((k, i) => `${k} = $${i + 2}${k === 'custom_fields' ? '::jsonb' : ''}`).join(', ')} WHERE id = $1`,
          [r.record_id, ...keys.map(k => (k === 'custom_fields' ? JSON.stringify(before[k] ?? {}) : before[k]))]);
        restored++;
      } else {
        await client.query('SAVEPOINT undo_row');
        try {
          if (def.key === 'ingredients') await client.query(`DELETE FROM inventory WHERE ingredient_id = $1 AND COALESCE(current_quantity, 0) = 0`, [r.record_id]);
          await client.query(`DELETE FROM ${def.table} WHERE id = $1`, [r.record_id]);
          await client.query('RELEASE SAVEPOINT undo_row');
          deleted++;
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT undo_row');
          if (hasActive) { await client.query(`UPDATE ${def.table} SET is_active = false WHERE id = $1`, [r.record_id]); deactivated++; } else kept++;
        }
      }
    }
    const report = { restored, deleted, deactivated, kept };
    await client.query(`UPDATE data_imports SET status = 'undone', undone_by = $2, undone_at = now(), undo_report = $3::jsonb WHERE id = $1`, [importId, actorId, JSON.stringify(report)]);
    await client.query('COMMIT');
    return { data: report };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
