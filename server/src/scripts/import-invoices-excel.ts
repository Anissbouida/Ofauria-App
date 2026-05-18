/**
 * Import des factures fournisseurs depuis un classeur Excel.
 *
 * Usage:
 *   npx tsx server/src/scripts/import-invoices-excel.ts --file=/path/file.xlsx          # dry-run
 *   npx tsx server/src/scripts/import-invoices-excel.ts --file=/path/file.xlsx --commit # ecrit en base
 *
 * Pour chaque ligne de la feuille "Entrees Economat" :
 *   - Article ingredient : invoice + PO retroactif + reception_voucher + ingredient_lot
 *   - Article emballage  : invoice + PO retroactif + packaging_stock_transaction
 *
 * Idempotence : si invoice_number existe deja pour le supplier, toute la facture est skip.
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

// ─── CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fileArg = args.find(a => a.startsWith('--file='))?.slice(7);
const COMMIT = args.includes('--commit');
if (!fileArg) {
  console.error('Usage: --file=<path.xlsx> [--commit]');
  process.exit(1);
}

// ─── Constantes ──────────────────────────────────────────────────────────
const DEFAULT_STORE_ID = '00000000-0000-0000-0000-000000000001';
const SHEET_NAME = 'Entrées Économat';
const RECAP_SHEET = 'Récap Factures';

// ─── Types ───────────────────────────────────────────────────────────────
interface ExcelLine {
  date: Date;
  supplierName: string;     // OVOTEC / ECOMAB
  invoiceNumber: string;
  ref: string;              // OELP02, CC01009...
  designation: string;
  lotNumber: string | null;
  conditioning: string;
  qtyUnits: number;
  qtyKg: number | null;     // null pour les emballages (—)
  unitPrice: number;
  pricePerKg: number | null;
  amountHT: number;
  tvaPct: number;
}

interface ExcelInvoice {
  supplierName: string;
  invoiceNumber: string;
  date: Date;
  blRef: string;
  summary: string;
  totalHT: number;
  tva: number;
  totalTTC: number;
  payment: string;
}

type ItemKind = 'ingredient' | 'packaging';

interface ResolvedItem {
  kind: ItemKind;
  id: string;           // ingredient.id ou packaging_item.id
  matchedName: string;  // nom en base
  isNew: boolean;       // true si on l'a cree pendant l'import
  matchScore?: number;
}

// ─── Regles DLC par mot-cle ──────────────────────────────────────────────
// Premiere regle qui match s'applique. Si aucune, fallback a 365j.
const DLC_RULES: Array<{ regex: RegExp; days: number; label: string }> = [
  { regex: /cr[eè]me\s+fra[iî]che/i, days: 30, label: 'creme fraiche' },
  { regex: /cr[eè]me\s+cuisson/i, days: 90, label: 'creme cuisson UHT' },
  { regex: /mozzarell/i, days: 30, label: 'mozzarella' },
  { regex: /(jaune|blanc)s?\s+d.?oeufs?/i, days: 60, label: 'oeufs liquide pasteurise' },
  { regex: /oeufs?\s+entier/i, days: 60, label: 'oeufs entier liquide' },
  { regex: /amande/i, days: 270, label: 'amandes' },
  { regex: /(pavot|s[eé]same|m[eé]lange\s+de\s+graines|graines)/i, days: 270, label: 'graines/fruits secs' },
  { regex: /(praline|p[aâ]te\s+amande)/i, days: 365, label: 'pralines/pate amande' },
  { regex: /(chocolat|gouttes\s+drops|tablette\s+signature|pistoles|beurre\s+de\s+cacao)/i, days: 365, label: 'chocolat' },
  { regex: /cacao\s+en\s+poudre/i, days: 540, label: 'cacao poudre' },
  { regex: /(g[eé]latine|ar[oô]me|vanille|fondant|neige|sucre\s+glace|sirop\s+de\s+glucose|pr[eé]p\.?\s+poudre)/i, days: 540, label: 'additifs/sucres/poudres' },
  { regex: /(pur[eé]e\s+(framboise|mangue|fruit)|compote|amarena|nappage)/i, days: 365, label: 'fruits/nappage' },
  { regex: /brisure/i, days: 365, label: 'brisure biscuit' },
];

function dlcDaysFor(designation: string): { days: number; label: string } {
  for (const rule of DLC_RULES) if (rule.regex.test(designation)) return rule;
  return { days: 365, label: 'defaut (12 mois)' };
}

// ─── Categorie ingredient depuis le nom ──────────────────────────────────
function categoryFor(designation: string): string {
  const d = designation.toLowerCase();
  if (/oeuf|crème|cr[eé]me|mozza|lait|beurre/.test(d)) return 'produits_laitiers';
  if (/amande|noisette|pistache|sesame|s[eé]same|pavot|graine/.test(d)) return 'fruits_secs';
  if (/chocolat|cacao|tablette|drops|pistole|praline|pralin[eé]|fondant|nappage/.test(d)) return 'chocolat';
  if (/farine|brisure|biscuit|royaltine/.test(d)) return 'farines';
  if (/vanille|ar[oô]me|epice|cannelle|cumin|curcuma/.test(d)) return 'epices';
  if (/sucre|glucose|n[eé]ige|g[eé]latine|prep|poudre/.test(d)) return 'sucres';
  if (/framboise|mangue|fruit|pomme|amarena/.test(d)) return 'fruits';
  return 'autre';
}

// ─── Mapping packaging : codes CP* du Excel ──────────────────────────────
// Reconnait les emballages soit par code, soit par mot-cle dans la designation.
const PACKAGING_PATTERNS: Array<{ test: RegExp; nameHint: RegExp }> = [
  { test: /^CP0[134]/, nameHint: /(film\s+alimentaire|papier\s+cuisson|feuille\s+(guitare|rhodo[iï]de)|poche\s+p[aâ]tissi)/i },
];

function isPackagingRow(ref: string, designation: string): boolean {
  return PACKAGING_PATTERNS.some(p => p.test.test(ref) || p.nameHint.test(designation));
}

// ─── Normalisation pour matching fuzzy ───────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Quantites/conditionnements : 2kg, 500g, 1l, 250ml, 100u, 5pcs, 100 pieces, 100 unites, 500 feuilles
    .replace(/\(?\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|u|pcs?|pieces?|unites?|feuilles?|microns?)\)?/gi, '')
    .replace(/\bdgf\b|\bmab\b|\bvhp\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(['de', 'du', 'la', 'le', 'en', 'et', 'a', 'au', 'aux', 'd', 'l']);

// Stemming FR ultra-simple : retire juste le 's' ou 'x' final pour matcher pluriels
// ("liquides" ~ "liquide", "effilées" ~ "effilée"). Plus prudent que de toucher aux 'e'.
function stem(tok: string): string {
  if (tok.length <= 3) return tok;
  if (tok.endsWith('s') || tok.endsWith('x')) return tok.slice(0, -1);
  return tok;
}

function tokens(s: string): Set<string> {
  return new Set(
    normalize(s).split(' ')
      .filter(t => t.length >= 2 && !STOPWORDS.has(t))
      .map(stem)
  );
}

// Mots qui changent radicalement la nature du produit : si un cote l'a et pas l'autre, on bloque le match.
const DISCRIMINANTS = ['blanc', 'jaune', 'noir', 'lait', 'rouge', 'vert', 'bleu', 'fraise', 'framboise', 'mangue', 'pomme', 'citron', 'orange', 'cafe', 'vanille', 'pistache', 'noisette', 'amande', 'pavot', 'sesame'];

function hasDiscriminantConflict(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  for (const d of DISCRIMINANTS) {
    const inA = new RegExp(`\\b${d}s?\\b`).test(na);
    const inB = new RegExp(`\\b${d}s?\\b`).test(nb);
    if (inA !== inB) return true;
  }
  return false;
}

// Conflit numerique : si un cote a un nombre 2-3 chiffres (% type 33, 55, 70)
// et l'autre pas ou un different, ce sont des produits distincts.
function hasNumericConflict(a: string, b: string): boolean {
  const setA = new Set((normalize(a).match(/\b\d{2,3}\b/g) || []));
  const setB = new Set((normalize(b).match(/\b\d{2,3}\b/g) || []));
  if (setA.size === 0 && setB.size === 0) return false;
  for (const n of setA) if (setB.has(n)) return false;
  return true;
}

function similarity(a: string, b: string): number {
  if (hasDiscriminantConflict(a, b) || hasNumericConflict(a, b)) return 0;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  // Subset : si le plus petit cote est entierement inclus dans l'autre, c'est un match fort.
  // Pre-requis : le petit cote doit avoir >= 2 tokens, sinon trop trivial (ex: "Lait" subset de
  // "Tablette signature lait" ne doit PAS matcher).
  const small = ta.size <= tb.size ? ta : tb;
  const big = ta.size <= tb.size ? tb : ta;
  if (small.size >= 2) {
    let allIn = true;
    for (const t of small) if (!big.has(t)) { allIn = false; break; }
    if (allIn) return 0.95 - 0.02 * (big.size - small.size); // tie-breaker : favorise les noms les plus proches en taille
  }

  // Fallback : jaccard classique
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const jaccard = similarity;

// ─── Couleurs console ────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};

// ─── Parse Excel ─────────────────────────────────────────────────────────
function parseDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Numero serie Excel
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
    return new Date(v);
  }
  throw new Error(`Date invalide: ${String(v)}`);
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || v === '—' || v === '-') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseLines(filePath: string): { lines: ExcelLine[]; invoices: ExcelInvoice[] } {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

  // ── Entrees Economat ──
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Feuille manquante: ${SHEET_NAME}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

  // Ligne 0 = titre, ligne 1 = header
  const lines: ExcelLine[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const firstCell = String(r[0]);
    if (firstCell.startsWith('TOTAL')) continue;

    try {
      lines.push({
        date: parseDate(r[0]),
        supplierName: String(r[1]).trim(),
        invoiceNumber: String(r[2]).trim(),
        ref: String(r[3]).trim(),
        designation: String(r[4]).trim(),
        lotNumber: r[5] && String(r[5]).trim() !== '—' ? String(r[5]).trim() : null,
        conditioning: String(r[6] || '').trim(),
        qtyUnits: parseNum(r[7]) ?? 0,
        qtyKg: parseNum(r[8]),
        unitPrice: parseNum(r[9]) ?? 0,
        pricePerKg: parseNum(r[10]),
        amountHT: parseNum(r[11]) ?? 0,
        tvaPct: parseNum(r[12]) ?? 20,
      });
    } catch (e) {
      console.warn(`${C.yellow}⚠ Ligne ${i + 1} ignoree:${C.reset}`, (e as Error).message);
    }
  }

  // ── Recap Factures ──
  const wsR = wb.Sheets[RECAP_SHEET];
  const invoices: ExcelInvoice[] = [];
  if (wsR) {
    const rowsR = XLSX.utils.sheet_to_json<unknown[]>(wsR, { header: 1 });
    for (let i = 3; i < rowsR.length; i++) {
      const r = rowsR[i];
      if (!r || !r[0]) continue;
      const firstCell = String(r[0]);
      if (firstCell.startsWith('TOTAL') || firstCell.startsWith('Sous-totaux') || firstCell === 'ECOMAB' && !r[1]) continue;
      if (firstCell === 'OVOTEC' && !r[1]) continue;
      try {
        invoices.push({
          supplierName: String(r[0]).trim(),
          invoiceNumber: String(r[1]).trim(),
          date: parseDate(r[2]),
          blRef: String(r[3] || '').trim(),
          summary: String(r[4] || '').trim(),
          totalHT: parseNum(r[5]) ?? 0,
          tva: parseNum(r[6]) ?? 0,
          totalTTC: parseNum(r[7]) ?? 0,
          payment: String(r[8] || '').trim(),
        });
      } catch { /* skip */ }
    }
  }

  return { lines, invoices };
}

