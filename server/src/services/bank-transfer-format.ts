/**
 * Format du fichier de virement fournisseurs, par compte bancaire (G4-01, mig 600) — fonctions PURES.
 *
 * Aucun format n'est imposé par les banques marocaines : chaque portail (virement de masse)
 * importe un fichier tabulaire ou à positions fixes qu'on décrit ici une fois pour toutes,
 * dans treasury_accounts.transfer_format. Sans format saisi, le fichier est le CSV générique
 * Kalum, identique à celui des salaires (buildTransferCsv).
 *
 * Analogie Oracle : le « Payment Format » d'Oracle Payments (modèle de fichier par banque).
 */
import { bankName, type TransferLine } from './salary-transfer.js';

export const TRANSFER_COLUMNS = {
  seq: 'N° d\'ordre',
  name: 'Bénéficiaire',
  rib: 'RIB du bénéficiaire',
  bank: 'Banque du bénéficiaire',
  amount: 'Montant',
  motif: 'Motif',
  date: 'Date d\'exécution',
  debit_rib: 'RIB du compte débité',
  currency: 'Devise',
  reference: 'Référence de la campagne',
} as const;
export type TransferColumn = keyof typeof TRANSFER_COLUMNS;

export interface TransferFormat {
  separator: ';' | ',' | 'tab' | '|' | 'fixed';
  decimal: '.' | ',';
  amountInCents: boolean;
  header: boolean;
  dateFormat: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'YYYYMMDD' | 'DDMMYYYY';
  columns: TransferColumn[];
  /** Largeur de chaque colonne, obligatoire en positions fixes. */
  widths?: Partial<Record<TransferColumn, number>>;
  /** Noms et motif en majuscules sans accents (exigé par la plupart des portails). */
  uppercase: boolean;
  lineEnding: 'crlf' | 'lf';
  extension: 'csv' | 'txt';
}

/** Format générique Kalum : le même fichier que le virement des salaires. */
export const GENERIC_TRANSFER_FORMAT: TransferFormat = {
  separator: ';', decimal: '.', amountInCents: false, header: true, dateFormat: 'DD/MM/YYYY',
  columns: ['seq', 'name', 'rib', 'bank', 'amount', 'motif'], uppercase: true, lineEnding: 'crlf', extension: 'csv',
};

/** En-têtes du format générique (reprises de buildTransferCsv pour un fichier identique). */
const GENERIC_HEAD: Partial<Record<TransferColumn, string>> = { seq: 'N°', name: 'Bénéficiaire', rib: 'RIB', bank: 'Banque', amount: 'Montant', motif: 'Motif' };

export interface TransferContext { motif: string; paymentDate: string; debitRib: string | null; currency: string; reference: string }

/** Contrôle et complète un format saisi ; renvoie la liste des problèmes s'il est inutilisable. */
export function normalizeTransferFormat(input: unknown): { format: TransferFormat | null; errors: string[] } {
  const errors: string[] = [];
  const f = (input ?? {}) as Partial<TransferFormat>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);
  const columns = Array.isArray(f.columns) ? f.columns.filter((c): c is TransferColumn => c in TRANSFER_COLUMNS) : [];
  if (!columns.length) errors.push('Choisissez au moins une colonne');
  if (new Set(columns).size !== columns.length) errors.push('Une colonne apparaît deux fois');
  if (!columns.includes('rib')) errors.push('Le RIB du bénéficiaire est obligatoire');
  if (!columns.includes('amount')) errors.push('Le montant est obligatoire');
  const separator = pick(f.separator, [';', ',', 'tab', '|', 'fixed'] as const, ';');
  const decimal = pick(f.decimal, ['.', ','] as const, '.');
  if (separator === ',' && decimal === ',' && !f.amountInCents) errors.push('Séparateur et virgule décimale identiques : choisissez le point décimal ou le montant en centimes');
  const widths: Partial<Record<TransferColumn, number>> = {};
  if (separator === 'fixed') {
    for (const c of columns) {
      const w = Number(f.widths?.[c]);
      if (!Number.isInteger(w) || w < 1 || w > 200) errors.push(`Largeur manquante ou invalide pour « ${TRANSFER_COLUMNS[c]} » (1 à 200)`);
      else widths[c] = w;
    }
    if (columns.includes('rib') && widths.rib != null && widths.rib < 24) errors.push('La colonne RIB doit faire au moins 24 caractères');
  }
  if (errors.length) return { format: null, errors };
  return {
    errors,
    format: {
      separator, decimal, amountInCents: !!f.amountInCents, header: separator === 'fixed' ? false : f.header !== false,
      dateFormat: pick(f.dateFormat, ['DD/MM/YYYY', 'YYYY-MM-DD', 'YYYYMMDD', 'DDMMYYYY'] as const, 'DD/MM/YYYY'),
      columns, ...(separator === 'fixed' ? { widths } : {}), uppercase: f.uppercase !== false,
      lineEnding: pick(f.lineEnding, ['crlf', 'lf'] as const, 'crlf'), extension: pick(f.extension, ['csv', 'txt'] as const, separator === 'fixed' ? 'txt' : 'csv'),
    },
  };
}

