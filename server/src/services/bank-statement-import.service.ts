/**
 * Lecture des relevés bancaires (mig 426) : un fichier de banque → des
 * opérations normalisées { date, date de valeur, libellé, référence, montant,
 * sens } + soldes et compte quand le format les porte.
 *
 * Formats :
 *   - CSV et Excel (.xlsx/.xls) : colonnes variables, décrites par un profil
 *     (séparateur, décimale, format de date, rang des colonnes) ;
 *   - OFX / QFX (SGML 1.x ou XML 2.x) : blocs <STMTTRN>, solde <LEDGERBAL> ;
 *   - MT940 (SWIFT) : :60F: solde d'ouverture, :61: opération, :86: libellé,
 *     :62F: solde de clôture ;
 *   - CFONB 120 (relevé de compte 120 caractères) : 01 ancien solde,
 *     04 mouvement, 05 complément de libellé, 07 nouveau solde.
 *
 * Convention de sens (comme bank_statement_lines) : 'in' = encaissement
 * (crédit sur le relevé), 'out' = décaissement (débit sur le relevé).
 */
import * as XLSX from 'xlsx';

export type BankFormat = 'csv' | 'xlsx' | 'ofx' | 'mt940' | 'cfonb';
export type DateFormat = 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'DD.MM.YYYY' | 'DD/MM/YY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';

export interface CsvProfile {
  delimiter?: string | null;          // null = détection automatique
  decimalSep: ',' | '.';
  dateFormat: DateFormat;
  skipRows: number;
  hasHeader: boolean;
  colDate: number;
  colValueDate?: number | null;
  colLabel: number;
  colLabel2?: number | null;
  colReference?: number | null;
  colDebit?: number | null;
  colCredit?: number | null;
  colAmount?: number | null;
  negativeIsOut?: boolean;
}

export interface ParsedLine {
  operationDate: string;
  valueDate: string | null;
  label: string;
  reference: string | null;
  amount: number;
  direction: 'in' | 'out';
}

export interface ParsedStatement {
  format: BankFormat;
  lines: ParsedLine[];
  openingBalance: number | null;
  closingBalance: number | null;
  statementDate: string | null;
  accountNumber: string | null;
  currency: string | null;
  warnings: string[];
  /** CSV/Excel : premières lignes brutes, pour choisir les colonnes. */
  rawRows?: string[][];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/* ─── Décodage et détection ─────────────────────────────────────────── */

/** UTF-8 si le fichier en est (BOM retiré), sinon Windows-1252 (exports Excel/banques). */
export function decodeText(buf: Buffer, encoding: 'auto' | 'utf-8' | 'windows-1252' = 'auto'): string {
  let text: string;
  if (encoding === 'windows-1252') text = new TextDecoder('windows-1252').decode(buf);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: encoding === 'auto' }).decode(buf);
    } catch {
      text = new TextDecoder('windows-1252').decode(buf);
    }
  }
  return text.replace(/^﻿/, '');
}

const isZip = (buf: Buffer) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;          // xlsx
const isOle = (buf: Buffer) => buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0;            // xls

export function detectFormat(buf: Buffer, fileName = ''): BankFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (isZip(buf) || isOle(buf) || ext === 'xlsx' || ext === 'xls') return 'xlsx';
  const head = decodeText(buf.subarray(0, 4096));
  if (/OFXHEADER|<OFX>/i.test(head) || ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (/^:20:/m.test(head) && /:61:|:60[FM]:/.test(decodeText(buf))) return 'mt940';
  const lines = cfonbRecords(decodeText(buf));
  // Code enregistrement + code banque numérique (un CSV « 01/06/2026;… » ne passe pas).
  if (lines.length && lines.every(l => l.length === 120 && /^(01|04|05|07)\d{5}/.test(l))) return 'cfonb';
  return 'csv';
}

/* ─── Outils : montants, dates ──────────────────────────────────────── */

/** « 1 234,56 », « -1.234,56 », « (12,00) », « 12,00- » → nombre. */
export function parseAmount(raw: unknown, decimalSep: ',' | '.' = ','): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? '').replace(/[\s  ]/g, '').replace(/(MAD|DH|DHS|EUR|€)$/i, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  s = decimalSep === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

const iso = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

/** Date texte selon le format du profil ; une date Excel (nombre ou Date) est acceptée telle quelle. */
export function parseDate(raw: unknown, format: DateFormat): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return iso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {          // numéro de série Excel
    const p = XLSX.SSF.parse_date_code(raw);
    return p ? iso(p.y, p.m, p.d) : null;
  }
  const parts = String(raw ?? '').match(/\d+/g);
  if (!parts || parts.length < 3) return null;
  const [a, b, c] = parts.map(Number);
  switch (format) {
    case 'YYYY-MM-DD': return iso(a, b, c);
    case 'MM/DD/YYYY': return iso(c, a, b);
    default: return iso(c, b, a);                                         // JJ MM AAAA / AA
  }
}

