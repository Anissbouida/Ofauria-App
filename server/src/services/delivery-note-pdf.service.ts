import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadDocumentTemplate, legalFooterLines } from '../utils/document-template.js';
import { settingsRepository } from '../repositories/settings.repository.js';

/**
 * Bon de livraison client (mig 354) : pièce remise avec la marchandise et signée
 * par le réceptionnaire. Quantités livrées et prix HT ; mêmes couleurs que les
 * factures et les bons de commande.
 */

const BROWN = '#8E4A1F';
const BEIGE = '#F5F0E8';
const CREAM = '#FDFAF4';
const TEXT_DARK = '#3B2F2F';
const TEXT_MUTED = '#7A7168';
const BORDER = '#D6CFC4';
const WHITE = '#FFFFFF';

// Helvetica (PDFKit) n'a pas les espaces fines de fr-FR : remplacées par une espace simple.
const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202F\u00A0]/g, ' ');
const q = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[\u202F\u00A0]/g, ' '));
const fmtDate = (d: unknown) => {
  if (!d) return '';
  const s = d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return `${day}/${m}/${y}`;
};

function resolveLogo(logoUrl?: string | null): string | Buffer | null {
  if (logoUrl?.startsWith('data:')) {
    try { return Buffer.from(logoUrl.slice(logoUrl.indexOf(',') + 1), 'base64'); } catch { /* data URI invalide */ }
  }
  const candidates = [
    logoUrl ? resolve(process.cwd(), 'uploads', logoUrl) : '',
    logoUrl ? resolve(process.cwd(), '..', 'uploads', logoUrl) : '',
    resolve(process.cwd(), 'assets', 'company-logo.png'),
    resolve(process.cwd(), 'server', 'assets', 'company-logo.png'),
    resolve(process.cwd(), '..', 'client', 'public', 'images', 'logo-horizontal.png'),
    resolve(process.cwd(), 'client', 'public', 'images', 'logo-horizontal.png'),
  ].filter(Boolean);
  return candidates.find(c => existsSync(c)) ?? null;
}

