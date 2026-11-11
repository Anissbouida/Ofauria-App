/**
 * Phase 10.1 — rendu arabe (droite-a-gauche) dans un PDF pdfkit.
 *
 * Helvetica est en WinAnsi : aucun caractere arabe, et pdfkit/fontkit ne
 * reordonne pas une ligne multi-mots de maniere fiable. Ce module isole le
 * strict necessaire pour qu'un document (facture, releve) sorte en arabe :
 *   - police Cairo embarquee (SIL OFL, couvre l'arabe ET le latin accentue) ;
 *   - detection de l'arabe (declenche la police + le trace RTL) ;
 *   - un mini-bidi par ligne, pose mot par mot et run par run de droite a
 *     gauche, avec miroir des paires ouvrantes/fermantes.
 *
 * La logique est reprise de `recipe-fiche-pdf.service.ts`, ou elle a ete
 * verifiee sur les fiches darija (Opera, masterclass) ; elle est copiee ici
 * plutot que partagee pour ne pas risquer de regresser ce rendu deja valide.
 * Limite connue (identique a l'original) : deux mots latins CONSECUTIFS dans
 * une ligne arabe sortiraient inverses entre eux ; les libelles de facture
 * n'en comportent pas.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';

const POLICE_AR = resolve(process.cwd(), 'assets', 'fonts', 'Cairo-Regular.ttf');
const POLICE_AR_ALT = resolve(process.cwd(), 'server', 'assets', 'fonts', 'Cairo-Regular.ttf');

/** Chemin de la police arabe embarquee, ou null si absente (fallback appelant). */
export function arabicFontPath(): string | null {
  if (existsSync(POLICE_AR)) return POLICE_AR;
  if (existsSync(POLICE_AR_ALT)) return POLICE_AR_ALT;
  return null;
}

const IS_RTL_CHAR = (c: string) =>
  /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(c);

/** true des qu'une chaine contient de l'arabe (ou de l'hebreu) : police dediee. */
export function containsArabic(s: string | null | undefined): boolean {
  return Boolean(s) && [...String(s)].some(IS_RTL_CHAR);
}

/** Miroir des paires ouvrantes/fermantes en contexte droite-a-gauche. */
const MIRRORS: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«',
};

/**
 * Decoupe un mot en runs directionnels : arabe / crochet-miroir / neutre
 * (chiffres, latin, ponctuation). Les crochets sont mirrores et isoles pour
 * etre places correctement dans le flux droite-a-gauche.
 */
function runsOfWord(word: string): string[] {
  const runs: string[] = [];
  let cur = '';
  let kind: 'rtl' | 'mirror' | 'neutral' | null = null;
  for (const c of word) {
    const k = IS_RTL_CHAR(c) ? 'rtl' : (MIRRORS[c] ? 'mirror' : 'neutral');
    if (cur && k !== kind) { runs.push(cur); cur = ''; }
    cur += MIRRORS[c] ?? c;
    kind = k;
  }
  if (cur) runs.push(cur);
  return runs;
}

/**
 * Coupe un paragraphe arabe en lignes AVANT reordonnancement, sur la chaine
 * logique (l'ordre bidi se calcule par ligne). Les fleches absentes de Cairo
 * sont remplacees par un tiret cadratin.
 */
export function arabicLines(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
  const words = text.replace(/[←→]/g, '—').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (cur && doc.widthOfString(test) > width) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Dessine une ligne arabe ancree a droite (xRight), chaque mot puis chaque run
 * directionnel pose de droite a gauche. L'appelant a deja selectionne la police
 * arabe (doc.font(...)) et la couleur.
 */
export function drawArabicLineRight(
  doc: PDFKit.PDFDocument, line: string, xRight: number, y: number,
): void {
  const space = doc.widthOfString(' ');
  let x = xRight;
  for (const word of line.split(' ').filter(Boolean)) {
    for (const run of runsOfWord(word)) {
      const w = doc.widthOfString(run);
      x -= w;
      doc.text(run, x, y, { lineBreak: false });
    }
    x -= space;
  }
}

/**
 * Entier (unite monetaire) en toutes lettres arabes. Suffisant pour la mention
 * « arrete la presente facture a la somme de » d'une facture marocaine.
 * Couvre 0 a 999 999 ; au-dela, retombe sur les chiffres.
 */
export function numberToWordsAR(num: number, currency = 'درهم', sub = 'سنتيم'): string {
  const intPart = Math.floor(Math.abs(num));
  const decPart = Math.round((Math.abs(num) - intPart) * 100);
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
    'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر',
    'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة',
    'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function under1000(n: number): string {
    const parts: string[] = [];
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (h) parts.push(hundreds[h]);
    if (r < 20) { if (r) parts.push(ones[r]); }
    else {
      const u = r % 10;
      const t = Math.floor(r / 10);
      if (u) parts.push(ones[u]);
      parts.push(tens[t]);
    }
    return parts.join(' و');
  }

  function convert(n: number): string {
    if (n === 0) return 'صفر';
    if (n < 1000) return under1000(n);
    if (n < 1000000) {
      const th = Math.floor(n / 1000);
      const r = n % 1000;
      const thWord = th === 1 ? 'ألف' : th === 2 ? 'ألفان' : (th < 11 ? `${ones[th]} آلاف` : `${under1000(th)} ألف`);
      return r ? `${thWord} و${under1000(r)}` : thWord;
    }
    return String(n);
  }

  let res = convert(intPart) + ' ' + currency;
  if (decPart > 0) res += ' و' + convert(decPart) + ' ' + sub;
  return (num < 0 ? 'ناقص ' : '') + res;
}
