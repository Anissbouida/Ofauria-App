import * as XLSX from 'xlsx';
import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';

/**
 * Import guidé de données de base (audit Paramètres, lot 7) : fournisseurs et
 * clients, depuis un fichier Excel ou CSV.
 *   1. modèle téléchargeable (colonnes, exemple, consignes) ;
 *   2. aperçu : chaque ligne est classée « création », « mise à jour » ou
 *      « erreur », avec le motif par cellule ;
 *   3. validation : tout ou rien, dans une transaction, refusée s'il reste une
 *      erreur. Une cellule vide ne remplace jamais une valeur existante.
 * Les colonnes absentes de la base (migrations non passées) sont ignorées.
 */

type ColType = 'text' | 'email' | 'phone' | 'ice' | 'enum' | 'number' | 'integer' | 'boolean';
interface Column {
  header: string;
  field: string;
  type: ColType;
  required?: boolean;
  max?: number;
  options?: string[];
  example: string;
  help?: string;
}
interface EntityDef {
  key: 'suppliers' | 'customers';
  label: string;
  table: string;
  columns: Column[];
  /** Clé de rapprochement avec une fiche existante, par ordre de priorité. */
  matchOn: string[];
}

export const IMPORT_ENTITIES: EntityDef[] = [
  {
    key: 'suppliers', label: 'Fournisseurs', table: 'suppliers', matchOn: ['ice', 'name'],
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
    key: 'customers', label: 'Clients', table: 'customers', matchOn: ['email', 'phone'],
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
      { header: 'Notes', field: 'notes', type: 'text', max: 1000, example: '' },
    ],
  },
];

export const entityByKey = (k: string) => IMPORT_ENTITIES.find(e => e.key === k);

/** Colonnes de l'entité réellement présentes dans la base. */
async function availableColumns(def: EntityDef): Promise<Column[]> {
  const r = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [def.table]);
  const cols = new Set(r.rows.map((x: { column_name: string }) => x.column_name));
  return def.columns.filter(c => cols.has(c.field));
}