/* ─── CSV / Excel ───────────────────────────────────────────────────── */

/** Découpe CSV (guillemets, séparateur dans un champ, "" échappé). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

export function guessDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const counts = [';', ',', '\t', '|'].map(d => [d, sample.split(d).length] as const);
  return counts.sort((x, y) => y[1] - x[1])[0][0];
}

/**
 * Première feuille : valeurs brutes pour lire (dates = numéros de série Excel,
 * indépendants du fuseau horaire de la machine) et texte formaté pour l'aperçu.
 */
function rowsFromXlsx(buf: Buffer): { values: unknown[][]; display: string[][] } {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const keep = (r: unknown[]) => r.some(c => String(c ?? '').trim() !== '');
  return {
    values: (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][]).filter(keep),
    display: (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][]).filter(keep),
  };
}

function parseTabular(rows: unknown[][], format: 'csv' | 'xlsx', profile: CsvProfile | null, display?: string[][]): ParsedStatement {
  const rawRows = (display ?? rows).slice(0, 15).map(r => r.map(c => String(c ?? '')));
  const out: ParsedStatement = {
    format, lines: [], openingBalance: null, closingBalance: null, statementDate: null,
    accountNumber: null, currency: null, warnings: [], rawRows,
  };
  if (!profile) { out.warnings.push('Choisissez les colonnes du fichier (profil d\'import).'); return out; }
  const body = rows.slice(profile.skipRows + (profile.hasHeader ? 1 : 0));
  const cell = (r: unknown[], i: number | null | undefined) => (i == null || i < 0 ? '' : r[i]);
  let skipped = 0;
  body.forEach((r, idx) => {
    const date = parseDate(cell(r, profile.colDate), profile.dateFormat);
    let amount: number | null = null;
    let direction: 'in' | 'out' = 'in';
    if (profile.colAmount != null) {
      const v = parseAmount(cell(r, profile.colAmount), profile.decimalSep);
      if (v != null && v !== 0) {
        const negOut = profile.negativeIsOut !== false;
        direction = (v < 0) === negOut ? 'out' : 'in';
        amount = Math.abs(v);
      }
    } else {
      const d = parseAmount(cell(r, profile.colDebit), profile.decimalSep);
      const c = parseAmount(cell(r, profile.colCredit), profile.decimalSep);
      if (d) { amount = Math.abs(d); direction = 'out'; }
      else if (c) { amount = Math.abs(c); direction = 'in'; }
    }
    if (!date || !amount) {
      // Lignes de total, de solde ou d'en-tête répété : ignorées mais signalées.
      if (String(r.join('')).trim()) skipped++;
      if (!date && amount && out.warnings.length < 5) out.warnings.push(`Ligne ${profile.skipRows + (profile.hasHeader ? 1 : 0) + idx + 1} : date illisible, ignorée.`);
      return;
    }
    out.lines.push({
      operationDate: date,
      valueDate: parseDate(cell(r, profile.colValueDate), profile.dateFormat),
      label: clean([cell(r, profile.colLabel), cell(r, profile.colLabel2)].map(x => String(x ?? '')).filter(Boolean).join(' ')),
      reference: clean(String(cell(r, profile.colReference) ?? '')) || null,
      amount: round2(amount),
      direction,
    });
  });
  if (skipped) out.warnings.push(`${skipped} ligne(s) sans date ou sans montant ignorée(s) (totaux, soldes…).`);
  return out;
}

/* ─── OFX ───────────────────────────────────────────────────────────── */

const ofxTag = (block: string, tag: string) => {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
};
const ofxDate = (v: string | null) => (v && /^\d{8}/.test(v) ? iso(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8)) : null);