export async function generateDeliveryNotePdf(note: Record<string, any>): Promise<Buffer> {
  const tpl = await loadDocumentTemplate('invoice');
  const settings = await settingsRepository.get();
  const M = 40, PW = 595.28, PH = 841.89, CW = PW - M * 2;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 0, left: M, right: M },
    info: { Title: `Bon de livraison ${note.number}`, Author: tpl.legal.name } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  // NFC : certains noms de produits portent un accent combinant (E + ◌́) que Helvetica ne sait pas dessiner.
  const txt = (t: string, x: number, y: number, o: Record<string, unknown> = {}) => doc.text(t.normalize('NFC'), x, y, { ...o, lineBreak: false });
  const fill = (x: number, y: number, w: number, h: number, c: string) => doc.rect(x, y, w, h).fill(c);
  const box = (x: number, y: number, w: number, h: number) => doc.rect(x, y, w, h).lineWidth(0.5).stroke(BORDER);

  let y = M;
  const logo = resolveLogo(settings?.logo_url);
  if (logo) {
    try { doc.image(logo, M, y, { width: 200, height: 80 }); } catch { /* logo illisible */ }
  } else {
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BROWN); txt(tpl.legal.name || '', M, y + 20);
  }
  doc.font('Helvetica-BoldOblique').fontSize(22).fillColor(BROWN);
  txt('BON DE LIVRAISON', M, y + 10, { align: 'right', width: CW });
  y += 92;

  // Références
  const cellH = 24, cw = CW / 4;
  const cell = (x: number, label: string, value: string) => {
    fill(x, y, cw, cellH, BEIGE); box(x, y, cw, cellH);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(BROWN); txt(label, x + 5, y + 8, { width: cw - 10 });
    box(x + cw, y, cw, cellH);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK); txt(value, x + cw + 5, y + 7, { width: cw - 10 });
  };
  cell(M, 'N° BON DE LIVRAISON', note.number);
  cell(M + cw * 2, 'DATE DE LIVRAISON', fmtDate(note.delivery_date));
  y += cellH;
  cell(M, 'COMMANDE', note.order_number || '—');
  cell(M + cw * 2, 'FACTURE', note.invoice_number || 'À facturer');
  y += cellH + 12;

  // Client
  const lines: string[] = [note.customer_name || 'Client'];
  if (note.customer_address) lines.push(String(note.customer_address));
  if (note.customer_city) lines.push(String(note.customer_city));
  if (note.customer_phone) lines.push(`Tél : ${note.customer_phone}`);
  const ids = [note.customer_ice ? `ICE : ${note.customer_ice}` : '', note.customer_if ? `IF : ${note.customer_if}` : ''].filter(Boolean).join('   ');
  if (ids) lines.push(ids);
  const bw = CW / 2 + 20, bx = PW - M - bw, bh = 20 + lines.length * 13 + 8;
  fill(bx, y, bw, bh, BROWN);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE); txt('LIVRÉ À', bx + 8, y + 6);
  let ly = y + 20;
  lines.forEach((l, i) => { doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 10 : 8).fillColor(WHITE); txt(l, bx + 8, ly, { width: bw - 16 }); ly += 13; });
  y += bh + 12;

  // Lignes
  const cols = [CW * 0.46, CW * 0.12, CW * 0.14, CW * 0.1, CW * 0.18];
  const heads = ['DÉSIGNATION', 'QTÉ LIVRÉE', 'P.U. HT', 'TVA', 'MONTANT HT'];
  let x = M;
  heads.forEach((h, i) => { fill(x, y, cols[i], 24, BROWN); doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE); txt(h, x + 5, y + 8, { width: cols[i] - 10, align: i === 0 ? 'left' : 'right' }); x += cols[i]; });
  y += 24;
  const items = (note.items ?? []) as Record<string, any>[];
  let ht = 0, tva = 0;
  items.forEach((it, r) => {
    if (y > PH - 230) { doc.addPage(); y = M; }
    const sub = Number(it.subtotal), rate = it.tva_rate != null ? Number(it.tva_rate) : null;
    ht += sub; tva += rate ? Math.round(sub * rate) / 100 : 0;
    const vals = [String(it.description || it.product_name || ''), q(Number(it.quantity)), n(Number(it.unit_price)), rate != null ? `${q(rate)} %` : '—', n(sub)];
    x = M;
    vals.forEach((v, i) => {
      fill(x, y, cols[i], 20, r % 2 ? WHITE : CREAM); box(x, y, cols[i], 20);
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(TEXT_DARK);
      txt(v, x + 5, y + 6, { width: cols[i] - 10, align: i === 0 ? 'left' : 'right' });
      x += cols[i];
    });
    y += 20;
  });
  y += 8;

  // Totaux
  const tw = CW * 0.4, tx = PW - M - tw;
  [['TOTAL HT', n(ht)], ['TVA', n(tva)], ['TOTAL TTC', n(ht + tva)]].forEach(([l, v], i) => {
    fill(tx, y, tw / 2, 20, i === 2 ? BROWN : BEIGE); box(tx, y, tw, 20);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(i === 2 ? WHITE : BROWN); txt(l, tx + 6, y + 6);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK); txt(`${v} DH`, tx + tw / 2, y + 6, { width: tw / 2 - 6, align: 'right' });
    y += 20;
  });
  y += 12;
  if (note.notes) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED);
    doc.text(String(note.notes).normalize('NFC'), M, y, { width: CW }); y = doc.y + 8;
  }

  // Signatures : livreur et réceptionnaire (nom, date, signature/cachet)
  const sw = CW / 2 - 10, sh = 80;
  const sign = (sx: number, title: string, name?: string, date?: string) => {
    fill(sx, y, sw, 18, BEIGE); box(sx, y, sw, 18 + sh);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BROWN); txt(title, sx + 6, y + 5);
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
    txt(`Nom : ${name || ''}`, sx + 6, y + 26, { width: sw - 12 });
    txt(`Date : ${date || ''}`, sx + 6, y + 40, { width: sw - 12 });
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(TEXT_MUTED); txt('Signature et cachet', sx + 6, y + sh, { width: sw - 12 });
  };
  sign(M, 'LIVRÉ PAR', note.created_by_name || '', fmtDate(note.delivery_date));
  sign(M + sw + 20, 'REÇU PAR (CLIENT)', note.received_by_name || '', note.received_at ? fmtDate(note.received_at) : '');
  y += 18 + sh + 10;
  doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED);
  txt('Marchandise reçue conforme en quantité et en qualité, sauf réserves écrites ci-dessus.', M, y, { width: CW });

  // Pied légal
  const footerY = PH - (tpl.footerNote ? 62 : 52);
  doc.moveTo(M, footerY).lineTo(PW - M, footerY).lineWidth(0.5).stroke(BROWN);
  let fy = footerY + 5;
  doc.font('Helvetica').fontSize(6).fillColor(TEXT_MUTED);
  if (tpl.footerNote) { txt(tpl.footerNote, M, fy, { width: CW, align: 'center' }); fy += 9; }
  for (const line of legalFooterLines(tpl)) { txt(line, M, fy, { width: CW, align: 'center' }); fy += 9; }

  doc.end();
  return new Promise<Buffer>((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });
}