/** Modèle Excel : feuille de saisie (en-têtes + exemple) et feuille de consignes. */
export async function buildTemplate(def: EntityDef): Promise<Buffer> {
  const cols = await availableColumns(def);
  const wb = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([cols.map(c => c.header), cols.map(c => c.example)]);
  data['!cols'] = cols.map(c => ({ wch: Math.max(14, c.header.length + 2) }));
  XLSX.utils.book_append_sheet(wb, data, def.label);
  const help = XLSX.utils.aoa_to_sheet([
    ['Colonne', 'Obligatoire', 'Format'],
    ...cols.map(c => [c.header, c.required ? 'Oui' : 'Non',
      c.options ? `Une de : ${c.options.join(', ')}` : c.help ?? (c.type === 'email' ? 'Adresse e-mail' : c.type === 'integer' ? 'Nombre entier' : c.type === 'number' ? 'Nombre' : 'Texte')]),
    [],
    ['La ligne 2 est un exemple : remplacez-la. Une cellule vide ne modifie pas une fiche existante.'],
    [`Fiche existante retrouvée par : ${def.matchOn.map(f => cols.find(c => c.field === f)?.header ?? f).join(', puis ')}.`],
  ]);
  help['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, help, 'Consignes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export interface PreviewRow {
  line: number;
  action: 'create' | 'update' | 'error' | 'skip';
  values: Record<string, unknown>;
  matchedId: string | null;
  errors: { column: string; message: string }[];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function convert(c: Column, raw: unknown): { value?: unknown; error?: string } {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!s) return c.required ? { error: 'obligatoire' } : {};
  switch (c.type) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s.toLowerCase() } : { error: 'e-mail invalide' };
    case 'phone': {
      const p = s.replace(/[^\d+]/g, '');
      return p.length >= 9 && p.length <= 15 ? { value: s } : { error: 'téléphone invalide' };
    }
    case 'ice': { const d = s.replace(/\s/g, ''); return /^\d{15}$/.test(d) ? { value: d } : { error: 'ICE : 15 chiffres' }; }
    case 'enum': {
      const v = s.toLowerCase().replace(/[\s-]+/g, '_');
      return c.options!.includes(v) ? { value: v } : { error: `valeur attendue : ${c.options!.join(', ')}` };
    }
    case 'integer': case 'number': {
      const n = Number(s.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return { error: 'nombre positif attendu' };
      if (c.type === 'integer' && !Number.isInteger(n)) return { error: 'nombre entier attendu' };
      return { value: n };
    }
    case 'boolean': return { value: ['oui', 'o', 'yes', '1', 'true', 'vrai'].includes(s.toLowerCase()) };
    default: return c.max && s.length > c.max ? { error: `${c.max} caractères maximum` } : { value: s };
  }
}

/** Lecture du fichier et classement de chaque ligne, sans rien écrire. */
export async function previewImport(def: EntityDef, buffer: Buffer): Promise<{ rows: PreviewRow[]; unknownHeaders: string[]; columns: string[] }> {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = wb.Sheets[wb.SheetNames.find(n => n !== 'Consignes') ?? wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
  if (!matrix.length) return { rows: [], unknownHeaders: [], columns: [] };
  const cols = await availableColumns(def);
  const headers = (matrix[0] as unknown[]).map(h => String(h ?? '').trim());
  const colIndex = new Map<Column, number>();
  const unknownHeaders: string[] = [];
  headers.forEach((h, i) => {
    if (!h) return;
    const c = cols.find(x => norm(x.header) === norm(h) || norm(x.field) === norm(h));
    if (c) colIndex.set(c, i); else unknownHeaders.push(h);
  });

  // Fiches existantes pour le rapprochement.
  const matchCols = def.matchOn.filter(f => cols.some(c => c.field === f));
  const existing = (await db.query(`SELECT id, ${matchCols.join(', ')} FROM ${def.table}`)).rows as Record<string, string | null>[];
  const keyOf = (f: string, v: unknown) => (f === 'phone' ? String(v ?? '').replace(/\D/g, '').slice(-9) : f === 'name' ? norm(String(v ?? '')) : String(v ?? '').toLowerCase());
  const index = new Map<string, Map<string, string>>(matchCols.map(f => [f, new Map(existing.filter(r => r[f]).map(r => [keyOf(f, r[f]), r.id as string]))]));
  const seen = new Map<string, number>();

  const rows: PreviewRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i] as unknown[];
    const values: Record<string, unknown> = {};
    const errors: PreviewRow['errors'] = [];
    for (const c of cols) {
      const idx = colIndex.get(c);
      const r = convert(c, idx === undefined ? '' : raw[idx]);
      if (r.error) errors.push({ column: c.header, message: r.error });
      else if (r.value !== undefined) values[c.field] = r.value;
    }
    if (Object.keys(values).length === 0 && errors.every(e => e.message === 'obligatoire')) {
      rows.push({ line: i + 1, action: 'skip', values, matchedId: null, errors: [] });
      continue;
    }
    if (def.key === 'customers' && !values.first_name && !values.last_name && !values.company_name) {
      errors.push({ column: 'Nom', message: 'nom, prénom ou société requis' });
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
    rows.push({ line: i + 1, action: errors.length ? 'error' : matchedId ? 'update' : 'create', values, matchedId, errors });
  }
  return { rows, unknownHeaders, columns: cols.map(c => c.header) };
}

/** Écriture tout ou rien ; refusée s'il reste une erreur. */
export async function commitImport(def: EntityDef, buffer: Buffer, actorId?: string) {
  const { rows } = await previewImport(def, buffer);
  const errors = rows.filter(r => r.action === 'error');
  if (errors.length) return { ok: false as const, errors: errors.length };
  const client = await db.getClient();
  let created = 0, updated = 0;
  try {
    await client.query('BEGIN');
    await setAuditUser(client, actorId);
    for (const r of rows) {
      const entries = Object.entries(r.values);
      if (r.action === 'create') {
        const extra: [string, unknown][] = def.key === 'suppliers' ? [] : [['customer_type', r.values.customer_type ?? 'particulier']];
        const all = [...entries, ...extra.filter(([k]) => !(k in r.values))];
        await client.query(
          `INSERT INTO ${def.table} (${all.map(e => e[0]).join(', ')}) VALUES (${all.map((_, i) => `$${i + 1}`).join(', ')})`,
          all.map(e => e[1]));
        created++;
      } else if (r.action === 'update' && entries.length) {
        await client.query(
          `UPDATE ${def.table} SET ${entries.map((e, i) => `${e[0]} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [r.matchedId, ...entries.map(e => e[1])]);
        updated++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { ok: true as const, created, updated };
}
