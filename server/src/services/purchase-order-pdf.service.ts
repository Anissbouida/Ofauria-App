import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

// Resolve le logo du PDF : data URI base64 (persiste en base, dispo meme sur FS
// ephemere type Cloud Run), chemin fichier, ou logo par defaut bundle. Renvoie une
// valeur acceptee par doc.image() : chemin (string) ou Buffer, ou null.
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
  // Helvetica (PDFKit built-in) n'a pas les espaces Unicode U+202F / U+00A0
  // utilises comme separateurs de milliers en fr-FR → rendus comme "/" dans le PDF
  return val
    .toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[  ]/g, ' ');
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

  const resolvedLogo = resolveLogoInput(data.logoPath);

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
  const colWidths = [CW * 0.65, CW * 0.17, CW * 0.18];
  const colHeaders = ['D\u00C9SIGNATION', 'UNIT\u00C9', 'QT\u00C9'];
  const rowH = 22;
  const tblHeaderH = 26;

  let x = M;
  for (let i = 0; i < colHeaders.length; i++) {
    drawRect(doc, x, y, colWidths[i], tblHeaderH, BROWN);
    doc.rect(x, y, colWidths[i], tblHeaderH).lineWidth(0.3).stroke(BROWN);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE);
    const align = i === 0 ? 'left' : 'center';
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
    ];

    for (let col = 0; col < colWidths.length; col++) {
      drawRect(doc, x, y, colWidths[col], rowH, bg);
      doc.rect(x, y, colWidths[col], rowH).lineWidth(0.3).stroke(BORDER);
      doc.font(cellData[col].font).fontSize(8.5).fillColor(TEXT_DARK);
      txt(doc, cellData[col].text, x + 5, y + 6, { width: colWidths[col] - 10, align: cellData[col].align });
      x += colWidths[col];
    }
    y += rowH;
  }

  y += 10;

  // ════════════════════════════════════════════════════════════
  // NOTES & INSTRUCTIONS (pleine largeur, sans totaux)
  // ════════════════════════════════════════════════════════════
  const notesW = CW;
  const notesHeaderH = 18;
  const notesContentH = 60;

  drawRect(doc, M, y, notesW, notesHeaderH, BEIGE);
  doc.rect(M, y, notesW, notesHeaderH).lineWidth(0.3).stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BROWN);
  txt(doc, 'NOTES & INSTRUCTIONS', M + 6, y + 5, { width: notesW - 12 });
  y += notesHeaderH;

  drawRect(doc, M, y, notesW, notesContentH, BEIGE);
  doc.rect(M, y, notesW, notesContentH).lineWidth(0.3).stroke(BORDER);

  if (data.notes) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
    txt(doc, data.notes, M + 6, y + 6, { width: notesW - 12 });
  }

  y += notesContentH + 12;

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