// ─── Resolveurs DB ───────────────────────────────────────────────────────
async function resolveSupplier(client: PoolClient, name: string): Promise<string> {
  // OVOTEC -> Ovotec, ECOMAB -> Ecomab (deja en base)
  const res = await client.query<{ id: string }>(
    `SELECT id FROM suppliers WHERE UPPER(name) = UPPER($1) LIMIT 1`,
    [name]
  );
  if (res.rows[0]) return res.rows[0].id;
  // Fallback : creer
  const ins = await client.query<{ id: string }>(
    `INSERT INTO suppliers (name, is_active) VALUES ($1, true) RETURNING id`,
    [name.charAt(0) + name.slice(1).toLowerCase()]
  );
  return ins.rows[0].id;
}

async function getCategoryId(client: PoolClient, name: string): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM expense_categories WHERE name = $1 LIMIT 1`,
    [name]
  );
  return res.rows[0]?.id ?? null;
}

// ─── Matching ingredient/packaging ──────────────────────────────────────
interface DbIngredient { id: string; name: string; supplier: string | null; unit: string; supplier_reference: string | null; }
interface DbPackaging { id: string; name: string; }

async function resolveItem(
  client: PoolClient,
  line: ExcelLine,
  cacheIng: DbIngredient[],
  cachePkg: DbPackaging[]
): Promise<ResolvedItem> {
  // 1. Packaging ?
  if (isPackagingRow(line.ref, line.designation)) {
    // match exact ou fuzzy sur packaging_items
    let best: { item: DbPackaging; score: number } | null = null;
    for (const p of cachePkg) {
      const s = jaccard(p.name, line.designation);
      if (s > (best?.score ?? 0)) best = { item: p, score: s };
    }
    if (best && best.score >= 0.5) {
      return { kind: 'packaging', id: best.item.id, matchedName: best.item.name, isNew: false, matchScore: best.score };
    }
    // creer packaging si introuvable
    const cat = /film|papier|feuille|rhodo/i.test(line.designation) ? 'films' : 'sachets';
    const ins = await client.query<{ id: string }>(
      `INSERT INTO packaging_items (name, unit, unit_cost, supplier, category) VALUES ($1, 'piece', $2, $3, $4) RETURNING id`,
      [line.designation, line.unitPrice, line.supplierName, cat]
    );
    cachePkg.push({ id: ins.rows[0].id, name: line.designation });
    return { kind: 'packaging', id: ins.rows[0].id, matchedName: line.designation, isNew: true };
  }

  // 2. Ingredient : 1) deja importe par ref, 2) fuzzy sur nom
  // 2a. Exact match par supplier_reference
  const supplierName = line.supplierName.toLowerCase();
  const exact = cacheIng.find(i =>
    i.supplier_reference === line.ref &&
    (i.supplier?.toLowerCase().includes(supplierName) ?? false)
  );
  if (exact) {
    return { kind: 'ingredient', id: exact.id, matchedName: exact.name, isNew: false, matchScore: 1 };
  }

  // 2b. Fuzzy par nom
  let best: { item: DbIngredient; score: number } | null = null;
  for (const ing of cacheIng) {
    const s = jaccard(ing.name, line.designation);
    if (s > (best?.score ?? 0)) best = { item: ing, score: s };
  }
  if (best && best.score >= 0.6) {
    return { kind: 'ingredient', id: best.item.id, matchedName: best.item.name, isNew: false, matchScore: best.score };
  }

  // 2c. Creer ingredient
  // Unite : si pas de qtyKg c'est forcement 'unit', sinon 'kg'
  const unit = line.qtyKg === null ? 'unit' : 'kg';
  // Cleaning du nom : on retire le conditionnement type "2KG" en fin
  const cleanName = line.designation.replace(/\s+\d+(?:[.,]\d+)?\s*(K?G|L|ML|PCS?|U)\b\s*$/i, '').trim();
  const category = categoryFor(line.designation);
  const containerSize = line.qtyKg !== null && line.qtyUnits > 0 ? line.qtyKg / line.qtyUnits : null;
  const supplierId = await resolveSupplier(client, line.supplierName);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO ingredients (name, unit, unit_cost, supplier, category, container_size, supplier_reference, supplier_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [cleanName, unit, line.pricePerKg ?? line.unitPrice, line.supplierName, category, containerSize, line.ref, supplierId]
  );
  cacheIng.push({
    id: ins.rows[0].id,
    name: cleanName,
    supplier: line.supplierName,
    unit,
    supplier_reference: line.ref,
  });
  return { kind: 'ingredient', id: ins.rows[0].id, matchedName: cleanName, isNew: true };
}

// ─── Generation numero de lot ────────────────────────────────────────────
function genLotNumber(invoiceNumber: string, ref: string, supplierLot: string | null): string {
  // Format max 50 chars (contrainte schema)
  const base = supplierLot
    ? `${invoiceNumber}-${ref}-${supplierLot}`
    : `IMP-${invoiceNumber}-${ref}`;
  return base.slice(0, 50);
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${C.bold}${C.cyan}=== Import factures Ofauria ===${C.reset}`);
  console.log(`Fichier : ${fileArg}`);
  console.log(`Mode    : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}`);
  console.log();

  const { lines, invoices: recapInvoices } = parseLines(fileArg!);
  console.log(`Excel : ${lines.length} lignes d'entrees, ${recapInvoices.length} factures dans recap\n`);

  // Group lignes par invoice_number
  const byInvoice = new Map<string, ExcelLine[]>();
  for (const l of lines) {
    const arr = byInvoice.get(l.invoiceNumber) ?? [];
    arr.push(l);
    byInvoice.set(l.invoiceNumber, arr);
  }
  console.log(`Factures distinctes (entrees) : ${byInvoice.size}\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  let stats = { invCreated: 0, invSkipped: 0, poCreated: 0, rvCreated: 0, lotCreated: 0, pkgTx: 0, ingMatched: 0, ingCreated: 0, pkgMatched: 0, pkgCreated: 0 };
  const skippedInvoices: string[] = [];
  const matchReport: Array<{ ref: string; designation: string; status: string; matchedName: string; score?: number }> = [];

  try {
    // Caches
    const ingRes = await client.query<DbIngredient>(`SELECT id, name, supplier, unit, supplier_reference FROM ingredients`);
    const pkgRes = await client.query<DbPackaging>(`SELECT id, name FROM packaging_items WHERE is_active = true`);
    const cacheIng = ingRes.rows;
    const cachePkg = pkgRes.rows;

    const categoryId = await getCategoryId(client, 'Matieres premieres');

    for (const [invoiceNumber, invLines] of byInvoice.entries()) {
      const first = invLines[0]!;
      const supplierId = await resolveSupplier(client, first.supplierName);

      // Idempotence : check si invoice deja en base
      const existing = await client.query(
        `SELECT id FROM invoices WHERE invoice_number = $1 AND supplier_id = $2`,
        [invoiceNumber, supplierId]
      );
      if (existing.rows.length > 0) {
        skippedInvoices.push(`${first.supplierName}/${invoiceNumber}`);
        stats.invSkipped++;
        continue;
      }

      // Trouver l'invoice dans le recap pour avoir HT/TVA/TTC exact
      const recap = recapInvoices.find(r => r.invoiceNumber === invoiceNumber);
      const totalHT = recap?.totalHT ?? invLines.reduce((s, l) => s + l.amountHT, 0);
      const tva = recap?.tva ?? invLines.reduce((s, l) => s + (l.amountHT * l.tvaPct / 100), 0);
      const totalTTC = recap?.totalTTC ?? totalHT + tva;

      // 1. PO retroactif
      const poNumber = `IMPORT-${invoiceNumber}`.slice(0, 50);
      const poRes = await client.query<{ id: string }>(
        `INSERT INTO purchase_orders (order_number, supplier_id, status, order_date, delivery_date, store_id, notes)
         VALUES ($1, $2, 'livre_complet', $3, $3, $4, $5)
         RETURNING id`,
        [poNumber, supplierId, first.date, DEFAULT_STORE_ID, `PO retroactif genere depuis import Excel`]
      );
      const poId = poRes.rows[0].id;
      stats.poCreated++;

      // 2. Invoice
      const invRes = await client.query<{ id: string }>(
        `INSERT INTO invoices (invoice_number, supplier_id, category_id, invoice_date, amount, tax_amount, total_amount, paid_amount, status, store_id, invoice_type, purchase_order_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'pending', $8, 'received', $9, $10)
         RETURNING id`,
        [invoiceNumber, supplierId, categoryId, first.date, totalHT, tva, totalTTC, DEFAULT_STORE_ID, poId, recap?.payment ? `Reglement : ${recap.payment}` : null]
      );
      const invoiceId = invRes.rows[0].id;
      stats.invCreated++;

      // 3. Pre-process : resolve all items et separer ingredient / packaging
      const resolved: Array<{ line: ExcelLine; resolved: ResolvedItem }> = [];
      for (const line of invLines) {
        const r = await resolveItem(client, line, cacheIng, cachePkg);
        resolved.push({ line, resolved: r });

        matchReport.push({
          ref: line.ref,
          designation: line.designation,
          status: r.isNew ? `CREE (${r.kind})` : `MATCH ${r.kind}`,
          matchedName: r.matchedName,
          score: r.matchScore,
        });

        if (r.kind === 'ingredient') {
          if (r.isNew) stats.ingCreated++; else stats.ingMatched++;
        } else {
          if (r.isNew) stats.pkgCreated++; else stats.pkgMatched++;
        }
      }

      // 4. Si au moins une ligne ingredient : creer reception_voucher
      const ingLines = resolved.filter(r => r.resolved.kind === 'ingredient');
      let rvId: string | null = null;
      if (ingLines.length > 0) {
        const rvNumber = `BR-${invoiceNumber}`.slice(0, 50);
        const rvRes = await client.query<{ id: string }>(
          `INSERT INTO reception_vouchers (voucher_number, purchase_order_id, reception_date, store_id, notes)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [rvNumber, poId, first.date, DEFAULT_STORE_ID, `Reception import facture ${invoiceNumber}`]
        );
        rvId = rvRes.rows[0].id;
        stats.rvCreated++;
        // Lier invoice -> reception_voucher
        await client.query(`UPDATE invoices SET reception_voucher_id = $1 WHERE id = $2`, [rvId, invoiceId]);
      }

      // 5. Pour chaque ligne : creer PO item + (reception+lot OU packaging tx)
      for (const { line, resolved: r } of resolved) {
        if (r.kind === 'ingredient') {
          const qtyReceived = line.qtyKg ?? line.qtyUnits;
          // 5a. PO item
          const poiRes = await client.query<{ id: string }>(
            `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, quantity_delivered, unit_price)
             VALUES ($1, $2, $3, $3, $4)
             RETURNING id`,
            [poId, r.id, qtyReceived, line.pricePerKg ?? line.unitPrice]
          );
          // 5b. Reception voucher item
          const dlc = dlcDaysFor(line.designation);
          const expirationDate = new Date(first.date);
          expirationDate.setDate(expirationDate.getDate() + dlc.days);
          const rviRes = await client.query<{ id: string }>(
            `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, quantity_received, unit_price, supplier_lot_number, expiration_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [rvId, poiRes.rows[0].id, r.id, qtyReceived, line.pricePerKg ?? line.unitPrice, line.lotNumber, expirationDate]
          );
          // 5c. Ingredient lot
          const lotNumber = genLotNumber(line.invoiceNumber, line.ref, line.lotNumber);
          await client.query(
            `INSERT INTO ingredient_lots (ingredient_id, reception_voucher_item_id, supplier_id, lot_number, supplier_lot_number,
               quantity_received, quantity_remaining, unit_cost, received_at, expiration_date, store_id, status, economat_quantity, pesage_quantity)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, 'active', $6, 0)`,
            [r.id, rviRes.rows[0].id, supplierId, lotNumber, line.lotNumber, qtyReceived, line.pricePerKg ?? line.unitPrice, first.date, expirationDate, DEFAULT_STORE_ID]
          );
          stats.lotCreated++;
        } else {
          // Packaging : PO item + tx + upsert packaging_store_stock
          const qty = line.qtyUnits;
          await client.query(
            `INSERT INTO purchase_order_items (purchase_order_id, packaging_id, quantity_ordered, quantity_delivered, unit_price)
             VALUES ($1, $2, $3, $3, $4)`,
            [poId, r.id, qty, line.unitPrice]
          );
          // Upsert stock + tx
          const stockRes = await client.query<{ stock_quantity: string }>(
            `INSERT INTO packaging_store_stock (packaging_id, store_id, stock_quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (packaging_id, store_id) DO UPDATE SET stock_quantity = packaging_store_stock.stock_quantity + EXCLUDED.stock_quantity, updated_at = NOW()
             RETURNING stock_quantity`,
            [r.id, DEFAULT_STORE_ID, qty]
          );
          const stockAfter = parseFloat(stockRes.rows[0].stock_quantity);
          await client.query(
            `INSERT INTO packaging_stock_transactions (packaging_id, store_id, type, quantity_change, stock_after, reference_id, reference_type, unit_cost, note)
             VALUES ($1, $2, 'reception', $3, $4, $5, 'invoice', $6, $7)`,
            [r.id, DEFAULT_STORE_ID, qty, stockAfter, invoiceId, line.unitPrice, `Reception facture ${invoiceNumber}`]
          );
          stats.pkgTx++;
        }
      }
    }

    // ─── Rapport ───────────────────────────────────────────────────
    console.log(`${C.bold}${C.cyan}── Rapport de matching ──${C.reset}`);
    console.log(`${C.dim}Ref       | Designation                                          | Status        | Matched name${C.reset}`);
    for (const m of matchReport) {
      const status = m.status.startsWith('CREE')
        ? `${C.yellow}${m.status.padEnd(13)}${C.reset}`
        : `${C.green}${m.status.padEnd(13)}${C.reset}`;
      const score = m.score ? ` ${C.dim}(${(m.score * 100).toFixed(0)}%)${C.reset}` : '';
      console.log(`${m.ref.padEnd(10)}| ${m.designation.slice(0, 52).padEnd(52)} | ${status} | ${m.matchedName}${score}`);
    }

    console.log();
    console.log(`${C.bold}${C.cyan}── Statistiques ──${C.reset}`);
    console.log(`  Factures creees       : ${C.green}${stats.invCreated}${C.reset}`);
    console.log(`  Factures skip (deja)  : ${C.yellow}${stats.invSkipped}${C.reset}${skippedInvoices.length ? ' [' + skippedInvoices.join(', ') + ']' : ''}`);
    console.log(`  PO retroactifs        : ${stats.poCreated}`);
    console.log(`  Bons de reception     : ${stats.rvCreated}`);
    console.log(`  Lots ingredients      : ${stats.lotCreated}`);
    console.log(`  Tx packaging          : ${stats.pkgTx}`);
    console.log(`  Ingredients matches   : ${C.green}${stats.ingMatched}${C.reset} / crees : ${C.yellow}${stats.ingCreated}${C.reset}`);
    console.log(`  Packaging matches     : ${C.green}${stats.pkgMatched}${C.reset} / crees : ${C.yellow}${stats.pkgCreated}${C.reset}`);
    console.log();

    if (COMMIT) {
      await client.query('COMMIT');
      console.log(`${C.bold}${C.green}✓ COMMIT effectue${C.reset}`);
    } else {
      await client.query('ROLLBACK');
      console.log(`${C.bold}${C.yellow}↩ ROLLBACK (dry-run). Relance avec --commit pour persister.${C.reset}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`${C.red}${C.bold}ERREUR : rollback complet${C.reset}`);
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
