import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { numberToWordsFR } from './invoice-pdf.service.js';

// Resolve logo
function findDefaultLogo(): string {
  const candidates = [
    resolve(process.cwd(), 'server', 'assets', 'logo-ofauria.png'),
    resolve(process.cwd(), 'assets', 'logo-ofauria.png'),
    resolve(process.cwd(), '..', 'server', 'assets', 'logo-ofauria.png'),
    resolve(process.cwd(), 'client', 'public', 'images', 'logo-horizontal.png'),
    resolve(process.cwd(), '..', 'client', 'public', 'images', 'logo-horizontal.png'),
    '/Users/anissbouida/projets/Ofauria-app/server/assets/logo-ofauria.png',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return '';
}
const DEFAULT_LOGO = findDefaultLogo();

interface POItem {
  ingredientName: string;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  subtotal: number | null;
}

interface POData {
  orderNumber: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  notes?: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  supplierAddress?: string;
  items: POItem[];
  totalHT: number;
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyRC?: string;
  companyPatente?: string;
  companyIF?: string;
  companyICE?: string;
  logoPath?: string;
}

// ── Ofauria brand colors (same as invoices) ──
const BROWN = '#8E4A1F';
const BEIGE = '#F5F0E8';
const CREAM = '#FDFAF4';
const GOLD = '#B8860B';
const TEXT_DARK = '#3B2F2F';
const TEXT_MUTED = '#7A7168';
const BORDER = '#D6CFC4';
const WHITE = '#FFFFFF';

function n(val: number): string {
  return val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drawRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, fill: string) {
  doc.rect(x, y, w, h).fill(fill);
}

function drawBorderedRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, fill?: string) {
  if (fill) doc.rect(x, y, w, h).fill(fill);
  doc.rect(x, y, w, h).lineWidth(0.5).stroke(BORDER);
}

function txt(doc: PDFKit.PDFDocument, text: string, x: number, y: number, opts: Record<string, unknown> = {}) {
  doc.text(text, x, y, { ...opts, lineBreak: false });
}

