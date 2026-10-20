import PDFDocument from 'pdfkit';

/**
 * Documents RH en PDF.
 * Pieces de depart du salarie (lot 6) :
 *  - recu pour solde de tout compte (Code du travail art. 73-76) : detail des
 *    sommes, mention de la faculte de denonciation sous 60 jours, signatures ;
 *  - certificat de travail (art. 72) : dates d'entree et de sortie, emplois
 *    occupes.
 * A la demande, salarie en poste : attestation de travail, attestation de
 * salaire (derniers mois de paie). Paie : ordre de virement groupe.
 */

export interface Company { name: string; address?: string; rc?: string; if?: string; ice?: string; cnss?: string | null }
export interface EmployeeIdentity { name: string; cin?: string | null; cnss?: string | null }

const BROWN = '#8E4A1F';
const TEXT = '#3B2F2F';
const MUTED = '#7A7168';
const BORDER = '#D6CFC4';
const money = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');

// ─── Montant en lettres (dirhams et centimes) ─────────────────────────────
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
  'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n: number): string {
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const t = Math.floor(n / 10), u = n % 10;
    return TENS[t] + (u === 0 ? '' : u === 1 ? '-et-un' : `-${UNITS[u]}`);
  }
  if (n < 80) return n === 71 ? 'soixante-et-onze' : `soixante-${UNITS[n - 60]}`;
  const u = n - 80;
  return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITS[u]}`;
}
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const head = h === 0 ? '' : h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
  return [head, r ? below100(r) : ''].filter(Boolean).join(' ') || 'zéro';
}
export function numberToFrench(n: number): string {
  n = Math.floor(n);
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000), thousands = Math.floor((n % 1_000_000) / 1000), rest = n % 1000;
  if (millions) parts.push(`${below1000(millions)} million${millions > 1 ? 's' : ''}`);
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${below1000(thousands).replace(/cents$/, 'cent')} mille`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}
export function amountInWords(v: number): string {
  const dh = Math.floor(v + 1e-9);
  const cts = Math.round((v - dh) * 100);
  return `${numberToFrench(dh)} dirham${dh > 1 ? 's' : ''}${cts ? ` et ${numberToFrench(cts)} centime${cts > 1 ? 's' : ''}` : ''}`;
}

function header(doc: PDFKit.PDFDocument, company: Company, title: string, M: number, CW: number) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT).text(company.name, M, M);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  const ids = [company.address, [company.rc && `RC ${company.rc}`, company.if && `IF ${company.if}`, company.ice && `ICE ${company.ice}`].filter(Boolean).join('  ·  '),
    company.cnss ? `N° affiliation CNSS : ${company.cnss}` : ''].filter(Boolean) as string[];
  ids.forEach((s, i) => doc.text(s, M, M + 15 + i * 11));
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BROWN).text(title, M, M + 70, { width: CW, align: 'center' });
  doc.moveTo(M, M + 95).lineTo(M + CW, M + 95).lineWidth(0.5).stroke(BORDER);
  return M + 110;
}

