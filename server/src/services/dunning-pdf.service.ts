import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadDocumentTemplate, legalFooterLines } from '../utils/document-template.js';

/**
 * Lettre de relance client (mig 366) : en-tête société, bloc client, objet, texte du
 * niveau (champs déjà remplacés), tableau des pièces échues et récapitulatif.
 */
export type DunningLetter = {
  number: string; date: string; levelLabel: string; subject: string; body: string;
  customerName: string; customerAddress?: string | null; customerIce?: string | null;
  items: { number: string; kind: 'invoice' | 'ticket'; docDate: string | null; dueDate: string; daysLate: number; remaining: number }[];
  amountDue: number; fee: number; interest: number; logo?: string | null;
};

const BROWN = '#8E4A1F';
const BEIGE = '#F5F0E8';
const TEXT = '#3B2F2F';
const MUTED = '#7A7168';
const BORDER = '#D6CFC4';

function defaultLogo(): string | null {
  for (const c of [resolve(process.cwd(), 'server', 'assets', 'company-logo.png'), resolve(process.cwd(), 'assets', 'company-logo.png'),
    resolve(process.cwd(), '..', 'client', 'public', 'images', 'logo-horizontal.png'), resolve(process.cwd(), 'client', 'public', 'images', 'logo-horizontal.png')]) {
    if (existsSync(c)) return c;
  }
  return null;
}
const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const fr = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '');

export async function generateDunningPdf(d: DunningLetter): Promise<Buffer> {
  const tpl = await loadDocumentTemplate('invoice');
  const M = 50; const PW = 595.28; const PH = 841.89; const CW = PW - M * 2;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 0, left: M, right: M }, info: { Title: `${d.levelLabel} ${d.number}`, Author: tpl.legal.name } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  let y = M;
  const logo = d.logo?.startsWith('data:') ? Buffer.from(d.logo.slice(d.logo.indexOf(',') + 1), 'base64') : defaultLogo();
  if (logo) { try { doc.image(logo, M, y, { width: 170, height: 68 }); } catch { /* logo illisible */ } }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT).text(tpl.legal.name || '', M, y, { width: CW, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text([tpl.legal.address, tpl.legal.city].filter(Boolean).join(', '), { width: CW, align: 'right' })
    .text([tpl.legal.phone, tpl.legal.email].filter(Boolean).join(' · '), { width: CW, align: 'right' });
  y += 90;

  // Bloc client à droite
  const bx = M + CW / 2 + 20; const bw = CW / 2 - 20;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(d.customerName, bx, y, { width: bw });
  doc.font('Helvetica').fontSize(9).fillColor(TEXT);
  if (d.customerAddress) doc.text(d.customerAddress, { width: bw });
  if (d.customerIce) doc.text(`ICE : ${d.customerIce}`, { width: bw });
  y = Math.max(doc.y, y + 40) + 16;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${tpl.legal.city ? `${tpl.legal.city}, le` : 'Le'} ${fr(d.date)}`, M, y, { width: CW, align: 'right' });
  y = doc.y + 14;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BROWN).text(`${d.levelLabel.toUpperCase()} · N° ${d.number}`, M, y);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEXT).text(`Objet : ${d.subject}`, M, doc.y + 4, { width: CW });
  y = doc.y + 12;

  // Corps : le tableau des pièces remplace la liste texte quand elle est présente.
  const body = d.body.split('\n').filter(l => !/^- (Facture|Ticket) /.test(l)).join('\n').replace(/\n{3,}/g, '\n\n');
  doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(body, M, y, { width: CW, lineGap: 2 });
  y = doc.y + 12;

  // Tableau des pièces
  const cols = [CW * 0.26, CW * 0.17, CW * 0.17, CW * 0.14, CW * 0.26];
  const heads = ['PIÈCE', 'DATE', 'ÉCHÉANCE', 'RETARD', 'RESTE DÛ (DH)'];
  let x = M;
  doc.rect(M, y, CW, 18).fill(BROWN);
  heads.forEach((h, i) => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF').text(h, x + 5, y + 5, { width: cols[i] - 10, align: i >= 3 ? 'right' : 'left', lineBreak: false }); x += cols[i]; });
  y += 18;
  d.items.forEach((it, r) => {
    if (y > PH - 170) return;
    x = M;
    doc.rect(M, y, CW, 16).fill(r % 2 ? '#FFFFFF' : BEIGE);
    const cells = [`${it.kind === 'invoice' ? 'Facture' : 'Ticket'} ${it.number}`, fr(it.docDate), fr(it.dueDate), `${it.daysLate} j`, n(it.remaining)];
    cells.forEach((c, i) => { doc.font('Helvetica').fontSize(8.5).fillColor(TEXT).text(c, x + 5, y + 4, { width: cols[i] - 10, align: i >= 3 ? 'right' : 'left', lineBreak: false }); x += cols[i]; });
    y += 16;
  });
  doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).stroke(BORDER);
  y += 8;
  const tot = (label: string, v: number, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9).fillColor(TEXT)
      .text(label, M + CW * 0.45, y, { width: CW * 0.3, align: 'right', lineBreak: false })
      .text(`${n(v)} DH`, M + CW * 0.75, y, { width: CW * 0.25, align: 'right', lineBreak: false });
    y += bold ? 16 : 13;
  };
  tot('Montant échu', d.amountDue);
  if (d.fee > 0) tot('Frais de relance', d.fee);
  if (d.interest > 0) tot('Pénalités de retard', d.interest);
  if (d.fee > 0 || d.interest > 0) tot('Total exigible', d.amountDue + d.fee + d.interest, true);

  if (tpl.bank?.rib) {
    y += 6;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`Règlement par virement : ${tpl.bank.bankName ?? ''} · RIB ${tpl.bank.rib}`, M, y, { width: CW });
  }

  const foot = legalFooterLines(tpl);
  const fy = PH - 50;
  doc.moveTo(M, fy).lineTo(PW - M, fy).lineWidth(0.5).stroke(BROWN);
  doc.font('Helvetica').fontSize(6.5).fillColor(MUTED);
  foot.forEach((l, i) => doc.text(l, M, fy + 6 + i * 9, { width: CW, align: 'center', lineBreak: false }));

  return new Promise((resolveP, reject) => {
    doc.on('end', () => resolveP(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