export async function generatePurchaseOrderPdf(data: POData): Promise<Buffer> {
  const M = 40;
  const PW = 595.28;
  const PH = 841.89;
  const CW = PW - M * 2;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M, bottom: 0, left: M, right: M },
    autoFirstPage: true,
    info: {
      Title: `Bon de commande ${data.orderNumber}`,
      Author: data.companyName,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // ════════════════════════════════════════════════════════════
  // HEADER — Logo
  // ════════════════════════════════════════════════════════════
  let y = M;

  const resolvedLogo = (data.logoPath && existsSync(data.logoPath)) ? data.logoPath
                     : existsSync(DEFAULT_LOGO) ? DEFAULT_LOGO : null;

  if (resolvedLogo) {
    try {
      doc.image(resolvedLogo, M, y, { width: 220, height: 88 });
      y += 96;
    } catch {
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
  // TITLE — "BON DE COMMANDE"
  // ════════════════════════════════════════════════════════════
  doc.font('Helvetica-BoldOblique').fontSize(22).fillColor(BROWN);
  txt(doc, 'BON DE COMMANDE', M, y, { align: 'right', width: CW });
  const titleWidth = doc.widthOfString('BON DE COMMANDE');
  doc.moveTo(PW - M - titleWidth, y + 26).lineTo(PW - M, y + 26).lineWidth(1.5).stroke(BROWN);
  y += 38;

  // ════════════════════════════════════════════════════════════
  // INFO TABLE — 2 rows x 4 columns
  // ════════════════════════════════════════════════════════════
  const infoH = 24;
  const infoColW = CW / 4;

  function drawInfoCell(x: number, yy: number, w: number, label: string, value: string, isLabel: boolean) {
    if (isLabel) {
      drawRect(doc, x, yy, w, infoH, BEIGE);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(BROWN);
      txt(doc, label, x + 5, yy + 7, { width: w - 10 });
    } else {
      drawBorderedRect(doc, x, yy, w, infoH);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK);
      txt(doc, value, x + 5, yy + 7, { width: w - 10 });
    }
    doc.rect(x, yy, w, infoH).lineWidth(0.5).stroke(BORDER);
  }

  drawInfoCell(M, y, infoColW, 'N\u00B0 COMMANDE', '', true);
  drawInfoCell(M + infoColW, y, infoColW, '', data.orderNumber, false);
  drawInfoCell(M + infoColW * 2, y, infoColW, 'DATE DE COMMANDE', '', true);
  drawInfoCell(M + infoColW * 3, y, infoColW, '', data.orderDate, false);
  y += infoH;

  drawInfoCell(M, y, infoColW, 'LIVRAISON PR\u00C9VUE', '', true);
  drawInfoCell(M + infoColW, y, infoColW, '', data.expectedDeliveryDate || '\u00C0 confirmer', false);
  drawInfoCell(M + infoColW * 2, y, infoColW, 'ARTICLES', '', true);
  drawInfoCell(M + infoColW * 3, y, infoColW, '', `${data.items.length} article(s)`, false);
  y += infoH + 10;

  // ════════════════════════════════════════════════════════════
  // SUPPLIER BOX — right-aligned
  // ════════════════════════════════════════════════════════════
  const boxW = CW / 2 + 20;
  const boxX = PW - M - boxW;
  const supplierLines: string[] = [data.supplierName];
  if (data.supplierContact) supplierLines.push(`Contact : ${data.supplierContact}`);
  if (data.supplierPhone) supplierLines.push(`T\u00e9l : ${data.supplierPhone}`);
  if (data.supplierEmail) supplierLines.push(data.supplierEmail);
  if (data.supplierAddress) supplierLines.push(data.supplierAddress);

  const headerH = 20;
  const contentH = Math.max(40, supplierLines.length * 14 + 10);

  drawRect(doc, boxX, y, boxW, headerH, BROWN);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE);
  txt(doc, 'FOURNISSEUR', boxX + 8, y + 6, { width: boxW - 16 });
  y += headerH;

  drawRect(doc, boxX, y, boxW, contentH, BROWN);
  let suppY = y + 6;
  for (let i = 0; i < supplierLines.length; i++) {
    const isFirst = i === 0;
    doc.font(isFirst ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(isFirst ? 10 : 8)
       .fillColor(WHITE);
    txt(doc, supplierLines[i], boxX + 8, suppY, { width: boxW - 16 });
    suppY += isFirst ? 14 : 12;
  }
  y += contentH + 10;

  // ════════════════════════════════════════════════════════════
  // ITEMS TABLE
  // ════════════════════════════════════════════════════════════
  const colWidths = [CW * 0.40, CW * 0.12, CW * 0.12, CW * 0.16, CW * 0.20];
  const colHeaders = ['D\u00C9SIGNATION', 'UNIT\u00C9', 'QT\u00C9', 'PRIX U. (DH)', 'MONTANT (DH)'];
  const rowH = 22;
  const tblHeaderH = 26;

  let x = M;
  for (let i = 0; i < colHeaders.length; i++) {
    drawRect(doc, x, y, colWidths[i], tblHeaderH, BROWN);
    doc.rect(x, y, colWidths[i], tblHeaderH).lineWidth(0.3).stroke(BROWN);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE);
    const align = i >= 3 ? 'right' : i >= 1 ? 'center' : 'left';
    txt(doc, colHeaders[i], x + 5, y + 8, { width: colWidths[i] - 10, align });
    x += colWidths[i];
  }
  y += tblHeaderH;

  for (let r = 0; r < data.items.length; r++) {
    const item = data.items[r];
    const bg = r % 2 === 0 ? CREAM : WHITE;
    x = M;

    const cellData: { text: string; font: string; align: 'left' | 'right' | 'center' }[] = [
      { text: item.ingredientName, font: 'Helvetica-Bold', align: 'left' },
      { text: item.unit, font: 'Helvetica', align: 'center' },
      { text: String(item.quantity), font: 'Helvetica', align: 'center' },
      { text: item.unitPrice != null ? n(item.unitPrice) : '\u00C0 d\u00e9finir', font: 'Helvetica', align: 'right' },
      { text: item.subtotal != null && item.subtotal > 0 ? n(item.subtotal) : '\u2014', font: 'Helvetica-Bold', align: 'right' },
    ];

    for (let col = 0; col < 5; col++) {
      drawRect(doc, x, y, colWidths[col], rowH, bg);
      doc.rect(x, y, colWidths[col], rowH).lineWidth(0.3).stroke(BORDER);
      doc.font(cellData[col].font).fontSize(8.5).fillColor(TEXT_DARK);
      txt(doc, cellData[col].text, x + 5, y + 6, { width: colWidths[col] - 10, align: cellData[col].align });
      x += colWidths[col];
    }
    y += rowH;
  }

  y += 8;

  // ════════════════════════════════════════════════════════════
  // BOTTOM: Notes (left) + Total (right)
  // ════════════════════════════════════════════════════════════
  const notesW = CW * 0.52;
  const totalsW = CW - notesW - 8;
  const totalsX = M + notesW + 8;
  const totalRowH = 22;
  const bottomStartY = y;

  // ── Notes box ──
  drawRect(doc, M, y, notesW, 18, BEIGE);
  doc.rect(M, y, notesW, 18).lineWidth(0.3).stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BROWN);
  txt(doc, 'NOTES & INSTRUCTIONS', M + 6, y + 5, { width: notesW - 12 });

  const notesContentY = y + 18;
  const notesContentH = totalRowH * 3 - 18;
  drawRect(doc, M, notesContentY, notesW, notesContentH, BEIGE);
  doc.rect(M, notesContentY, notesW, notesContentH).lineWidth(0.3).stroke(BORDER);

  let ny = notesContentY + 6;
  if (data.notes) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
    txt(doc, data.notes, M + 6, ny, { width: notesW - 12 });
    ny += 14;
  }

  const hasPrices = data.totalHT > 0;
  if (hasPrices) {
    const amountWords = numberToWordsFR(data.totalHT);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_DARK);
    txt(doc, 'TOTAL ESTIM\u00C9 :', M + 6, ny, { width: notesW - 12 });
    ny += 12;
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GOLD);
    txt(doc, amountWords, M + 6, ny, { width: notesW - 12 });
  }

  // ── Total ──
  let ty = bottomStartY;

  function drawTotalRow(label: string, value: string, opts: { bg?: string; textColor?: string; bold?: boolean; height?: number } = {}) {
    const h = opts.height || totalRowH;
    const bg = opts.bg || WHITE;
    const tc = opts.textColor || TEXT_DARK;

    drawRect(doc, totalsX, ty, totalsW * 0.55, h, bg);
    doc.rect(totalsX, ty, totalsW * 0.55, h).lineWidth(0.3).stroke(BORDER);
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(tc);
    txt(doc, label, totalsX + 6, ty + 6, { width: totalsW * 0.55 - 12 });

    drawRect(doc, totalsX + totalsW * 0.55, ty, totalsW * 0.45, h, bg);
    doc.rect(totalsX + totalsW * 0.55, ty, totalsW * 0.45, h).lineWidth(0.3).stroke(BORDER);
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 10 : 9).fillColor(tc);
    txt(doc, value, totalsX + totalsW * 0.55 + 4, ty + (opts.bold ? 5 : 6), { width: totalsW * 0.45 - 10, align: 'right' });

    ty += h;
  }

  drawTotalRow('ARTICLES', `${data.items.length}`, {});
  drawTotalRow('SOUS-TOTAL HT', hasPrices ? `${n(data.totalHT)} DH` : '\u00C0 d\u00e9finir', { bold: true });
  drawTotalRow('TOTAL ESTIM\u00C9', hasPrices ? `${n(data.totalHT)} DH` : '\u00C0 d\u00e9finir', { bg: BROWN, textColor: WHITE, bold: true, height: 28 });

  y = Math.max(y + notesContentH + 18, ty + 8);

  // ════════════════════════════════════════════════════════════
  // SIGNATURE
  // ════════════════════════════════════════════════════════════
  const footerStart = PH - 52;
  if (y + 26 < footerStart) {
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED);
    txt(doc, '_________________________', M, y, { align: 'right', width: CW });
    y += 12;
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(TEXT_MUTED);
    txt(doc, 'Signature & Cachet', M, y, { align: 'right', width: CW });
  }

  // ════════════════════════════════════════════════════════════
  // FOOTER — company legal info
  // ════════════════════════════════════════════════════════════
  const fl1: string[] = [];
  if (data.companyName) fl1.push(data.companyName);
  if (data.companyAddress) fl1.push(`Si\u00e8ge Social : ${data.companyAddress}`);
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
  if (fl1.length) { txt(doc, fl1.join(' | '), M, fy, { width: CW, align: 'center' }); fy += 9; }
  if (fl2.length) { txt(doc, fl2.join(' | '), M, fy, { width: CW, align: 'center' }); fy += 9; }
  if (fl3.length) { txt(doc, fl3.join(' \u2013 '), M, fy, { width: CW, align: 'center' }); }

  // ════════════════════════════════════════════════════════════
  // FINALIZE
  // ════════════════════════════════════════════════════════════
  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