export function parseOfx(text: string): ParsedStatement {
  const out: ParsedStatement = { format: 'ofx', lines: [], openingBalance: null, closingBalance: null, statementDate: null, accountNumber: ofxTag(text, 'ACCTID'), currency: ofxTag(text, 'CURDEF'), warnings: [] };
  const blocks = text.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  for (const b of blocks) {
    const amt = parseAmount((ofxTag(b, 'TRNAMT') ?? '').replace(',', '.'), '.');
    const date = ofxDate(ofxTag(b, 'DTPOSTED'));
    if (!amt || !date) { out.warnings.push('Opération OFX sans date ou montant ignorée.'); continue; }
    const name = clean(ofxTag(b, 'NAME')), memo = clean(ofxTag(b, 'MEMO'));
    out.lines.push({
      operationDate: date,
      valueDate: ofxDate(ofxTag(b, 'DTAVAIL')),
      label: [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' — '),
      reference: ofxTag(b, 'CHECKNUM') || ofxTag(b, 'FITID'),
      amount: round2(Math.abs(amt)),
      direction: amt < 0 ? 'out' : 'in',
    });
  }
  const ledger = text.split(/<LEDGERBAL>/i)[1];
  if (ledger) {
    const bal = parseAmount((ofxTag(ledger, 'BALAMT') ?? '').replace(',', '.'), '.');
    out.closingBalance = bal;
    out.statementDate = ofxDate(ofxTag(ledger, 'DTASOF'));
  }
  out.statementDate ??= ofxDate(ofxTag(text, 'DTEND'));
  if (out.closingBalance != null) out.openingBalance = round2(out.closingBalance - netOf(out.lines));
  return out;
}

/* ─── MT940 ─────────────────────────────────────────────────────────── */

const yymmdd = (s: string) => iso(2000 + +s.slice(0, 2), +s.slice(2, 4), +s.slice(4, 6));
const swiftAmount = (s: string) => Number(s.replace(',', '.'));

export function parseMt940(text: string): ParsedStatement {
  const out: ParsedStatement = { format: 'mt940', lines: [], openingBalance: null, closingBalance: null, statementDate: null, accountNumber: null, currency: null, warnings: [] };
  // Champs « :TAG: valeur », valeur pouvant courir sur plusieurs lignes.
  const fields: { tag: string; value: string }[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = raw.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) fields.push({ tag: m[1], value: m[2] });
    else if (fields.length && raw.trim() && !/^-}?$/.test(raw.trim())) fields[fields.length - 1].value += `\n${raw}`;
  }
  let last: ParsedLine | null = null;
  let opened = false;
  for (const f of fields) {
    if (f.tag === '25') out.accountNumber ??= f.value.trim();
    else if (f.tag === '60F' || f.tag === '60M') {
      const m = f.value.match(/^([CD])(\d{6})([A-Z]{3})([\d,]+)/);
      if (m && !opened) { out.openingBalance = (m[1] === 'D' ? -1 : 1) * swiftAmount(m[4]); out.currency = m[3]; opened = true; }
    } else if (f.tag === '62F' || f.tag === '62M') {
      const m = f.value.match(/^([CD])(\d{6})([A-Z]{3})([\d,]+)/);
      if (m) { out.closingBalance = (m[1] === 'D' ? -1 : 1) * swiftAmount(m[4]); out.statementDate = yymmdd(m[2]); }
    } else if (f.tag === '61') {
      const [first, ...rest] = f.value.split('\n');
      const m = first.match(/^(\d{6})(\d{4})?(R?[CD])[A-Z]?([\d,]+)[NFS][A-Z0-9]{3}([^/]*)(?:\/\/(.*))?$/);
      if (!m) { out.warnings.push(`Ligne :61: illisible ignorée : ${first.slice(0, 40)}`); last = null; continue; }
      const valueDate = yymmdd(m[1]);
      // Date comptable MMJJ facultative, sans année : celle des années N−1, N, N+1
      // la plus proche de la date de valeur (passage décembre ↔ janvier).
      let bookDate = valueDate;
      if (m[2] && valueDate) {
        const y = +valueDate.slice(0, 4), v = Date.parse(valueDate);
        const best = [y - 1, y, y + 1]
          .map(yy => iso(yy, +m[2].slice(0, 2), +m[2].slice(2, 4)))
          .filter((d): d is string => !!d)
          .sort((a, b) => Math.abs(Date.parse(a) - v) - Math.abs(Date.parse(b) - v))[0];
        bookDate = best ?? valueDate;
      }
      const isIn = m[3] === 'C' || m[3] === 'RD';
      last = {
        operationDate: bookDate!, valueDate, label: clean(rest.join(' ')),
        reference: clean(m[5]) && clean(m[5]) !== 'NONREF' ? clean(m[5]) : (clean(m[6]) || null),
        amount: round2(swiftAmount(m[4])), direction: isIn ? 'in' : 'out',
      };
      out.lines.push(last);
    } else if (f.tag === '86' && last) {
      // Sous-zones « ?20 », « /REMI/ »… ramenées à des espaces.
      const info = clean(f.value.replace(/\?\d{2}/g, ' ').replace(/\n/g, ' '));
      last.label = clean([info, last.label].filter(Boolean).join(' — '));
    }
  }
  return out;
}

/* ─── CFONB 120 ─────────────────────────────────────────────────────── */

