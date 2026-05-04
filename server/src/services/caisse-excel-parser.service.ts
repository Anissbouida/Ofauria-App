import * as XLSX from 'xlsx';

/**
 * Parser spécifique au format "CAISSE_MOIS_ANNEE_CONSOLIDE.xlsx" d'Ofauria.
 * Colonnes attendues : DATE | TYPE | N° | FOURNISSEUR | DÉSIGNATION | ENTRÉE (DH) | SORTIE (DH)
 * TYPE ∈ {'Opération', 'Total op.', 'Recette'}
 */

export type SupplierKind = 'real' | 'personnel';

export interface ParsedOperation {
  sourceRow: number;           // ligne dans le .xlsx (1-indexed, pour idempotence)
  date: string;                // YYYY-MM-DD
  type: 'expense' | 'income';
  amount: number;
  rawSupplier: string;         // nom tel qu'écrit dans l'Excel
  supplierKind: SupplierKind;  // 'real' = vraie enseigne, 'personnel' = personne
  supplierKey: string;         // nom normalisé (uppercase trim) — clé de dédup
  designation: string;         // désignation originale
}

export interface ParsedRecette {
  sourceRow: number;
  date: string;
  amount: number;
  paymentMethod: 'cash' | 'card';
}

export interface ParsedCaisse {
  meta: {
    year: number;
    month: number;
    importSource: string; // ex: caisse_excel_2026_03
  };
  operations: ParsedOperation[];
  recettes: ParsedRecette[];
  warnings: string[];
}

// Whitelist substring (insensible casse) pour détecter un "vrai" fournisseur.
// Tout ce qui ne matche pas est considéré comme une "personne" (avance caisse).
const REAL_SUPPLIER_PATTERNS = [
  /SONEPAL/i,
  /SOFADEX/i,
  /PURATOS/i,
];

function toNumber(v: unknown): { n: number | null; warn?: string } {
  if (v === null || v === undefined || v === '') return { n: null };
  if (typeof v === 'number') return { n: v };
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(s);
  if (isNaN(parsed)) return { n: null, warn: `valeur non numérique: "${v}"` };
  return { n: parsed };
}

function toDateYmd(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  // Excel numeric date (days since 1900)
  if (typeof v === 'number') {
    // XLSX stores dates as serial numbers — use SSF to parse
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  // Format attendu : DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // ISO YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function classifySupplier(raw: string): { kind: SupplierKind; key: string } {
  const key = raw.trim().toUpperCase();
  const kind: SupplierKind = REAL_SUPPLIER_PATTERNS.some((r) => r.test(key)) ? 'real' : 'personnel';
  return { kind, key };
}

export function parseCaisseWorkbook(buffer: Buffer): ParsedCaisse {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('Fichier Excel vide (aucune feuille)');
  const ws = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });

  const operations: ParsedOperation[] = [];
  const recettes: ParsedRecette[] = [];
  const warnings: string[] = [];

  let detectedYear: number | null = null;
  let detectedMonth: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const [dateCell, typeCell, numCell, fournCell, desigCell, entreeCell, sortieCell] = row;
    const sourceRow = i + 1; // Excel lines are 1-indexed

    const type = typeCell ? String(typeCell).trim() : '';
    if (!type) continue; // ligne vide ou en-tête JOURNÉE
    if (type === 'Total op.') continue; // agrégat

    const date = toDateYmd(dateCell);
    if (!date) continue; // en-tête "JOURNÉE DU ..."

    if (!detectedYear) {
      const [y, m] = date.split('-').map(Number);
      detectedYear = y ?? null;
      detectedMonth = m ?? null;
    }

    const entree = toNumber(entreeCell);
    const sortie = toNumber(sortieCell);
    if (entree.warn) warnings.push(`Ligne ${sourceRow}: colonne ENTRÉE — ${entree.warn}`);
    if (sortie.warn) warnings.push(`Ligne ${sourceRow}: colonne SORTIE — ${sortie.warn}`);

    if (type === 'Recette') {
      const num = numCell ? String(numCell).trim().toUpperCase() : '';
      if (num === 'TOTAL RECETTES JOUR') continue; // agrégat
      const amount = entree.n ?? 0;
      if (amount <= 0) continue; // pas de recette positive
      if (num === 'RECETTE CASH') {
        recettes.push({ sourceRow, date, amount, paymentMethod: 'cash' });
      } else if (num === 'RECETTE CARTE BANCAIRE') {
        recettes.push({ sourceRow, date, amount, paymentMethod: 'card' });
      } else {
        warnings.push(`Ligne ${sourceRow}: recette de type inconnu "${num}" ignorée`);
      }
      continue;
    }

    if (type === 'Opération') {
      const rawSupplier = fournCell ? String(fournCell).trim() : '';
      const designation = desigCell ? String(desigCell).trim() : '';
      const sortieAmount = sortie.n ?? 0;
      const entreeAmount = entree.n ?? 0;

      if (sortieAmount > 0) {
        if (!rawSupplier) {
          warnings.push(`Ligne ${sourceRow}: opération sans fournisseur — regroupée sous "INCONNU"`);
        }
        const { kind, key } = classifySupplier(rawSupplier || 'INCONNU');
        operations.push({
          sourceRow,
          date,
          type: 'expense',
          amount: sortieAmount,
          rawSupplier: rawSupplier || 'INCONNU',
          supplierKind: kind,
          supplierKey: key,
          designation,
        });
      }
      if (entreeAmount > 0) {
        const { kind, key } = classifySupplier(rawSupplier || 'INCONNU');
        operations.push({
          sourceRow,
          date,
          type: 'income',
          amount: entreeAmount,
          rawSupplier: rawSupplier || 'INCONNU',
          supplierKind: kind,
          supplierKey: key,
          designation,
        });
      }
    }
  }

  if (!detectedYear || !detectedMonth) {
    throw new Error('Impossible de détecter le mois/année (aucune date valide trouvée)');
  }

  const importSource = `caisse_excel_${detectedYear}_${String(detectedMonth).padStart(2, '0')}`;

  return {
    meta: { year: detectedYear, month: detectedMonth, importSource },
    operations,
    recettes,
    warnings,
  };
}
