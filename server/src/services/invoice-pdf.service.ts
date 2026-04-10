import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

// Resolve logo — try multiple possible locations
function findDefaultLogo(): string {
  const candidates = [
    resolve(process.cwd(), 'server', 'assets', 'logo-ofauria.png'),
    resolve(process.cwd(), 'assets', 'logo-ofauria.png'),
    resolve(process.cwd(), '..', 'server', 'assets', 'logo-ofauria.png'),
    resolve(process.cwd(), 'client', 'public', 'images', 'logo-horizontal.png'),
    resolve(process.cwd(), '..', 'client', 'public', 'images', 'logo-horizontal.png'),
    // Absolute fallback
    '/Users/anissbouida/projets/Ofauria-app/server/assets/logo-ofauria.png',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return '';
}
const DEFAULT_LOGO = findDefaultLogo();

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
}

// ── Ofauria brand colors ──
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

function numberToWordsFR(num: number): string {
  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

  if (num === 0) return 'z\u00e9ro';
  if (num < 0) return 'moins ' + numberToWordsFR(-num);

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
    result += ' dirhams et ' + convert(decPart) + ' centimes';
  } else {
    result += ' dirhams';
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
      Title: `Facture ${data.invoiceNumber}`,
      Author: data.companyName,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // ════════════════════════════════════════════════════════════
  // HEADER — Logo or company name
  // ════════════════════════════════════════════════════════════
  let y = M;

  // Resolve logo: use provided path, or fall back to bundled asset
  const resolvedLogo = (data.logoPath && existsSync(data.logoPath)) ? data.logoPath
                     : existsSync(DEFAULT_LOGO) ? DEFAULT_LOGO : null;

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
  doc.font('Helvetica-BoldOblique').fontSize(28).fillColor(BROWN);
  txt(doc, 'FACTURE', M, y, { align: 'right', width: CW });
  const titleWidth = doc.widthOfString('FACTURE');
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
      txt(doc, label, x + 5, yy + 7, { width: w - 10 });
    } else {
      drawBorderedRect(doc, x, yy, w, infoH);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK);
      txt(doc, value, x + 5, yy + 7, { width: w - 10 });
    }
    doc.rect(x, yy, w, infoH).lineWidth(0.5).stroke(BORDER);
  }

  drawInfoCell(M, y, infoColW, 'N\u00B0 FACTURE', '', true);
  drawInfoCell(M + infoColW, y, infoColW, '', data.invoiceNumber, false);
  drawInfoCell(M + infoColW * 2, y, infoColW, 'DATE D\u2019\u00C9MISSION', '', true);
  drawInfoCell(M + infoColW * 3, y, infoColW, '', data.invoiceDate, false);
  y += infoH;

  drawInfoCell(M, y, infoColW, 'MODE PAIEMENT', '', true);
  drawInfoCell(M + infoColW, y, infoColW, '', data.paymentMethod || '', false);
  drawInfoCell(M + infoColW * 2, y, infoColW, 'DATE D\u2019\u00C9CH\u00C9ANCE', '', true);
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
  txt(doc, 'FACTURER \u00C0', clientBoxX + 8, y + 6, { width: clientBoxW - 16 });
  y += clientHeaderH;

  drawRect(doc, clientBoxX, y, clientBoxW, clientContentH, BROWN);
  let clientY = y + 6;
  for (let i = 0; i < clientLines.length; i++) {
    const isFirst = i === 0;
    doc.font(isFirst ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(isFirst ? 10 : 8)
       .fillColor(WHITE);
    txt(doc, clientLines[i], clientBoxX + 8, clientY, { width: clientBoxW - 16 });
    clientY += isFirst ? 14 : 12;
  }
  y += clientContentH + 10;

  // ════════════════════════════════════════════════════════════
  // ITEMS TABLE
  // ════════════════════════════════════════════════════════════
  const colWidths = [CW * 0.45, CW * 0.12, CW * 0.20, CW * 0.23];
  const colHeaders = ['DESIGNATION', 'QTE', 'PRIX U. (DH)', 'MONTANT (DH)'];
  const rowH = 22;
  const headerH = 26;

  let x = M;
  for (let i = 0; i < colHeaders.length; i++) {
    drawRect(doc, x, y, colWidths[i], headerH, BROWN);
    doc.rect(x, y, colWidths[i], headerH).lineWidth(0.3).stroke(BROWN);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE);
    const align = i >= 2 ? 'right' : i >= 1 ? 'center' : 'left';
    txt(doc, colHeaders[i], x + 5, y + 8, { width: colWidths[i] - 10, align });
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
          text = item.description;
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
      txt(doc, text, x + 5, y + 6, { width: colWidths[col] - 10, align });
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
  const amountWords = data.amountInWords || numberToWordsFR(data.totalTTC);

  drawRect(doc, M, y, notesW, 18, BEIGE);
  doc.rect(M, y, notesW, 18).lineWidth(0.3).stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BROWN);
  txt(doc, 'NOTES & CONDITIONS', M + 6, y + 5, { width: notesW - 12 });

  const notesContentY = y + 18;
  const notesContentH = totalRowH * 4 - 18;
  drawRect(doc, M, notesContentY, notesW, notesContentH, BEIGE);
  doc.rect(M, notesContentY, notesW, notesContentH).lineWidth(0.3).stroke(BORDER);

  let ny = notesContentY + 6;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_DARK);
  txt(doc, 'ARRETE LA PRESENTE FACTURE A LA SOMME DE :', M + 6, ny, { width: notesW - 12 });
  ny += 12;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GOLD);
  txt(doc, amountWords, M + 6, ny, { width: notesW - 12 });
  ny += 14;

  if (data.companyBankName || data.companyBankAccount) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_DARK);
    txt(doc, 'Information bancaire :', M + 6, ny, { width: notesW - 12 });
    ny += 10;
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
    txt(doc, label, totalsX + 6, ty + 6, { width: totalsW * 0.55 - 12 });

    drawRect(doc, totalsX + totalsW * 0.55, ty, totalsW * 0.45, h, bg);
    doc.rect(totalsX + totalsW * 0.55, ty, totalsW * 0.45, h).lineWidth(0.3).stroke(BORDER);
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 10 : 9).fillColor(tc);
    txt(doc, value, totalsX + totalsW * 0.55 + 4, ty + (opts.bold ? 5 : 6), { width: totalsW * 0.45 - 10, align: 'right' });

    ty += h;
  }

  drawTotalRow('SOUS-TOTAL HT', `${n(data.totalHT)} DH`, { bold: true });
  drawTotalRow('REMISE', '0 %');
  drawTotalRow(`TVA (${data.tvaRate} %)`, `${n(data.totalTVA)} DH`);
  drawTotalRow('TOTAL TTC', `${n(data.totalTTC)} DH`, { bg: BROWN, textColor: WHITE, bold: true, height: 28 });

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

export { numberToWordsFR };