const fmtDate = (iso: string, f: TransferFormat['dateFormat']) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return f === 'YYYY-MM-DD' ? `${y}-${m}-${d}` : f === 'YYYYMMDD' ? `${y}${m}${d}` : f === 'DDMMYYYY' ? `${d}${m}${y}` : `${d}/${m}/${y}`;
};
const fmtAmount = (n: number, f: TransferFormat) =>
  (f.amountInCents ? String(Math.round(n * 100)) : n.toFixed(2).replace('.', f.decimal));
const NUMERIC: TransferColumn[] = ['seq', 'amount'];

/** Fichier de virement (une ligne par bénéficiaire) au format de la banque. */
export function buildBankTransferFile(lines: TransferLine[], ctx: TransferContext, format: TransferFormat | null): { content: string; extension: 'csv' | 'txt' } {
  const f = format ?? GENERIC_TRANSFER_FORMAT;
  const generic = format == null;
  const text = (v: string) => (f.uppercase ? bankName(v) : v);
  const value = (c: TransferColumn, l: TransferLine, i: number): string => {
    switch (c) {
      case 'seq': return String(i + 1);
      case 'name': return text(l.name);
      case 'rib': return l.rib ?? '';
      case 'bank': return l.bankName ?? '';
      case 'amount': return fmtAmount(l.amount, f);
      case 'motif': return generic ? ctx.motif : text(ctx.motif);
      case 'date': return fmtDate(ctx.paymentDate, f.dateFormat);
      case 'debit_rib': return ctx.debitRib ?? '';
      case 'currency': return ctx.currency;
      case 'reference': return ctx.reference;
    }
  };
  const eol = f.lineEnding === 'crlf' ? '\r\n' : '\n';
  let rows: string[];
  if (f.separator === 'fixed') {
    // Positions fixes : texte cadré à gauche complété d'espaces, nombres cadrés à droite complétés
    // de zéros ; une valeur trop longue est tronquée (un montant trop long est une erreur).
    rows = lines.map((l, i) => f.columns.map(c => {
      const w = f.widths![c]!;
      const v = value(c, l, i);
      if (NUMERIC.includes(c)) {
        if (v.length > w) throw Object.assign(new Error(`Le montant ${v} dépasse la largeur de sa colonne (${w})`), { statusCode: 409 });
        return v.padStart(w, '0');
      }
      return v.slice(0, w).padEnd(w, ' ');
    }).join(''));
  } else {
    const sep = f.separator === 'tab' ? '\t' : f.separator;
    const cell = (v: string) => (v.includes(sep) || /["\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = f.columns.map(c => (generic ? GENERIC_HEAD[c] ?? TRANSFER_COLUMNS[c] : TRANSFER_COLUMNS[c]));
    rows = lines.map((l, i) => f.columns.map(c => cell(value(c, l, i))).join(sep));
    if (f.header) rows.unshift(head.map(cell).join(sep));
  }
  return { content: rows.join(eol) + eol, extension: f.extension };
}