/** Enregistrements de 120 caractères (avec ou sans fins de ligne ; espaces de fin rognés rétablis). */
function cfonbRecords(text: string): string[] {
  const t = text.replace(/\r/g, '');
  const lines = t.includes('\n') ? t.split('\n') : (t.match(/.{1,120}/g) ?? []);
  return lines.filter(l => l.trim()).map(l => (l.length <= 120 ? l.padEnd(120) : l));
}
const SIGN: Record<string, [number, number]> = {
  '{': [0, 1], A: [1, 1], B: [2, 1], C: [3, 1], D: [4, 1], E: [5, 1], F: [6, 1], G: [7, 1], H: [8, 1], I: [9, 1],
  '}': [0, -1], J: [1, -1], K: [2, -1], L: [3, -1], M: [4, -1], N: [5, -1], O: [6, -1], P: [7, -1], Q: [8, -1], R: [9, -1],
};
/** Montant CFONB : 13 chiffres + caractère final portant le dernier chiffre et le signe. */
function cfonbAmount(field: string, decimals: number): number | null {
  const s = SIGN[field.slice(-1)];
  const digits = field.slice(0, -1);
  if (!s || !/^\d+$/.test(digits)) return null;
  return (s[1] * Number(digits + String(s[0]))) / 10 ** decimals;
}
const jjmmaa = (s: string) => iso(2000 + +s.slice(4, 6), +s.slice(2, 4), +s.slice(0, 2));

export function parseCfonb(text: string): ParsedStatement {
  const out: ParsedStatement = { format: 'cfonb', lines: [], openingBalance: null, closingBalance: null, statementDate: null, accountNumber: null, currency: null, warnings: [] };
  let last: ParsedLine | null = null;
  for (const r of cfonbRecords(text)) {
    const code = r.slice(0, 2);
    const decimals = Number(r.slice(19, 20)) || 2;
    out.accountNumber ??= r.slice(21, 32).trim() || null;
    out.currency ??= r.slice(16, 19).trim() || null;
    const amount = cfonbAmount(r.slice(90, 104), decimals);
    if (code === '01') {
      if (out.openingBalance == null) out.openingBalance = amount;
    } else if (code === '07') {
      out.closingBalance = amount;
      out.statementDate = jjmmaa(r.slice(34, 40));
    } else if (code === '04') {
      const date = jjmmaa(r.slice(34, 40));
      if (amount == null || !date || amount === 0) { out.warnings.push('Mouvement CFONB illisible ignoré.'); last = null; continue; }
      last = {
        operationDate: date, valueDate: jjmmaa(r.slice(42, 48)),
        label: clean(r.slice(48, 79)), reference: clean(r.slice(104, 120)) || clean(r.slice(81, 88)) || null,
        amount: round2(Math.abs(amount)), direction: amount < 0 ? 'out' : 'in',
      };
      out.lines.push(last);
    } else if (code === '05' && last) {
      last.label = clean(`${last.label} ${r.slice(48, 118)}`);
    }
  }
  return out;
}

/* ─── Point d'entrée ────────────────────────────────────────────────── */

export const netOf = (lines: ParsedLine[]) => round2(lines.reduce((s, l) => s + (l.direction === 'in' ? l.amount : -l.amount), 0));

export function parseStatement(buf: Buffer, opts: {
  fileName?: string; format?: BankFormat | 'auto'; encoding?: 'auto' | 'utf-8' | 'windows-1252'; profile?: CsvProfile | null;
}): ParsedStatement {
  const format = !opts.format || opts.format === 'auto' ? detectFormat(buf, opts.fileName) : opts.format;
  let out: ParsedStatement;
  if (format === 'xlsx') {
    const x = rowsFromXlsx(buf);
    out = parseTabular(x.values, 'xlsx', opts.profile ?? null, x.display);
  }
  else {
    const text = decodeText(buf, opts.encoding ?? 'auto');
    if (format === 'ofx') out = parseOfx(text);
    else if (format === 'mt940') out = parseMt940(text);
    else if (format === 'cfonb') out = parseCfonb(text);
    else out = parseTabular(splitCsv(text, opts.profile?.delimiter || guessDelimiter(text)), 'csv', opts.profile ?? null);
  }
  out.lines.sort((a, b) => a.operationDate.localeCompare(b.operationDate));
  out.statementDate ??= out.lines.length ? out.lines[out.lines.length - 1].operationDate : null;
  if (out.openingBalance != null && out.closingBalance != null) {
    const gap = round2(out.openingBalance + netOf(out.lines) - out.closingBalance);
    if (gap !== 0) out.warnings.push(`Soldes du fichier incohérents : ouverture + mouvements − clôture = ${gap.toFixed(2)}.`);
  }
  return out;
}
