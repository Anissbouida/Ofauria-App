import ExcelJS from 'exceljs';

/**
 * G0-08 (reliquat V3 de l'audit de sécurité) — lecture et écriture des classeurs.
 *
 * Remplace la bibliothèque `xlsx` 0.18.5 (pollution de prototype et déni de
 * service par expression régulière à la LECTURE d'un fichier téléversé, sans
 * correctif publié sur npm) par `exceljs`. La forme des appels reste celle de
 * `xlsx` (read / utils.sheet_to_json / utils.aoa_to_sheet / write) pour que les
 * services d'import et d'export ne changent que de bibliothèque.
 *
 * Différences à connaître :
 *  - read() et write() sont ASYNCHRONES ;
 *  - seul le format .xlsx est lu : un ancien .xls (binaire) est refusé avec un
 *    message clair (l'enregistrer en .xlsx ou en CSV) ;
 *  - une cellule de date est rendue en objet Date dont les composantes LOCALES
 *    (getFullYear / getMonth / getDate) sont celles affichées dans Excel, quel
 *    que soit le fuseau du serveur.
 */

export interface WorkSheet {
  /** Valeurs de la plage utilisée, ligne par ligne ; cellule vide = null. */
  rows: unknown[][];
  /** Largeurs de colonnes à l'écriture (même convention que xlsx : wch = caractères). */
  '!cols'?: { wch: number }[];
}
export interface WorkBook {
  SheetNames: string[];
  Sheets: Record<string, WorkSheet>;
}

export const XLS_UNSUPPORTED = 'Ancien format Excel (.xls) non pris en charge : enregistrez le fichier en .xlsx ou en CSV.';

const isOle = (b: Buffer) => b.length > 3 && b[0] === 0xd0 && b[1] === 0xcf;
const isZip = (b: Buffer) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;

/** Date UTC d'exceljs → Date aux mêmes composantes en heure locale. */
function localDate(d: Date): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

/** Inverse, à l'écriture : la date locale est écrite telle qu'elle se lit (pas décalée du fuseau). */
function utcDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
}

/** Valeur simple d'une cellule exceljs (formule → résultat, texte enrichi → texte). */
function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : localDate(v);
  if (typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('result' in o) return plain(o.result);                                   // formule
  if ('formula' in o || 'sharedFormula' in o) return null;                     // formule sans résultat
  if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map(t => t.text ?? '').join('');
  if ('text' in o) return plain(o.text);                                       // lien
  if ('error' in o) return null;
  return String(v);
}

const blank = (v: unknown) => v === null || v === undefined || v === '';

/** Lit un classeur .xlsx. Refuse un .xls ; un fichier qui n'est pas un classeur lève une erreur. */
export async function read(buffer: Buffer): Promise<WorkBook> {
  // statusCode 400 : erreur de l'utilisateur (mauvais fichier), pas du serveur.
  if (isOle(buffer)) throw Object.assign(new Error(XLS_UNSUPPORTED), { statusCode: 400 });
  if (!isZip(buffer)) throw Object.assign(new Error('Fichier illisible : un classeur .xlsx est attendu.'), { statusCode: 400 });
  const book = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await book.xlsx.load(buffer as any);
  const out: WorkBook = { SheetNames: [], Sheets: {} };
  for (const ws of book.worksheets) {
    const rows: unknown[][] = [];
    const dim = ws.actualRowCount > 0 ? ws.dimensions : null;
    if (dim && dim.bottom >= dim.top && dim.right >= dim.left) {
      for (let r = dim.top; r <= dim.bottom; r++) {
        const row = ws.getRow(r);
        const line: unknown[] = [];
        for (let c = dim.left; c <= dim.right; c++) line.push(plain(row.getCell(c).value));
        rows.push(line);
      }
    }
    out.SheetNames.push(ws.name);
    out.Sheets[ws.name] = { rows };
  }
  return out;
}

/** Classeur d'une seule feuille à partir de lignes déjà découpées (CSV). */
export function fromRows(rows: unknown[][], name = 'Feuille1'): WorkBook {
  return { SheetNames: [name], Sheets: { [name]: { rows } } };
}

const two = (n: number) => String(n).padStart(2, '0');
/** Texte d'aperçu d'une valeur (date en JJ/MM/AAAA). */
export function displayText(v: unknown): string {
  if (blank(v)) return '';
  if (v instanceof Date) return `${two(v.getDate())}/${two(v.getMonth() + 1)}/${v.getFullYear()}`;
  return String(v);
}

export const utils = {
  book_new(): WorkBook {
    return { SheetNames: [], Sheets: {} };
  },
  aoa_to_sheet(rows: unknown[][]): WorkSheet {
    return { rows };
  },
  /** Une ligne d'en-têtes (clés dans l'ordre de première apparition), puis une ligne par objet. */
  json_to_sheet(data: Record<string, unknown>[]): WorkSheet {
    const headers: string[] = [];
    for (const r of data) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
    return { rows: [headers, ...data.map(r => headers.map(h => r[h] ?? null))] };
  },
  book_append_sheet(wb: WorkBook, ws: WorkSheet, name: string): void {
    wb.SheetNames.push(name);
    wb.Sheets[name] = ws;
  },
  /**
   * Lignes d'une feuille (toujours en tableaux, comme xlsx avec header: 1).
   *  - defval    : valeur d'une cellule vide (défaut : undefined) ;
   *  - blankrows : false retire les lignes entièrement vides (défaut : conservées) ;
   *  - raw       : false rend le texte d'aperçu au lieu de la valeur.
   */
  sheet_to_json<T = unknown[]>(ws: WorkSheet | undefined, opts: { header?: 1; defval?: unknown; blankrows?: boolean; raw?: boolean } = {}): T[] {
    const src = ws?.rows ?? [];
    const kept = opts.blankrows === false ? src.filter(r => r.some(c => !blank(c))) : src;
    return kept.map(r => r.map(c => {
      if (opts.raw === false) return displayText(c);
      return blank(c) && c !== '' ? opts.defval : c;
    })) as T[];
  },
};

/** Écrit un classeur .xlsx. */
export async function write(wb: WorkBook): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const name of wb.SheetNames) {
    const src = wb.Sheets[name];
    const ws = book.addWorksheet(name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
    for (const row of src.rows) ws.addRow(row.map(c => (c === undefined ? null : c instanceof Date ? utcDate(c) : c)));
    (src['!cols'] ?? []).forEach((c, i) => { ws.getColumn(i + 1).width = c.wch; });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export const SSF = {
  /** Numéro de série Excel (calendrier 1900) → année, mois, jour. */
  parse_date_code(serial: number): { y: number; m: number; d: number } | null {
    if (!Number.isFinite(serial) || serial < 1) return null;
    // 25569 = 1ᵉʳ janvier 1970 ; valable après le 1ᵉʳ mars 1900 (faux 29 février 1900 d'Excel).
    const dt = new Date(Math.round((Math.floor(serial) - 25569) * 86400000));
    if (Number.isNaN(dt.getTime())) return null;
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  },
};
