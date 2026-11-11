import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { loadDocumentTemplate, legalFooterLines, formatRib } from '../utils/document-template.js';
import { arabicFontPath, containsArabic, drawArabicLineRight, numberToWordsAR } from '../utils/arabic-pdf.js';

// Resolve logo — try multiple possible locations
function findDefaultLogo(): string {
  const candidates = [
    resolve(process.cwd(), 'server', 'assets', 'company-logo.png'),
    resolve(process.cwd(), 'assets', 'company-logo.png'),
    resolve(process.cwd(), '..', 'server', 'assets', 'company-logo.png'),
    resolve(process.cwd(), 'client', 'public', 'images', 'logo-horizontal.png'),
    resolve(process.cwd(), '..', 'client', 'public', 'images', 'logo-horizontal.png'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return '';
}
const DEFAULT_LOGO = findDefaultLogo();

// Resolve the logo passed to the PDF. Accepts either a base64 data URI
// (logo persiste en base -> disponible meme sur un FS ephemere type Cloud Run),
// un chemin fichier, ou retombe sur le logo par defaut bundle. Renvoie une valeur
// acceptee par doc.image() : chemin (string) ou Buffer, ou null si rien de dispo.
function resolveLogoInput(logoPath?: string): string | Buffer | null {
  if (logoPath) {
    if (logoPath.startsWith('data:')) {
      const b64 = logoPath.slice(logoPath.indexOf(',') + 1);
      if (b64) {
        try { return Buffer.from(b64, 'base64'); } catch { /* data URI invalide */ }
      }
    } else if (existsSync(logoPath)) {
      return logoPath;
    }
  }
  return existsSync(DEFAULT_LOGO) ? DEFAULT_LOGO : null;
}

interface InvoiceItem {
  description: string;
  category?: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  paymentMethod?: string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerICE?: string;
  items: InvoiceItem[];
  totalHT: number;
  tvaRate: number;
  totalTVA: number;
  totalTTC: number;
  // Ventilation TVA par taux (factures multi-taux). Si fourni avec >1 entree,
  // on affiche une ligne TVA par taux ; sinon on retombe sur la ligne unique.
  tvaBreakdown?: { rate: number; amount: number }[];
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyRC?: string;
  companyPatente?: string;
  companyIF?: string;
  companyCNSS?: string;
  companyICE?: string;
  companyBankAccount?: string;
  companyBankName?: string;
  amountInWords?: string;
  logoPath?: string;
  /** Devis et proforma (mig 365) : même mise en page, titres et mentions adaptés. Défaut : facture. */
  kind?: 'invoice' | 'quote' | 'proforma' | 'credit_note';
  /** Libellé de la ligne « Remise » (ex. « 5 % (−12,00 DH) ») ; défaut « 0 % ». */
  discountLabel?: string;
  /** Texte libre ajouté aux conditions (délai de livraison, notes du devis). */
  extraNotes?: string;
  /** Prix TTC (particulier, sans TVA détaillée) : sous-total TTC et « TVA incluse ». */
  pricesInclTax?: boolean;
  /** Facture en devise (mig 431) : montants déjà convertis dans la devise, taux et contre-valeur en DH. */
  currency?: { code: string; rate: number; totalDh: number };
  /** Phase 10.1 — langue du document. Défaut : français (chemin inchangé).
   *  'ar' : libellés et montant en toutes lettres en arabe, police Cairo, tracé droite-à-gauche. */
  locale?: 'fr' | 'ar';
}

/**
 * Phase 10.1 — libellés fixes de la facture en arabe. Les valeurs (nom du
 * client, montants, numéros) restent telles quelles. Seuls les libellés
 * structurants sont traduits ; la géométrie (totaux à droite, tableau LTR) est
 * conservée. Limite connue : la mise en miroir complète de la page reste à
 * faire. Une entrée vide signifie « garder le libellé latin ».
 */
const KIND_TEXT_AR: Record<keyof typeof KIND_TEXT, { title: string; number: string; due: string; to: string; words: string }> = {
  invoice:     { title: 'فاتورة',        number: 'رقم الفاتورة',       due: 'تاريخ الاستحقاق', to: 'فوترة إلى', words: 'نُحرّر هذه الفاتورة بمبلغ :' },
  quote:       { title: 'عرض سعر',        number: 'رقم العرض',          due: 'صالح حتى',        to: 'العميل',    words: 'نُحرّر هذا العرض بمبلغ :' },
  proforma:    { title: 'فاتورة أولية',   number: 'رقم الفاتورة الأولية', due: 'صالح حتى',        to: 'العميل',    words: 'نُحرّر هذه الفاتورة الأولية بمبلغ :' },
  credit_note: { title: 'إشعار دائن',     number: 'رقم الإشعار',        due: 'الفاتورة الأصلية', to: 'العميل',    words: 'نُحرّر هذا الإشعار بمبلغ :' },
};

/** Libellés communs (hors titre) traduits quand la facture est en arabe. */
const LABELS_AR: Record<string, string> = {
  dateIssued: 'تاريخ الإصدار',
  paymentMode: 'طريقة الدفع',
  designation: 'البيان',
  qty: 'الكمية',
  unitPrice: 'سعر الوحدة',
  amount: 'المبلغ',
  notes: 'ملاحظات وشروط',
  bankInfo: 'المعلومات البنكية',
  bank: 'البنك',
  rib: 'رقم الحساب',
  subtotalHT: 'المجموع دون ضريبة',
  subtotalTTC: 'المجموع بالضريبة',
  discount: 'الخصم',
  tva: 'الضريبة',
  tvaIncluded: 'ضريبة مُدرجة',
  totalTTC: 'المجموع الإجمالي',
  signature: 'التوقيع والختم',
  quoteAccord: 'موافقة : التاريخ والتوقيع وختم العميل',
};

/** Unité et sous-unité en toutes lettres des devises courantes ; à défaut, le code ISO. */
const CURRENCY_WORDS: Record<string, [string, string]> = {
  MAD: ['dirhams', 'centimes'], EUR: ['euros', 'centimes'], USD: ['dollars américains', 'cents'],
  GBP: ['livres sterling', 'pence'], CHF: ['francs suisses', 'centimes'], CAD: ['dollars canadiens', 'cents'],
};

const KIND_TEXT = {
  invoice:  { title: 'FACTURE',          number: 'N\u00B0 FACTURE',  due: 'DATE D\u2019\u00C9CH\u00C9ANCE', to: 'FACTURER \u00C0', words: 'ARRETE LA PRESENTE FACTURE A LA SOMME DE :', meta: 'Facture' },
  quote:    { title: 'DEVIS',            number: 'N\u00B0 DEVIS',    due: 'VALABLE JUSQU\u2019AU',            to: 'CLIENT',          words: 'ARRETE LE PRESENT DEVIS A LA SOMME DE :',     meta: 'Devis' },
  proforma: { title: 'FACTURE PROFORMA', number: 'N\u00B0 PROFORMA', due: 'VALABLE JUSQU\u2019AU',            to: 'CLIENT',          words: 'ARRETE LA PRESENTE PROFORMA A LA SOMME DE :', meta: 'Proforma' },
  // Avoir client (O2C L4) : le champ « échéance » porte la facture d'origine.
  credit_note: { title: 'AVOIR',          number: 'N\u00B0 AVOIR',    due: 'FACTURE D\u2019ORIGINE',         to: 'CLIENT',          words: 'ARRETE LE PRESENT AVOIR A LA SOMME DE :',     meta: 'Avoir' },
} as const;

// ── Couleurs de la charte ──
const BROWN = '#8E4A1F';
const BEIGE = '#F5F0E8';
const CREAM = '#FDFAF4';
const GOLD = '#B8860B';
const TEXT_DARK = '#3B2F2F';
const TEXT_MUTED = '#7A7168';
const BORDER = '#D6CFC4';
const WHITE = '#FFFFFF';

function n(val: number): string {
  // toLocaleString('fr-FR') inserts U+202F (narrow no-break space) as the
  // thousands separator. PDFKit's default Helvetica encoding can't render it
  // and emits a stray glyph ('/'). On retombe sur l'espace standard.
  return val
    .toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[\u202F\u00A0]/g, ' ');
}

function numberToWordsFR(num: number, words: [string, string] = CURRENCY_WORDS.MAD): string {
  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

  if (num === 0) return 'z\u00e9ro';
  if (num < 0) return 'moins ' + numberToWordsFR(-num, words);

  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);

  function convert(n: number): string {
    if (n === 0) return '';
    if (n < 20) return units[n];
    if (n < 100) {
      const tt = Math.floor(n / 10);
      const u = n % 10;
      if (tt === 7 || tt === 9) return tens[tt] + (u === 1 && tt === 7 ? ' et ' : '-') + units[10 + u];
      if (tt === 8 && u === 0) return 'quatre-vingts';
      return tens[tt] + (u === 1 && tt < 8 ? ' et ' : u > 0 ? '-' : '') + (u > 0 ? units[u] : '');
    }
    if (n < 1000) {
      const h = Math.floor(n / 100);
      const r = n % 100;
      const prefix = h === 1 ? 'cent' : units[h] + ' cent' + (r === 0 ? 's' : '');
      return prefix + (r > 0 ? ' ' + convert(r) : '');
    }
    if (n < 1000000) {
      const th = Math.floor(n / 1000);
      const r = n % 1000;
      const prefix = th === 1 ? 'mille' : convert(th) + ' mille';
      return prefix + (r > 0 ? ' ' + convert(r) : '');
    }
    return String(n);
  }

  let result = convert(intPart);
  result = result.charAt(0).toUpperCase() + result.slice(1);
  if (decPart > 0) {
    result += ` ${words[0]} et ` + convert(decPart) + ` ${words[1]}`;
  } else {
    result += ` ${words[0]}`;
  }
  return result;
}