function finish(doc: PDFKit.PDFDocument, chunks: Buffer[]): Promise<Buffer> {
  doc.end();
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

export interface ReceiptData {
  company: Company;
  employee: EmployeeIdentity;
  exitDate: string;            // dd/mm/yyyy
  reasonLabel: string;
  lines: Array<{ label: string; detail?: string; gain?: number; retenue?: number }>;
  netAmount: number;
  place: string;
  issuedOn: string;            // dd/mm/yyyy
}

/** Recu pour solde de tout compte. */
export async function generateSettlementReceiptPdf(d: ReceiptData): Promise<Buffer> {
  const M = 50, CW = 595.28 - 2 * M;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 40, left: M, right: M }, info: { Title: `Reçu pour solde de tout compte ${d.employee.name}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  let y = header(doc, d.company, 'REÇU POUR SOLDE DE TOUT COMPTE', M, CW);

  doc.font('Helvetica').fontSize(10).fillColor(TEXT);
  const who = `Je soussigné(e) ${d.employee.name}${d.employee.cin ? `, CIN ${d.employee.cin}` : ''}${d.employee.cnss ? `, immatriculé(e) à la CNSS sous le n° ${d.employee.cnss}` : ''}, `
    + `reconnais avoir reçu de ${d.company.name} la somme nette de ${money(d.netAmount).replace(/ /g, '\u00A0')}\u00A0DH (${amountInWords(d.netAmount)}), `
    + `pour solde de tout compte, en paiement des salaires, accessoires du salaire et indemnités qui me sont dus au titre de l'exécution `
    + `et de la cessation de mon contrat de travail (${d.reasonLabel.toLowerCase()}, sortie le ${d.exitDate}).`;
  doc.text(who, M, y, { width: CW, align: 'justify', lineGap: 3 });
  y = doc.y + 16;

  // Detail des sommes
  const cols = [CW * 0.5, CW * 0.2, CW * 0.15, CW * 0.15];
  const row = (cells: string[], bold = false, fill?: string) => {
    if (fill) doc.rect(M, y - 3, CW, 16).fill(fill);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(TEXT);
    let x = M;
    cells.forEach((c, i) => { doc.text(c, x + 4, y, { width: cols[i] - 8, align: i >= 2 ? 'right' : 'left', lineBreak: false, ellipsis: true }); x += cols[i]; });
    y += 16;
    doc.moveTo(M, y - 3).lineTo(M + CW, y - 3).lineWidth(0.3).stroke(BORDER);
  };
  row(['Élément', 'Détail', 'Gains', 'Retenues'], true, '#F5F0E8');
  for (const l of d.lines) row([l.label, l.detail ?? '', l.gain ? money(l.gain) : '', l.retenue ? money(l.retenue) : '']);
  row(['NET PERÇU', '', money(d.netAmount), ''], true, '#F5F0E8');
  y += 14;

  doc.font('Helvetica').fontSize(9).fillColor(TEXT).text(
    'Le présent reçu, établi en deux exemplaires dont l\'un m\'est remis, peut être dénoncé dans les soixante jours '
    + 'suivant sa signature (Code du travail, art. 74). Passé ce délai, il a un effet libératoire pour les sommes qui y sont détaillées.',
    M, y, { width: CW, align: 'justify', lineGap: 2 });
  y = doc.y + 24;
  doc.text(`Fait à ${d.place}, le ${d.issuedOn}`, M, y);
  y += 30;
  doc.font('Helvetica-Bold').text('L\'employeur', M, y);
  doc.text('Le salarié', M + CW / 2, y);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text('Signature précédée de la mention manuscrite « Pour solde de tout compte »', M + CW / 2, y + 14, { width: CW / 2 });
  return finish(doc, chunks);
}

export interface CertificateData {
  company: Company;
  employee: EmployeeIdentity;
  hireDate: string;            // dd/mm/yyyy
  exitDate: string;
  positions: Array<{ title: string; from: string; to: string }>;
  place: string;
  issuedOn: string;
}

/** Certificat de travail (art. 72). */
export async function generateWorkCertificatePdf(d: CertificateData): Promise<Buffer> {
  const M = 50, CW = 595.28 - 2 * M;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 40, left: M, right: M }, info: { Title: `Certificat de travail ${d.employee.name}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  let y = header(doc, d.company, 'CERTIFICAT DE TRAVAIL', M, CW);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.text(
    `Nous soussignés, ${d.company.name}, certifions que ${d.employee.name}`
    + `${d.employee.cin ? `, titulaire de la CIN n° ${d.employee.cin}` : ''}`
    + `${d.employee.cnss ? `, immatriculé(e) à la CNSS sous le n° ${d.employee.cnss}` : ''}, `
    + `a été employé(e) au sein de notre établissement du ${d.hireDate} au ${d.exitDate}.`,
    M, y, { width: CW, align: 'justify', lineGap: 4 });
  y = doc.y + 14;
  if (d.positions.length) {
    doc.text('Emploi(s) occupé(s) :', M, y);
    y = doc.y + 4;
    for (const p of d.positions) {
      doc.text(`•  ${p.title}, du ${p.from} au ${p.to}`, M + 14, y, { width: CW - 14 });
      y = doc.y + 2;
    }
    y += 10;
  }
  doc.text(`L'intéressé(e) quitte notre établissement libre de tout engagement.`, M, y, { width: CW });
  y = doc.y + 10;
  doc.text('Le présent certificat lui est délivré pour servir et valoir ce que de droit.', M, y, { width: CW });
  y = doc.y + 30;
  doc.text(`Fait à ${d.place}, le ${d.issuedOn}`, M, y);
  y += 30;
  doc.font('Helvetica-Bold').text('Pour l\'employeur', M + CW / 2, y);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Signature et cachet', M + CW / 2, y + 14);
  return finish(doc, chunks);
}

// ─── Documents a la demande (salarie actif) ───────────────────────────────

/** Tableau simple (en-tete + lignes + total optionnel) ; renvoie le y final. */
function table(doc: PDFKit.PDFDocument, M: number, CW: number, y0: number, widths: number[], head: string[], rows: string[][],
  opts: { alignRight?: number[]; total?: string[] } = {}): number {
  let y = y0;
  const right = new Set(opts.alignRight ?? []);
  const cols = widths.map(w => w * CW);
  const line = (cells: string[], bold: boolean, fill?: string) => {
    if (y > 760) { doc.addPage(); y = M; }
    if (fill) doc.rect(M, y - 3, CW, 16).fill(fill);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(TEXT);
    let x = M;
    cells.forEach((c, i) => { doc.text(c, x + 4, y, { width: cols[i] - 8, align: right.has(i) ? 'right' : 'left', lineBreak: false, ellipsis: true }); x += cols[i]; });
    y += 16;
    doc.moveTo(M, y - 3).lineTo(M + CW, y - 3).lineWidth(0.3).stroke(BORDER);
  };
  line(head, true, '#F5F0E8');
  for (const r of rows) line(r, false);
  if (opts.total) line(opts.total, true, '#F5F0E8');
  return y;
}

function signature(doc: PDFKit.PDFDocument, M: number, CW: number, y: number, place: string, issuedOn: string) {
  doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(`Fait à ${place}, le ${issuedOn}`, M, y);
  y += 30;
  doc.font('Helvetica-Bold').text('Pour l\'employeur', M + CW / 2, y);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Signature et cachet', M + CW / 2, y + 14);
}

export interface EmploymentAttestationData {
  company: Company;
  employee: EmployeeIdentity;
  hireDate: string;            // dd/mm/yyyy
  jobTitle: string;
  contractLabel: string | null; // « contrat à durée indéterminée »…
  place: string;
  issuedOn: string;
}

/** Attestation de travail (salarie en poste), delivree a sa demande. */
export async function generateEmploymentAttestationPdf(d: EmploymentAttestationData): Promise<Buffer> {
  const M = 50, CW = 595.28 - 2 * M;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 40, left: M, right: M }, info: { Title: `Attestation de travail ${d.employee.name}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  let y = header(doc, d.company, 'ATTESTATION DE TRAVAIL', M, CW);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  doc.text(
    `Nous soussignés, ${d.company.name}, attestons que ${d.employee.name}`
    + `${d.employee.cin ? `, titulaire de la CIN n° ${d.employee.cin}` : ''}`
    + `${d.employee.cnss ? `, immatriculé(e) à la CNSS sous le n° ${d.employee.cnss}` : ''}, `
    + `est employé(e) au sein de notre établissement depuis le ${d.hireDate} en qualité de ${d.jobTitle}`
    + `${d.contractLabel ? `, dans le cadre d'un ${d.contractLabel}` : ''}, et fait toujours partie de notre personnel à ce jour.`,
    M, y, { width: CW, align: 'justify', lineGap: 4 });
  y = doc.y + 14;
  doc.text('La présente attestation est délivrée à l\'intéressé(e), sur sa demande, pour servir et valoir ce que de droit.', M, y, { width: CW, align: 'justify' });
  signature(doc, M, CW, doc.y + 30, d.place, d.issuedOn);
  return finish(doc, chunks);
}

export interface SalaryAttestationData extends EmploymentAttestationData {
  monthlySalary: number | null;  // salaire de base contractuel
  months: Array<{ label: string; gross: number; net: number }>;
}

/**
 * Attestation de salaire : salaire de base contractuel et remuneration des
 * derniers mois (brut, net verse), moyenne mensuelle.
 */
export async function generateSalaryAttestationPdf(d: SalaryAttestationData): Promise<Buffer> {
  const M = 50, CW = 595.28 - 2 * M;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 40, left: M, right: M }, info: { Title: `Attestation de salaire ${d.employee.name}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  let y = header(doc, d.company, 'ATTESTATION DE SALAIRE', M, CW);
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT);
  const n = d.months.length;
  const avgGross = n ? d.months.reduce((s, m) => s + m.gross, 0) / n : 0;
  const avgNet = n ? d.months.reduce((s, m) => s + m.net, 0) / n : 0;
  doc.text(
    `Nous soussignés, ${d.company.name}, attestons que ${d.employee.name}`
    + `${d.employee.cin ? `, titulaire de la CIN n° ${d.employee.cin}` : ''}`
    + `${d.employee.cnss ? `, immatriculé(e) à la CNSS sous le n° ${d.employee.cnss}` : ''}, `
    + `est employé(e) au sein de notre établissement depuis le ${d.hireDate} en qualité de ${d.jobTitle}`
    + `${d.contractLabel ? ` (${d.contractLabel})` : ''}`
    + `${d.monthlySalary ? `, et perçoit un salaire mensuel de base brut de ${money(d.monthlySalary).replace(/ /g, ' ')} DH (${amountInWords(d.monthlySalary)})` : ''}.`,
    M, y, { width: CW, align: 'justify', lineGap: 4 });
  y = doc.y + 14;
  if (n) {
    doc.text(`Rémunération ${n > 1 ? `des ${n} derniers mois` : 'du dernier mois'} de paie :`, M, y);
    y = doc.y + 8;
    y = table(doc, M, CW, y, [0.5, 0.25, 0.25], ['Mois', 'Salaire brut (DH)', 'Net versé (DH)'],
      d.months.map(m => [m.label, money(m.gross), money(m.net)]),
      { alignRight: [1, 2], total: [n > 1 ? `Moyenne mensuelle (${n} mois)` : 'Total', money(avgGross), money(avgNet)] });
    y += 10;
  }
  doc.font('Helvetica').fontSize(10.5).fillColor(TEXT)
    .text('La présente attestation est délivrée à l\'intéressé(e), sur sa demande, pour servir et valoir ce que de droit.', M, y, { width: CW, align: 'justify' });
  signature(doc, M, CW, doc.y + 30, d.place, d.issuedOn);
  return finish(doc, chunks);
}

