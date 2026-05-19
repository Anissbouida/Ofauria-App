/**
 * Import des depenses Avril + Mai 2026 depuis DEPENSES_OFAURIA_AVRIL_MAI_2026_2.xlsx
 *
 * Le fichier source contient 3 sections :
 *   1. Caisse Avril 2026          (rows ~6-298)   → payments type=expense, method=cash
 *   2. Caisse Mai 2026            (rows ~300-469) → payments type=expense, method=cash
 *   3. Factures Fournisseurs detaillees (Ecomab/Ovotec) (rows ~494-584)
 *      → invoices (type=received) + invoice_items
 *      Note : rows ~472-491 sont des resumes 1-ligne des memes factures, IGNORE pour eviter doublon.
 *
 * Idempotence :
 *   - Caisse : index unique (import_source, import_source_row) → re-run = skip
 *   - Factures : skip si invoice_number+supplier existe deja
 *
 * Usage :
 *   npx tsx server/src/scripts/import-depenses-avril-mai-2026.ts --file=<path.xlsx>           # dry-run
 *   npx tsx server/src/scripts/import-depenses-avril-mai-2026.ts --file=<path.xlsx> --commit  # persiste
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

// ─── CLI ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fileArg = args.find(a => a.startsWith('--file='))?.slice(7);
const COMMIT = args.includes('--commit');
if (!fileArg) { console.error('Usage: --file=<path.xlsx> [--commit]'); process.exit(1); }

const DEFAULT_STORE_ID = '00000000-0000-0000-0000-000000000001';
const IMPORT_SOURCE_CAISSE = 'DEPENSES_AVRIL_MAI_2026_CAISSE';

// Categories level 3 (id, lookup-keyword regex)
const CATEGORY_IDS = {
  // Personnel
  salaireBase: '30000000-0000-0000-0000-000000000020',
  avancesSalaire: '30000000-0000-0000-0000-000000000023',
  primes: '30000000-0000-0000-0000-000000000022',
  // Repas
  repasEquipe: '30000000-0000-0000-0000-000000000076',
  // Energie / Transport
  gazMenager: '30000000-0000-0000-0000-000000000048',
  coursiers: '30000000-0000-0000-0000-000000000066',
  // Ingredients
  farine: '30000000-0000-0000-0000-000000000012',
  beurre: '30000000-0000-0000-0000-000000000013',
  sucre: '30000000-0000-0000-0000-000000000014',
  oeufs: '30000000-0000-0000-0000-000000000015',
  autresIngredients: '30000000-0000-0000-0000-000000000016',
  laitProduitsLaitiers: 'a0c1343f-fe7a-4fc1-a72e-49e80ecc8a49',
  cremes: '30000000-0000-0000-0000-000000000036',
  chocolatCacao: '30000000-0000-0000-0000-000000000037',
  matieresGrassesHuiles: '30000000-0000-0000-0000-000000000038',
  levures: '30000000-0000-0000-0000-000000000039',
  epicesAromes: '30000000-0000-0000-0000-000000000040',
  viandesVolailles: '30000000-0000-0000-0000-000000000041',
  poissonsFruitsMer: '30000000-0000-0000-0000-000000000042',
  legumes: '30000000-0000-0000-0000-000000000043',
  fruitsPurees: '30000000-0000-0000-0000-000000000044',
  fruitsSecs: '30000000-0000-0000-0000-000000000045',
  // Emballages
  boites: '30000000-0000-0000-0000-000000000017',
  sacs: '30000000-0000-0000-0000-000000000018',
  etiquettes: '30000000-0000-0000-0000-000000000019',
  papierBoulanger: '30000000-0000-0000-0000-000000000082',
  // Frais administratifs / generaux
  fournituresBureau: '30000000-0000-0000-0000-000000000009',
  impression: '30000000-0000-0000-0000-000000000010',
  reseauTelecom: '30000000-0000-0000-0000-000000000011',
  // Entretien
  produitsEntretien: '30000000-0000-0000-0000-000000000053',
  // Equipements
  materielProduction: '30000000-0000-0000-0000-000000000050',
  ustensilesPatisserie: '30000000-0000-0000-0000-000000000067',
  outillageDivers: '30000000-0000-0000-0000-000000000068',
  // Divers
  remboursementEmprunt: '30000000-0000-0000-0000-000000000078',
  cadeauxRelations: '30000000-0000-0000-0000-000000000080',
  imprevus: '30000000-0000-0000-0000-000000000081',
  // Categorie parent factures fournisseurs (level 2, conserve la coherence avec import-invoices-excel)
  ingredients: '20000000-0000-0000-0000-000000000004',
};

// Suppliers connus dans la DB (canonical name → recherche case-insensitive)
const SUPPLIER_ALIASES: Record<string, string> = {
  'sonepal': 'SONEPAL',
  'sonepale': 'SONEPALE',
  'sofadex': 'SOFADEX PURATOS',
  'sofadex puratos': 'SOFADEX PURATOS',
  'ecomab': 'Ecomab',
  'ovotec': 'Ovotec',
  'ricamaroc': 'Rica Maroc',
  'rica maroc': 'Rica Maroc',
};

// ─── Couleurs console ────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};

// ─── Types ───────────────────────────────────────────────────────────────
interface CaisseRow {
  rowIndex: number;        // ligne Excel (pour import_source_row)
  month: string;           // 'Avril 2026' ou 'Mai 2026'
  date: Date;
  fournisseur: string;     // texte libre Excel
  designation: string;     // peut etre vide
  amount: number;
}

interface FactureLine {
  rowIndex: number;
  month: string;
  date: Date;
  supplier: string;        // 'Ecomab' ou 'Ovotec'
  invoiceNumber: string;
  designation: string;
  amount: number;
}

// ─── Helpers Excel ───────────────────────────────────────────────────────
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
    const d = new Date(v); return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

// ─── Parsing du classeur ─────────────────────────────────────────────────
// Le fichier a UNE SEULE feuille DETAIL avec 5 colonnes. La structure est :
//   - Header "━━━ AVRIL 2026 ━━━" puis lignes caisse Avril
//   - Header "━━━ MAI 2026 ━━━" puis lignes caisse Mai
//   - Header "━━━ FACTURES FOURNISSEURS (ECOMAB · OVOTEC) ━━━" puis lignes 1-ligne (IGNORE)
//   - Header "━━━ FACTURES FOURNISSEURS (ECOMAB · OVOTEC) ━━━" (2eme fois) puis lignes detaillees
//
// On differencie les 2 sections factures par presence de la sous-section "Facture N° XXX" :
// dans la section detaillee, chaque facture a un header "    Facture N° XXX  ·  DD/MM/YYYY".
function parseWorkbook(filePath: string): { caisse: CaisseRow[]; factures: FactureLine[] } {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['DETAIL'];
  if (!ws) throw new Error('Feuille DETAIL manquante');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

  const caisse: CaisseRow[] = [];
  const factures: FactureLine[] = [];

  let mode: 'caisse' | 'facture_summary' | 'facture_detail' = 'caisse';
  let currentInvoice: { number: string; supplier: string; date: Date } | null = null;
  let facturesSeenCount = 0; // pour differencier la 1ere/2eme section factures

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rowIndex = i + 1;

    const col0 = r[0] ? String(r[0]).trim() : '';
    const col1 = r[1] ? String(r[1]).trim() : '';
    const col2 = r[2] ? String(r[2]).trim() : '';
    const col3 = r[3] ? String(r[3]).trim() : '';
    const col4 = parseNum(r[4]);

    // Headers de section
    if (col0.includes('FACTURES FOURNISSEURS') || col0.includes('FACTURES')) {
      facturesSeenCount++;
      // 1ere fois → summary, 2eme/3eme → detail
      mode = facturesSeenCount === 1 ? 'facture_summary' : 'facture_detail';
      currentInvoice = null;
      continue;
    }
    if (col0.includes('AVRIL') || col0.includes('MAI')) {
      // "━━━ AVRIL 2026 ━━━" ou "━━━ MAI 2026 ━━━" ou "MAI 2026 — FACTURES"
      if (col0.includes('━━━')) {
        if (col0.includes('FACTURES')) {
          mode = 'facture_detail';
          facturesSeenCount = Math.max(facturesSeenCount, 2);
        } else {
          mode = 'caisse';
        }
        currentInvoice = null;
        continue;
      }
    }
    // Header date "  01/04/2026" en col0 sans autre data → ignore
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(col0) && !col1) continue;

    // Header sous-section "  ECOMAB" / "  OVOTEC" sans data
    if ((col0 === 'ECOMAB' || col0 === 'OVOTEC') && !col1 && !col4) continue;

    // Header facture "    Facture N° XXX  ·  DD/MM/YYYY" : mémoriser
    const facMatch = col0.match(/Facture\s+N°?\s*(\S+)\s*[·.]\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (facMatch && mode === 'facture_detail') {
      const num = facMatch[1].trim();
      const dt = parseDate(facMatch[2]);
      if (dt) {
        // Le supplier reste celui de la sous-section precedente. On le derive du dernier item
        // ou on l'identifie au moment du push (col2 contient 'Ecomab' ou 'Ovotec').
        currentInvoice = { number: num, supplier: '', date: dt };
      }
      continue;
    }

    // Ligne de donnees : col0 = 'Avril 2026' | 'Mai 2026' ; col1 = date ; col2 = fournisseur ; col3 = designation ; col4 = montant
    if ((col0 === 'Avril 2026' || col0 === 'Mai 2026') && col4 !== null) {
      const date = parseDate(col1);
      if (!date) continue;

      if (mode === 'caisse') {
        caisse.push({
          rowIndex,
          month: col0,
          date,
          fournisseur: col2,
          designation: col3,
          amount: col4,
        });
      } else if (mode === 'facture_detail') {
        // Doit etre Ecomab ou Ovotec
        if (col2 !== 'Ecomab' && col2 !== 'Ovotec') continue;
        // Si on a un currentInvoice, hydrate son supplier
        if (currentInvoice && !currentInvoice.supplier) currentInvoice.supplier = col2;
        factures.push({
          rowIndex,
          month: col0,
          date,
          supplier: col2,
          invoiceNumber: currentInvoice?.number ?? `UNKNOWN-${rowIndex}`,
          designation: col3,
          amount: col4,
        });
      }
      // mode === 'facture_summary' : on ignore (deja en detail)
    }
  }

  return { caisse, factures };
}

// ─── Categorisation caisse ───────────────────────────────────────────────
// Determine la categorie level-3 a partir de la designation + fournisseur.
// Premiere regle qui match s'applique.
const CATEGORY_RULES: Array<{ test: RegExp; categoryId: string; label: string }> = [
  // Salaires : avant "avance" parce que "salaire +" ou "salaire (avance)" doit etre salaire
  { test: /\bsalaire\b/i, categoryId: CATEGORY_IDS.salaireBase, label: 'Salaire' },
  { test: /\b(avance|le reste du salaire|repos\b)/i, categoryId: CATEGORY_IDS.avancesSalaire, label: 'Avance/Reste salaire' },

  // Repas du personnel
  { test: /repas\s+(du\s+)?personnel|repas\s+(d[uy]\s+)?equipe/i, categoryId: CATEGORY_IDS.repasEquipe, label: 'Repas personnel' },

  // Comptable / banque / commande
  { test: /\bla\s+banque\b/i, categoryId: CATEGORY_IDS.remboursementEmprunt, label: 'Banque' },
  { test: /\bcomptable\b/i, categoryId: CATEGORY_IDS.fournituresBureau, label: 'Comptable' },

  // Transport
  { test: /\btaxi\b/i, categoryId: CATEGORY_IDS.coursiers, label: 'Taxi' },

  // Energie
  { test: /\b(bouta\s+gaz|recharge\s+gaz)\b/i, categoryId: CATEGORY_IDS.gazMenager, label: 'Gaz bouteille' },

  // Reparations / equipements
  { test: /reparation/i, categoryId: CATEGORY_IDS.materielProduction, label: 'Reparation' },
  { test: /\b(tondeur|mixeur|moul(e)?\s+(silicon|chahda)|plaque|po[êe]le|tab3\s+en\s+silicon)\b/i, categoryId: CATEGORY_IDS.ustensilesPatisserie, label: 'Ustensile' },
  { test: /\b(materiel\s+sable|polister)\b/i, categoryId: CATEGORY_IDS.ustensilesPatisserie, label: 'Materiel sable' },
  { test: /\binstecticide|insecticide\b/i, categoryId: CATEGORY_IDS.produitsEntretien, label: 'Insecticide' },

  // Entretien
  { test: /\b(javel|ajax|oni(\s+gel)?|sac\s+poubelle|chtaba|allo|savon|spray\s+desodorisant|lampe|balai|torchon|papier\s+torchon|sacher)\b/i, categoryId: CATEGORY_IDS.produitsEntretien, label: 'Entretien' },
  { test: /\bpapier\s+cuisine\b/i, categoryId: CATEGORY_IDS.papierBoulanger, label: 'Papier cuisine' },
  { test: /\b(les\s+)?gants?\b/i, categoryId: CATEGORY_IDS.produitsEntretien, label: 'Gants' },

  // Fournitures / impression
  { test: /\b(impression|imprimer|porte\s+prix|cahier|stylos?|chemise\s+plastique|enveloppes?|envlopes?|copier\s+fishier|copier\s+fichier)\b/i, categoryId: CATEGORY_IDS.impression, label: 'Impression/papeterie' },
  { test: /\betiquette/i, categoryId: CATEGORY_IDS.etiquettes, label: 'Etiquettes' },
  { test: /\b(recharge\s+telephone)\b/i, categoryId: CATEGORY_IDS.reseauTelecom, label: 'Telecom' },

  // Emballages
  { test: /\b(barquettes?|caissettes?|l[ao]nguettes?|gala\s+(noir|blanc)|sous\s+g[âa]teau|image\s+(g[âa]teau|sucr[ée]e?|cake)|feuille\s+pastila|rouleau\s+pvc|porte\s+prix)\b/i, categoryId: CATEGORY_IDS.boites, label: 'Emballage/Materiel patisserie' },

  // Decoration / arome / agents speciaux
  { test: /\b(colourant|colorant|arom[eo]|nappage|sofadex|sufadex|tigral|p[âa]te\s+sucr|lake|decoration\s+sable|les\s+aromes|lmeska|smcp|sopalin)\b/i, categoryId: CATEGORY_IDS.epicesAromes, label: 'Arome/decoration' },
  { test: /\bepic|paprika|camun|cumin|cannelle|gingembre|nigella|laurier|herissa|hrissa|smen|feuille\s+de\s+laurier\b/i, categoryId: CATEGORY_IDS.epicesAromes, label: 'Epices' },
  { test: /\b(margafrique|ricamaroc)\b/i, categoryId: CATEGORY_IDS.epicesAromes, label: 'Decoration/nappage' },

  // Levures
  { test: /\b(levure|ibis|sonepal)\b/i, categoryId: CATEGORY_IDS.levures, label: 'Levure' },

  // Chocolat / cacao / caramel / biscuit
  { test: /\b(chocolat|cacao|drops|tablette|pistole|praline|fondant|fruits?\s+confit|orange\s+caramelis|pate\s+de\s+dattes|p[âa]t[ée]\s+de\s+dattes|amarena|lotus|oreo|nestl[eé]\s+caramel|caramel)\b/i, categoryId: CATEGORY_IDS.chocolatCacao, label: 'Chocolat/biscuit' },

  // Huiles
  { test: /\bhuile/i, categoryId: CATEGORY_IDS.matieresGrassesHuiles, label: 'Huile' },

  // Viandes / volailles (dinde fume[é]? sans \b final pour gerer "fumé")
  { test: /\b(viande|poulet|jambon|bouaza|abdaljamil|jebli|kheliae)\b|dinde\s+fum|blanc\s+(de\s+)?poulet/i, categoryId: CATEGORY_IDS.viandesVolailles, label: 'Viande/volaille' },

  // Poissons
  { test: /\b(thon|poisson)\b/i, categoryId: CATEGORY_IDS.poissonsFruitsMer, label: 'Poisson' },

  // Lait / produits laitiers / fromages
  { test: /\b(lait|yaourt|fromage|crème|creme|cheese|chedar|cheddar|mozzarell|la\s+vache|lben|smen)\b/i, categoryId: CATEGORY_IDS.laitProduitsLaitiers, label: 'Lait/produits laitiers' },
  // (smen est plus "matiere grasse" mais classe ici comme produit laitier marocain)

  // Beurre
  { test: /\bbeurre\b/i, categoryId: CATEGORY_IDS.beurre, label: 'Beurre' },

  // Oeufs
  { test: /\b(oeufs?|œufs?|plateau\s+oeufs|plateaux\s+oeufs)\b/i, categoryId: CATEGORY_IDS.oeufs, label: 'Oeufs' },

  // Sucre / mielleux
  { test: /\b(sucre|miel|melasse|sirop|glucose|fondant|neige|sucre\s+glace)\b/i, categoryId: CATEGORY_IDS.sucre, label: 'Sucre' },

  // Farine / semoule / mais / balboula / bghrir (galette marocaine a base de farine)
  { test: /\b(farine|semoule|balbo[ou]la|complet|farine\s+mais|brisure|bghrir|moony|kenz)\b/i, categoryId: CATEGORY_IDS.farine, label: 'Farine/semoule' },
  { test: /\bmais\b/i, categoryId: CATEGORY_IDS.farine, label: 'Mais' },

  // Fruits secs / oleagineux (sesam = typo de sesame, sans \b final)
  { test: /\b(amande|noisette|pistache|noix|sesame|s[eé]same|sesam\b|pavot|graines?\s+|konafa|grains?|raisins?\s+sec|cornichou)/i, categoryId: CATEGORY_IDS.fruitsSecs, label: 'Fruits secs' },
  { test: /\b(grain|grains)\b/i, categoryId: CATEGORY_IDS.fruitsSecs, label: 'Grains' },

  // Fruits frais / purees
  { test: /\b(fraise|framboise|mangue|pomme|banane|citron|raisin|p[êe]che|orange(\s+caramelis)?|bigarou\s+fruits|fruits?\b)\b/i, categoryId: CATEGORY_IDS.fruitsPurees, label: 'Fruits' },

  // Legumes (pluriels : tomates, carottes, courgettes, laitues, oignons, poivrons)
  { test: /\b(tomates?|carrotes?|carottes?|courgettes?|laitues?|oignons?|persil|poivrons?|choux?|gingembre|olives?|cornichons?|pomme\s+de\s+terre|pdt|olla|legumes?)\b/i, categoryId: CATEGORY_IDS.legumes, label: 'Legumes' },

  // The
  { test: /\b(th[eé])\b/i, categoryId: CATEGORY_IDS.epicesAromes, label: 'The' },

  // Gel/divers
  { test: /\b(oni\s+gel|gelatine|sel\s+pack|\bsel\b)\b/i, categoryId: CATEGORY_IDS.epicesAromes, label: 'Sel/gelatine' },

  // Mayonnaise/sauces
  { test: /\b(mayonnaise|sauce)\b/i, categoryId: CATEGORY_IDS.autresIngredients, label: 'Sauce/mayonnaise' },

  // Papier generique (sans suffixe "cuisine"/"torchon")
  { test: /\bpapier(s)?(\s+x\d+)?\b/i, categoryId: CATEGORY_IDS.papierBoulanger, label: 'Papier (autre)' },

  // Recuperation argent / caisse adjustement / commande / chofan : non categorisable → imprevus
  { test: /\b(recuperation\s+d.?argent|la\s+caisse(\s+-)?|chofan|commande)\b/i, categoryId: CATEGORY_IDS.imprevus, label: 'Imprevu/ajustement' },
];

function categorize(designation: string, fournisseur: string): { categoryId: string; label: string } {
  const text = `${designation} ${fournisseur}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(text)) return { categoryId: rule.categoryId, label: rule.label };
  }
  // Designation vide ou inconnue → imprevu (l'utilisateur recategorisera depuis l'UI)
  if (!designation.trim()) return { categoryId: CATEGORY_IDS.imprevus, label: 'Imprevu (sans designation)' };
  return { categoryId: CATEGORY_IDS.autresIngredients, label: 'Autres (a recategoriser)' };
}

// ─── Resolution supplier ─────────────────────────────────────────────────
async function resolveSupplierByAlias(client: PoolClient, name: string): Promise<string | null> {
  if (!name) return null;
  const alias = SUPPLIER_ALIASES[name.toLowerCase()];
  if (!alias) return null;
  const res = await client.query<{ id: string }>(
    `SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`, [alias]
  );
  return res.rows[0]?.id ?? null;
}

async function resolveSupplierExact(client: PoolClient, canonicalName: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`, [canonicalName]
  );
  if (res.rows[0]) return res.rows[0].id;
  const ins = await client.query<{ id: string }>(
    `INSERT INTO suppliers (name, is_active) VALUES ($1, true) RETURNING id`, [canonicalName]
  );
  return ins.rows[0].id;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${C.bold}${C.cyan}=== Import depenses Avril + Mai 2026 ===${C.reset}`);
  console.log(`Fichier : ${fileArg}`);
  console.log(`Mode    : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}\n`);

  const { caisse, factures } = parseWorkbook(fileArg!);

  // Stats parsing
  const caisseTotal = caisse.reduce((s, r) => s + r.amount, 0);
  const facturesTotal = factures.reduce((s, r) => s + r.amount, 0);
  const facturesByNumber = new Map<string, FactureLine[]>();
  for (const f of factures) {
    const arr = facturesByNumber.get(f.invoiceNumber) ?? [];
    arr.push(f);
    facturesByNumber.set(f.invoiceNumber, arr);
  }

  console.log(`${C.bold}── Parsing ──${C.reset}`);
  console.log(`  Caisse : ${caisse.length} lignes — Total ${caisseTotal.toFixed(2)} DH`);
  console.log(`         ${C.dim}Avril : ${caisse.filter(c => c.month === 'Avril 2026').reduce((s, c) => s + c.amount, 0).toFixed(2)} DH (${caisse.filter(c => c.month === 'Avril 2026').length} l)${C.reset}`);
  console.log(`         ${C.dim}Mai   : ${caisse.filter(c => c.month === 'Mai 2026').reduce((s, c) => s + c.amount, 0).toFixed(2)} DH (${caisse.filter(c => c.month === 'Mai 2026').length} l)${C.reset}`);
  console.log(`  Factures : ${facturesByNumber.size} factures, ${factures.length} lignes — Total ${facturesTotal.toFixed(2)} DH`);
  console.log(`  TOTAL : ${(caisseTotal + facturesTotal).toFixed(2)} DH (attendu 244297.84)\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  const stats = {
    caissePaymentsCreated: 0, caisseSkipped: 0,
    invoicesCreated: 0, invoiceItemsCreated: 0, invoicesSkipped: 0,
    suppliersMatched: 0, suppliersUnmatched: 0,
  };
  const categoryStats: Record<string, { count: number; amount: number }> = {};

  try {
    // ── 1. Import factures fournisseurs ──────────────────────────────
    console.log(`${C.bold}${C.cyan}── Factures fournisseurs ──${C.reset}`);
    for (const [invoiceNumber, lines] of facturesByNumber.entries()) {
      const first = lines[0]!;
      const supplierId = await resolveSupplierExact(client, first.supplier);

      // Idempotence
      const exist = await client.query(
        `SELECT id FROM invoices WHERE invoice_number = $1 AND supplier_id = $2`,
        [invoiceNumber, supplierId]
      );
      if (exist.rows.length > 0) {
        stats.invoicesSkipped++;
        console.log(`  ${C.yellow}SKIP${C.reset} ${first.supplier} ${invoiceNumber} (deja en base)`);
        continue;
      }

      const totalHT = lines.reduce((s, l) => s + l.amount, 0);
      // On considere les montants comme TTC (le fichier ne donne pas la TVA)
      // amount = HT estime = TTC / 1.2 ; tax = TTC - HT ; total_amount = TTC
      // En realite on ne sait pas, on met amount=total_amount, tax=0 pour rester neutre.
      const invRes = await client.query<{ id: string }>(
        `INSERT INTO invoices (invoice_number, supplier_id, category_id, invoice_date, amount, tax_amount, total_amount, paid_amount, status, store_id, invoice_type, notes)
         VALUES ($1, $2, $3, $4, $5, 0, $5, 0, 'pending', $6, 'received', $7)
         RETURNING id`,
        [invoiceNumber, supplierId, CATEGORY_IDS.ingredients, first.date, totalHT, DEFAULT_STORE_ID,
         `Import DEPENSES_AVRIL_MAI_2026 - ${first.supplier} facture ${invoiceNumber} (${lines.length} ligne(s))`]
      );
      const invoiceId = invRes.rows[0].id;
      stats.invoicesCreated++;

      for (const line of lines) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, subtotal)
           VALUES ($1, $2, 1, $3, $3)`,
          [invoiceId, line.designation, line.amount]
        );
        stats.invoiceItemsCreated++;
      }
      console.log(`  ${C.green}OK${C.reset}   ${first.supplier.padEnd(8)} ${invoiceNumber.padEnd(12)} ${first.date.toISOString().slice(0, 10)} ${totalHT.toFixed(2).padStart(10)} DH (${lines.length} items)`);
    }
    console.log();

    // ── 2. Import caisse expenses ────────────────────────────────────
    console.log(`${C.bold}${C.cyan}── Caisse (paiements expense cash) ──${C.reset}`);
    for (const row of caisse) {
      // Idempotence : (import_source, import_source_row) unique
      const exist = await client.query(
        `SELECT id FROM payments WHERE import_source = $1 AND import_source_row = $2`,
        [IMPORT_SOURCE_CAISSE, row.rowIndex]
      );
      if (exist.rows.length > 0) {
        stats.caisseSkipped++;
        continue;
      }

      const { categoryId, label } = categorize(row.designation, row.fournisseur);
      categoryStats[label] = categoryStats[label] || { count: 0, amount: 0 };
      categoryStats[label].count++;
      categoryStats[label].amount += row.amount;

      // Supplier : si le nom matche un alias connu (Sonepal, Ecomab, Ovotec...)
      const supplierId = await resolveSupplierByAlias(client, row.fournisseur);
      if (supplierId) stats.suppliersMatched++;
      else stats.suppliersUnmatched++;

      const description = [
        row.fournisseur ? `[${row.fournisseur}]` : null,
        row.designation || '(sans designation)',
      ].filter(Boolean).join(' ');

      await client.query(
        `INSERT INTO payments (type, category_id, supplier_id, amount, payment_method, payment_date, description, store_id, import_source, import_source_row)
         VALUES ('expense', $1, $2, $3, 'cash', $4, $5, $6, $7, $8)`,
        [categoryId, supplierId, row.amount, row.date, description, DEFAULT_STORE_ID, IMPORT_SOURCE_CAISSE, row.rowIndex]
      );
      stats.caissePaymentsCreated++;
    }

    // ── 3. Rapport ───────────────────────────────────────────────────
    console.log();
    console.log(`${C.bold}${C.cyan}── Statistiques ──${C.reset}`);
    console.log(`  Factures fournisseurs    : ${C.green}${stats.invoicesCreated}${C.reset} creees, ${C.yellow}${stats.invoicesSkipped}${C.reset} skip`);
    console.log(`  Lignes facture           : ${stats.invoiceItemsCreated}`);
    console.log(`  Paiements caisse         : ${C.green}${stats.caissePaymentsCreated}${C.reset} crees, ${C.yellow}${stats.caisseSkipped}${C.reset} skip`);
    console.log(`  Suppliers matched/unmatch: ${stats.suppliersMatched}/${stats.suppliersUnmatched}`);
    console.log();

    console.log(`${C.bold}${C.cyan}── Repartition par categorie (caisse) ──${C.reset}`);
    const sorted = Object.entries(categoryStats).sort((a, b) => b[1].amount - a[1].amount);
    for (const [label, st] of sorted) {
      console.log(`  ${label.padEnd(35)} ${String(st.count).padStart(4)} ligne(s)  ${st.amount.toFixed(2).padStart(12)} DH`);
    }
    const totalParCat = sorted.reduce((s, [, st]) => s + st.amount, 0);
    console.log(`  ${C.dim}${'─'.repeat(35)}${C.reset}`);
    console.log(`  ${'TOTAL'.padEnd(35)} ${' '.padStart(4)}            ${totalParCat.toFixed(2).padStart(12)} DH`);
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