// ── Drawing helpers ──
function drawRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, fill: string) {
  doc.rect(x, y, w, h).fill(fill);
}

function drawBorderedRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, fill?: string) {
  if (fill) doc.rect(x, y, w, h).fill(fill);
  doc.rect(x, y, w, h).lineWidth(0.5).stroke(BORDER);
}

// All text is drawn with lineBreak:false to prevent PDFKit auto-pagination
function txt(doc: PDFKit.PDFDocument, text: string, x: number, y: number, opts: Record<string, unknown> = {}) {
  doc.text(text, x, y, { ...opts, lineBreak: false });
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  // Mentions communes reglees dans Parametres > Documents (mig 332) et fiche societe.
  const K = KIND_TEXT[data.kind ?? 'invoice'];
  // Phase 10.1 — document en arabe : libellés traduits, police Cairo, tracé RTL.
  // `arFont` null (police absente) => on retombe sur le latin, jamais de charabia.
  const AR = data.locale === 'ar';
  const arFont = AR ? arabicFontPath() : null;
  const Kar = AR ? KIND_TEXT_AR[data.kind ?? 'invoice'] : null;
  const L = (key: keyof typeof LABELS_AR, fr: string) => (AR && arFont ? (LABELS_AR[key] ?? fr) : fr);
  const tpl = await loadDocumentTemplate(data.kind === 'quote' || data.kind === 'proforma' ? 'quote' : 'invoice');
  if (!tpl.showBank) {
    data = { ...data, companyBankName: undefined, companyBankAccount: undefined };
  } else if (!data.companyBankAccount && tpl.bank) {
    data = { ...data, companyBankName: tpl.bank.bankName, companyBankAccount: formatRib(tpl.bank.rib) };
  }
  const M = 40; // margin
  const PW = 595.28; // A4 width
  const PH = 841.89; // A4 height
  const CW = PW - M * 2; // content width

  // Bottom margin set to 0 to completely disable auto-pagination.
  // All positioning is manual — we ensure content fits on one A4 page.
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M, bottom: 0, left: M, right: M },
    autoFirstPage: true,
    info: {
      Title: `${K.meta} ${data.invoiceNumber}`,
      Author: data.companyName,
    },
  });

  if (arFont) doc.registerFont('AR', arFont);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // Phase 10.1 — pose un libellé fixe. En arabe, si le texte contient de
  // l'arabe : police Cairo + tracé droite-à-gauche ancré au bord droit de la
  // cellule (x + w). Sinon : tracé latin strictement identique au chemin FR,
  // la police restant celle choisie par l'appelant (gras, oblique…).
  function putLabel(text: string, lx: number, ly: number, lw: number, align: 'left' | 'center' | 'right' = 'left') {
    if (arFont && containsArabic(text)) {
      doc.font('AR');
      drawArabicLineRight(doc, text, lx + lw, ly);
    } else {
      txt(doc, text, lx, ly, { width: lw, align });
    }
  }

  // ════════════════════════════════════════════════════════════
  // HEADER — Logo or company name
  // ════════════════════════════════════════════════════════════
  let y = M;

  // Resolve logo: data URI (base) / chemin fichier / logo par defaut bundle
  const resolvedLogo = resolveLogoInput(data.logoPath);

  if (resolvedLogo) {
    try {
      doc.image(resolvedLogo, M, y, { width: 220, height: 88 });
      y += 96;
    } catch (err) {
      console.error('[Invoice PDF] Logo render error:', err);
      doc.font('Helvetica-Bold').fontSize(20).fillColor(BROWN);
      txt(doc, '\u00D4FAURIA', M, y);
      doc.font('Helvetica').fontSize(7).fillColor(GOLD);
      txt(doc, 'B O U L A N G E R I E  \u2022  P \u00C2 T I S S E R I E', M, y + 24);
      y += 42;
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BROWN);
    txt(doc, '\u00D4FAURIA', M, y);
    doc.font('Helvetica').fontSize(7).fillColor(GOLD);
    txt(doc, 'B O U L A N G E R I E  \u2022  P \u00C2 T I S S E R I E', M, y + 24);
    y += 42;
  }

  // ════════════════════════════════════════════════════════════
  // TITLE — "FACTURE" right-aligned
  // ════════════════════════════════════════════════════════════
  const titleText = AR && Kar ? Kar.title : K.title;
  if (AR && arFont) {
    doc.font('AR').fontSize(26).fillColor(BROWN);
    drawArabicLineRight(doc, titleText, PW - M, y);
  } else {
    doc.font('Helvetica-BoldOblique').fontSize(28).fillColor(BROWN);
    txt(doc, titleText, M, y, { align: 'right', width: CW });
  }
  const titleWidth = doc.widthOfString(titleText);
  doc.moveTo(PW - M - titleWidth, y + 30).lineTo(PW - M, y + 30).lineWidth(1.5).stroke(BROWN);
  y += 42;

  // ════════════════════════════════════════════════════════════
  // INFO TABLE — 2 rows x 4 columns
  // ════════════════════════════════════════════════════════════
  const infoH = 24;
  const infoColW = CW / 4;

  function drawInfoCell(x: number, yy: number, w: number, label: string, value: string, isLabel: boolean) {
    if (isLabel) {
      drawRect(doc, x, yy, w, infoH, BEIGE);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(BROWN);
      putLabel(label, x + 5, yy + 7, w - 10);
    } else {
      drawBorderedRect(doc, x, yy, w, infoH);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK);
      putLabel(value, x + 5, yy + 7, w - 10);
    }
    doc.rect(x, yy, w, infoH).lineWidth(0.5).stroke(BORDER);
  }

  drawInfoCell(M, y, infoColW, AR && Kar ? Kar.number : K.number, '', true);
  drawInfoCell(M + infoColW, y, infoColW, '', data.invoiceNumber, false);
  drawInfoCell(M + infoColW * 2, y, infoColW, L('dateIssued', 'DATE D\u2019\u00C9MISSION'), '', true);
  drawInfoCell(M + infoColW * 3, y, infoColW, '', data.invoiceDate, false);
  y += infoH;

  drawInfoCell(M, y, infoColW, L('paymentMode', 'MODE PAIEMENT'), '', true);
  drawInfoCell(M + infoColW, y, infoColW, '', data.paymentMethod || '', false);
  drawInfoCell(M + infoColW * 2, y, infoColW, AR && Kar ? Kar.due : K.due, '', true);
  drawInfoCell(M + infoColW * 3, y, infoColW, '', data.dueDate || '', false);
  y += infoH + 10;

  // ════════════════════════════════════════════════════════════
  // CLIENT BOX — right-aligned
  // ════════════════════════════════════════════════════════════
  const clientBoxW = CW / 2 + 20;
  const clientBoxX = PW - M - clientBoxW;
  const clientLines: string[] = [data.customerName || '[Nom du client / Entreprise]'];
  if (data.customerAddress) clientLines.push(data.customerAddress);
  if (data.customerPhone) clientLines.push(data.customerPhone);
  if (data.customerEmail) clientLines.push(data.customerEmail);
  if (data.customerICE) clientLines.push(`ICE / IF : ${data.customerICE}`);

  const clientHeaderH = 20;
  const clientContentH = Math.max(40, clientLines.length * 14 + 10);

  drawRect(doc, clientBoxX, y, clientBoxW, clientHeaderH, BROWN);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE);
  putLabel(AR && Kar ? Kar.to : K.to, clientBoxX + 8, y + 6, clientBoxW - 16);
  y += clientHeaderH;

  drawRect(doc, clientBoxX, y, clientBoxW, clientContentH, BROWN);
  let clientY = y + 6;
  for (let i = 0; i < clientLines.length; i++) {
    const isFirst = i === 0;
    doc.font(isFirst ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(isFirst ? 10 : 8)
       .fillColor(WHITE);
    // En arabe, un nom de client arabe est tracé RTL ; une ligne latine (tél,
    // e-mail) retombe sur le tracé latin gauche-à-droite inchangé.
    putLabel(clientLines[i], clientBoxX + 8, clientY, clientBoxW - 16);
    clientY += isFirst ? 14 : 12;
  }
  y += clientContentH + 10;

  // ════════════════════════════════════════════════════════════
  // ITEMS TABLE
  // ════════════════════════════════════════════════════════════
  const colWidths = [CW * 0.45, CW * 0.12, CW * 0.20, CW * 0.23];
  const CUR = data.currency?.code ?? 'DH';
  const colHeaders = AR && arFont
    ? [LABELS_AR.designation, LABELS_AR.qty, `${LABELS_AR.unitPrice} (${CUR})`, `${LABELS_AR.amount} (${CUR})`]
    : ['DESIGNATION', 'QTE', `PRIX U. (${CUR})`, `MONTANT (${CUR})`];
  const rowH = 22;
  const headerH = 26;

  let x = M;
  for (let i = 0; i < colHeaders.length; i++) {
    drawRect(doc, x, y, colWidths[i], headerH, BROWN);
    doc.rect(x, y, colWidths[i], headerH).lineWidth(0.3).stroke(BROWN);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE);
    const align = i >= 2 ? 'right' : i >= 1 ? 'center' : 'left';
    putLabel(colHeaders[i], x + 5, y + 8, colWidths[i] - 10, align);
    x += colWidths[i];
  }
  y += headerH;

  // Only show actual items + 1 empty row max
  const displayItems = [...data.items];
  while (displayItems.length < data.items.length + 1 && displayItems.length < 2) {
    displayItems.push({ description: '', category: '', quantity: 0, unit_price: 0, subtotal: 0 });
  }

  for (let r = 0; r < displayItems.length; r++) {
    const item = displayItems[r];
    const bg = r % 2 === 0 ? CREAM : WHITE;
    x = M;

    for (let col = 0; col < 4; col++) {
      drawRect(doc, x, y, colWidths[col], rowH, bg);
      doc.rect(x, y, colWidths[col], rowH).lineWidth(0.3).stroke(BORDER);

      let text = '';
      let font = 'Helvetica';
      let fontSize = 8.5;
      let color = TEXT_DARK;
      let align: 'left' | 'right' | 'center' = 'left';

      switch (col) {
        case 0:
          text = (item.description || '').toLocaleUpperCase('fr-FR');
          font = 'Helvetica-Bold';
          break;
        case 1:
          text = item.quantity ? String(item.quantity) : '';
          align = 'center';
          break;
        case 2:
          text = item.unit_price ? n(item.unit_price) : '';
          align = 'right';
          break;
        case 3:
          text = item.subtotal ? n(item.subtotal) : '';
          font = 'Helvetica-Bold';
          align = 'right';
          break;
      }

      doc.font(font).fontSize(fontSize).fillColor(color);
      putLabel(text, x + 5, y + 6, colWidths[col] - 10, align);
      x += colWidths[col];
    }
    y += rowH;
  }

  y += 8;

  // ════════════════════════════════════════════════════════════
  // BOTTOM: Notes (left) + Totals (right)
  // ════════════════════════════════════════════════════════════
  const notesW = CW * 0.52;
  const totalsW = CW - notesW - 8;
  const totalsX = M + notesW + 8;
  const totalRowH = 22;
  const bottomStartY = y;

  // ── Notes box ──
  const amountWords = data.amountInWords
    || (AR && arFont
      ? numberToWordsAR(data.totalTTC)
      : numberToWordsFR(data.totalTTC, data.currency ? CURRENCY_WORDS[data.currency.code] ?? [data.currency.code, 'centièmes'] : CURRENCY_WORDS.MAD));

  drawRect(doc, M, y, notesW, 18, BEIGE);
  doc.rect(M, y, notesW, 18).lineWidth(0.3).stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BROWN);
  putLabel(L('notes', 'NOTES & CONDITIONS'), M + 6, y + 5, notesW - 12);

  const notesContentY = y + 18;
  const notesContentH = totalRowH * 4 - 18;
  drawRect(doc, M, notesContentY, notesW, notesContentH, BEIGE);
  doc.rect(M, notesContentY, notesW, notesContentH).lineWidth(0.3).stroke(BORDER);

  let ny = notesContentY + 6;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_DARK);
  putLabel(AR && Kar ? Kar.words : K.words, M + 6, ny, notesW - 12);
  ny += 12;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GOLD);
  putLabel(amountWords, M + 6, ny, notesW - 12);
  ny += 14;

  if (data.companyBankName || data.companyBankAccount) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_DARK);
    putLabel(L('bankInfo', 'Information bancaire :'), M + 6, ny, notesW - 12);
    ny += 10;
    // Identifiants bancaires : valeur latine (RIB, nom de banque) laissée en
    // tracé latin gauche-à-droite — le tracé RTL inverserait les groupes du RIB.
    doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED);
    if (data.companyBankName) {
      txt(doc, `BANQUE : ${data.companyBankName}`, M + 6, ny, { width: notesW - 12 });
      ny += 10;
    }
    if (data.companyBankAccount) {
      txt(doc, `RIB. : ${data.companyBankAccount}`, M + 6, ny, { width: notesW - 12 });
    }
  }

  // ── Totals ──
  let ty = bottomStartY;

  function drawTotalRow(label: string, value: string, opts: { bg?: string; textColor?: string; bold?: boolean; height?: number } = {}) {
    const h = opts.height || totalRowH;
    const bg = opts.bg || WHITE;
    const tc = opts.textColor || TEXT_DARK;

    drawRect(doc, totalsX, ty, totalsW * 0.55, h, bg);
    doc.rect(totalsX, ty, totalsW * 0.55, h).lineWidth(0.3).stroke(BORDER);
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(tc);
    putLabel(label, totalsX + 6, ty + 6, totalsW * 0.55 - 12);

    drawRect(doc, totalsX + totalsW * 0.55, ty, totalsW * 0.45, h, bg);
    doc.rect(totalsX + totalsW * 0.55, ty, totalsW * 0.45, h).lineWidth(0.3).stroke(BORDER);
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 10 : 9).fillColor(tc);
    putLabel(value, totalsX + totalsW * 0.55 + 4, ty + (opts.bold ? 5 : 6), totalsW * 0.45 - 10, 'right');

    ty += h;
  }

  drawTotalRow(data.pricesInclTax ? L('subtotalTTC', 'SOUS-TOTAL TTC') : L('subtotalHT', 'SOUS-TOTAL HT'), `${n(data.totalHT)} ${CUR}`, { bold: true });
  drawTotalRow(L('discount', 'REMISE'), data.discountLabel ?? '0 %');
  if (data.pricesInclTax) {
    drawTotalRow(L('tva', 'TVA'), L('tvaIncluded', 'incluse'));
  } else {
  // TVA : une ligne par taux si la facture est multi-taux, sinon ligne unique.
  const breakdown = (data.tvaBreakdown || []).filter(b => b.amount !== 0);
  if (breakdown.length > 1) {
    for (const b of breakdown) {
      drawTotalRow(`${L('tva', 'TVA')} (${b.rate} %)`, `${n(b.amount)} ${CUR}`);
    }
  } else {
    drawTotalRow(`${L('tva', 'TVA')} (${data.tvaRate} %)`, `${n(data.totalTVA)} ${CUR}`);
  }
  }
  drawTotalRow(L('totalTTC', 'TOTAL TTC'), `${n(data.totalTTC)} ${CUR}`, { bg: BROWN, textColor: WHITE, bold: true, height: 28 });

  y = Math.max(y + notesContentH + 18, ty + 8);

  // ── Conditions de paiement et penalites de retard (loi 69-21) ──
  const terms = [
    data.kind === 'proforma' && 'Document sans valeur comptable : ne vaut pas facture. La facture définitive sera émise à la livraison.',
    data.kind === 'credit_note' ? null : tpl.paymentTerms && (data.kind && data.kind !== 'invoice' ? tpl.paymentTerms : `Conditions de paiement : ${tpl.paymentTerms}`),
    data.extraNotes,
    data.currency && `Facture établie en ${data.currency.code} au taux de ${String(data.currency.rate).replace('.', ',')} DH pour 1 ${data.currency.code} : contre-valeur ${n(data.currency.totalDh)} DH TTC.`,
    data.kind && data.kind !== 'invoice' ? null : tpl.latePenalty,
  ].filter((x): x is string => !!x);
  if (terms.length) {
    doc.font('Helvetica').fontSize(6.5).fillColor(TEXT_MUTED);
    for (const t of terms) {
      txt(doc, t, M, y, { width: CW * 0.62 });
      y += doc.heightOfString(t, { width: CW * 0.62 }) + 3;
    }
    y += 4;
  }

  // ════════════════════════════════════════════════════════════
  // SIGNATURE
  // ════════════════════════════════════════════════════════════
  const footerStart = PH - (tpl.footerNote ? 62 : 52);
  if (y + 26 < footerStart) {
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED);
    txt(doc, '_________________________', M, y, { align: 'right', width: CW });
    y += 12;
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(TEXT_MUTED);
    const sig = data.kind === 'quote'
      ? L('quoteAccord', 'Bon pour accord : date, signature et cachet du client')
      : L('signature', 'Signature & Cachet');
    putLabel(sig, M, y, CW, 'right');
  }

  // ════════════════════════════════════════════════════════════
  // FOOTER — company legal info at fixed bottom position
  // ════════════════════════════════════════════════════════════
  const fl1: string[] = [];
  if (data.companyName) fl1.push(data.companyName);
  if (data.companyAddress) fl1.push(`Siege Social : ${data.companyAddress}`);
  const fl2: string[] = [];
  if (data.companyPhone) fl2.push(`T\u00e9l : ${data.companyPhone}`);
  if (data.companyEmail) fl2.push(`E-mail : ${data.companyEmail}`);
  const fl3: string[] = [];
  if (data.companyRC) fl3.push(`RC : ${data.companyRC}`);
  if (data.companyPatente) fl3.push(`Patente : ${data.companyPatente}`);
  if (data.companyIF) fl3.push(`IF : ${data.companyIF}`);
  if (data.companyICE) fl3.push(`ICE : ${data.companyICE}`);

  const footerY = footerStart;
  doc.moveTo(M, footerY).lineTo(PW - M, footerY).lineWidth(0.5).stroke(BROWN);

  let fy = footerY + 5;
  doc.font('Helvetica').fontSize(6).fillColor(TEXT_MUTED);
  if (tpl.footerNote) { txt(doc, tpl.footerNote, M, fy, { width: CW, align: 'center' }); fy += 9; }
  // Pied de page legal commun (fiche societe) ; a defaut, les champs fournis par l'appelant.
  const common = legalFooterLines(tpl);
  const lines = common.length ? common : [fl1.join(' | '), fl2.join(' | '), fl3.join(' \u2013 ')].filter(Boolean);
  for (const line of lines) { txt(doc, line, M, fy, { width: CW, align: 'center' }); fy += 9; }

  // ════════════════════════════════════════════════════════════
  // FINALIZE
  // ════════════════════════════════════════════════════════════
  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

export { numberToWordsFR };