export interface TransferOrderData {
  company: Company;
  employerRib: string;          // formate
  employerBank: string | null;
  periodLabel: string;          // « Septembre 2026 »
  lines: Array<{ name: string; rib: string; bank: string | null; amount: number }>;
  total: number;
  place: string;
  issuedOn: string;
}

/** Ordre de virement groupe des salaires (lettre au banquier + liste). */
export async function generateTransferOrderPdf(d: TransferOrderData): Promise<Buffer> {
  const M = 50, CW = 595.28 - 2 * M;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 40, left: M, right: M }, info: { Title: `Ordre de virement salaires ${d.periodLabel}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  let y = header(doc, d.company, 'ORDRE DE VIREMENT GROUPÉ', M, CW);
  doc.font('Helvetica').fontSize(10).fillColor(TEXT);
  doc.text(`À l'attention de Monsieur le Directeur${d.employerBank ? ` — ${d.employerBank}` : ''}`, M, y);
  y = doc.y + 8;
  doc.font('Helvetica-Bold').text(`Objet : virement des salaires de ${d.periodLabel}`, M, y);
  y = doc.y + 10;
  doc.font('Helvetica').text(
    `Par le débit de notre compte RIB n° ${d.employerRib}, nous vous prions de bien vouloir virer la somme totale de `
    + `${money(d.total).replace(/ /g, ' ')} DH (${amountInWords(d.total)}) en faveur des ${d.lines.length} bénéficiaire${d.lines.length > 1 ? 's' : ''} ci-dessous, `
    + `au titre des salaires de ${d.periodLabel}.`,
    M, y, { width: CW, align: 'justify', lineGap: 3 });
  y = doc.y + 12;
  y = table(doc, M, CW, y, [0.06, 0.32, 0.36, 0.08, 0.18], ['N°', 'Bénéficiaire', 'RIB', 'Banque', 'Montant (DH)'],
    d.lines.map((l, i) => [String(i + 1), l.name, l.rib, l.bank ?? '', money(l.amount)]),
    { alignRight: [4], total: ['', `${d.lines.length} virement${d.lines.length > 1 ? 's' : ''}`, '', '', money(d.total)] });
  y += 14;
  if (y > 700) { doc.addPage(); y = M; }
  doc.font('Helvetica').fontSize(10).fillColor(TEXT).text('Veuillez agréer, Monsieur le Directeur, l\'expression de nos salutations distinguées.', M, y, { width: CW });
  signature(doc, M, CW, doc.y + 24, d.place, d.issuedOn);
  return finish(doc, chunks);
}
