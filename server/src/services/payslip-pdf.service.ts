import PDFDocument from 'pdfkit';

/**
 * Bulletin de paie mensuel (PDF, A4 portrait).
 *
 * Mentions du Code du travail marocain (art. 370) : employeur et son n°
 * d'affiliation CNSS, salarie (nom, CIN, n° CNSS, emploi, date d'embauche),
 * periode, jours payes, salaire de base, primes et indemnites, brut,
 * retenues (CNSS, AMO, CIMR, IR) et net a payer. On y ajoute les bases de
 * calcul, les charges patronales et les cumuls annuels, comme un logiciel
 * de paie.
 */

export interface PayslipLineRow {
  label: string;
  base?: string;
  rate?: string;
  gain?: number;
  retenue?: number;
  note?: string;
}

export interface PayslipPdfData {
  company: { name: string; address?: string; rc?: string; if?: string; ice?: string; cnss?: string | null };
  logo?: string | Buffer | null;
  periodLabel: string;
  periodRange: string;
  employee: {
    name: string; cin?: string | null; cnss?: string | null; role: string; hireDate?: string | null;
    seniorityYears?: number | null; dependents: number; contract?: string | null; declared: boolean;
  };
  workedDays: number;
  baseDays: number;
  absentDays: number;
  paidLeaveDays?: number;
  holidayPaidDays?: number;
  lines: PayslipLineRow[];
  grossSalary: number;
  totalRetenues: number;
  netSalary: number;
  advanceDeduction: number;
  /** Acomptes hebdo / quinzaine deja verses sur le mois (mig 327). */
  acomptes?: number;
  bases: { brutImposable: number; fraisPro: number; netImposable: number; irGross: number; familyDeduction: number };
  employer: Array<{ label: string; amount: number }>;
  totalEmployer: number;
  cumuls: { months: number; gross: number; brutImposable: number; netImposable: number; ir: number; cnss: number; amo: number; net: number };
  payment?: { method: string; date: string } | null;
  generatedAt: string;
}

const BROWN = '#8E4A1F';
const BEIGE = '#F5F0E8';
const TEXT_DARK = '#3B2F2F';
const TEXT_MUTED = '#7A7168';
const BORDER = '#D6CFC4';
const GREEN = '#1E7B3A';

// Helvetica (PDFKit) n'a pas les espaces fines U+202F / U+00A0 de fr-FR.
const money = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');

export async function generatePayslipPdf(d: PayslipPdfData): Promise<Buffer> {
  const M = 36;
  const PW = 595.28;
  const CW = PW - 2 * M;
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 20, left: M, right: M }, info: { Title: `Bulletin de paie ${d.employee.name} ${d.periodLabel}`, Author: d.company.name } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const t = (s: string, x: number, y: number, o: Record<string, unknown> = {}) => doc.text(s, x, y, { lineBreak: false, ...o });

  // ─── En-tete : employeur + titre ───
  let y = M;
  let leftX = M;
  if (d.logo) {
    try { doc.image(d.logo, M, y, { fit: [90, 50] }); leftX = M + 100; } catch { /* logo illisible : ignore */ }
  }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT_DARK);
  t(d.company.name, leftX, y);
  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED);
  const ids = [
    d.company.address,
    [d.company.rc && `RC ${d.company.rc}`, d.company.if && `IF ${d.company.if}`, d.company.ice && `ICE ${d.company.ice}`].filter(Boolean).join('  ·  '),
    `N° affiliation CNSS : ${d.company.cnss || 'non renseigné'}`,
  ].filter(Boolean) as string[];
  ids.forEach((s, i) => t(s, leftX, y + 14 + i * 10));

  doc.font('Helvetica-Bold').fontSize(15).fillColor(BROWN);
  t('BULLETIN DE PAIE', M, y, { width: CW, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(TEXT_DARK);
  t(d.periodLabel, M, y + 20, { width: CW, align: 'right' });
  doc.fontSize(7.5).fillColor(TEXT_MUTED);
  t(d.periodRange, M, y + 32, { width: CW, align: 'right' });
  y += 62;

  // ─── Salarie ───
  doc.rect(M, y, CW, 58).fill(BEIGE);
  doc.rect(M, y, CW, 58).lineWidth(0.5).stroke(BORDER);
  const cell = (label: string, value: string, x: number, yy: number) => {
    doc.font('Helvetica').fontSize(6.5).fillColor(TEXT_MUTED); t(label.toUpperCase(), x, yy);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT_DARK); t(value || '—', x, yy + 8, { width: CW / 3 - 10, ellipsis: true });
  };
  const c1 = M + 8, c2 = M + CW / 3 + 4, c3 = M + (2 * CW) / 3;
  cell('Salarié', d.employee.name, c1, y + 6);
  cell('Emploi', d.employee.role, c2, y + 6);
  cell('Date d\'embauche', d.employee.hireDate ? `${d.employee.hireDate}${d.employee.seniorityYears != null ? `  (${d.employee.seniorityYears} an${d.employee.seniorityYears > 1 ? 's' : ''})` : ''}` : '', c3, y + 6);
  cell('CIN', d.employee.cin || '', c1, y + 31);
  cell('N° CNSS', d.employee.declared ? (d.employee.cnss || 'à renseigner') : 'Non déclaré', c2, y + 31);
  cell('Pers. à charge · Contrat', `${d.employee.dependents} · ${d.employee.contract || '—'}`, c3, y + 31);
  y += 66;

  doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
  t(`Jours payés : ${d.workedDays} / ${d.baseDays}${d.paidLeaveDays || d.holidayPaidDays ? ` (dont ${[d.paidLeaveDays ? `${d.paidLeaveDays} j de congé payé` : '', d.holidayPaidDays ? `${d.holidayPaidDays} j férié${d.holidayPaidDays > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')})` : ''}${d.absentDays > 0 ? `   ·   Absences non couvertes : ${d.absentDays} j` : ''}`, M, y);
  y += 14;

  // ─── Tableau des rubriques ───
  const cols = [
    { k: 'label', w: CW * 0.40, title: 'Désignation', align: 'left' as const },
    { k: 'base', w: CW * 0.15, title: 'Base / Nombre', align: 'right' as const },
    { k: 'rate', w: CW * 0.11, title: 'Taux', align: 'right' as const },
    { k: 'gain', w: CW * 0.17, title: 'Gains', align: 'right' as const },
    { k: 'retenue', w: CW * 0.17, title: 'Retenues', align: 'right' as const },
  ];
  const drawRow = (vals: Record<string, string>, opts: { header?: boolean; bold?: boolean; fill?: string } = {}) => {
    const h = 15;
    if (opts.fill) doc.rect(M, y, CW, h).fill(opts.fill);
    doc.moveTo(M, y + h).lineTo(M + CW, y + h).lineWidth(0.4).stroke(BORDER);
    let x = M;
    doc.font(opts.header || opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.header ? 7 : 8)
      .fillColor(opts.header ? '#FFFFFF' : TEXT_DARK);
    for (const c of cols) {
      t(vals[c.k] ?? '', x + 4, y + 4, { width: c.w - 8, align: c.align, ellipsis: true });
      x += c.w;
    }
    y += h;
  };
  drawRow(Object.fromEntries(cols.map(c => [c.k, c.title.toUpperCase()])), { header: true, fill: BROWN });
  for (const l of d.lines) {
    drawRow({
      label: l.note ? `${l.label} (${l.note})` : l.label,
      base: l.base ?? '', rate: l.rate ?? '',
      gain: l.gain ? money(l.gain) : '', retenue: l.retenue ? money(l.retenue) : '',
    });
  }
  drawRow({ label: 'TOTAUX', gain: money(d.grossSalary), retenue: money(d.totalRetenues) }, { bold: true, fill: BEIGE });
  y += 8;

  // ─── Net ───
  doc.rect(M, y, CW, 26).fill(GREEN);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF');
  t('NET À PAYER', M + 10, y + 8);
  t(`${money(d.netSalary)} DH`, M, y + 8, { width: CW - 10, align: 'right' });
  y += 30;
  const acomptes = d.acomptes ?? 0;
  if (acomptes > 0 || d.advanceDeduction > 0) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
    const parts = [
      acomptes > 0 ? `Acomptes versés : ${money(acomptes)} DH` : null,
      d.advanceDeduction > 0 ? `Retenue sur avance(s) : ${money(d.advanceDeduction)} DH` : null,
      `${acomptes > 0 ? 'Reste versé' : 'Net versé'} : ${money(d.netSalary - acomptes - d.advanceDeduction)} DH`,
    ].filter(Boolean);
    t(parts.join('   ·   '), M, y, { width: CW, align: 'right' });
    y += 12;
  }
  if (d.payment) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED);
    t(`Payé le ${d.payment.date} par ${d.payment.method}`, M, y, { width: CW, align: 'right' });
    y += 12;
  }
  y += 6;

  // ─── Bases fiscales + charges patronales (2 colonnes) ───
  const half = (CW - 12) / 2;
  const box = (x: number, title: string, rows: Array<[string, string]>, total?: [string, string]) => {
    let yy = y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BROWN); t(title.toUpperCase(), x, yy); yy += 12;
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
    for (const [a, b] of rows) { t(a, x, yy); t(b, x, yy, { width: half, align: 'right' }); yy += 11; }
    if (total) {
      doc.moveTo(x, yy).lineTo(x + half, yy).lineWidth(0.4).stroke(BORDER); yy += 3;
      doc.font('Helvetica-Bold'); t(total[0], x, yy); t(total[1], x, yy, { width: half, align: 'right' }); yy += 11;
    }
    return yy;
  };
  const yA = box(M, 'Bases de calcul de l\'IR', [
    ['Salaire brut imposable', money(d.bases.brutImposable)],
    ['Frais professionnels', `- ${money(d.bases.fraisPro)}`],
    ['Revenu net imposable', money(d.bases.netImposable)],
    ['IR brut (barème)', money(d.bases.irGross)],
    ['Déduction charges de famille', `- ${money(d.bases.familyDeduction)}`],
  ]);
  const yB = box(M + half + 12, 'Charges patronales', d.employer.map(e => [e.label, money(e.amount)] as [string, string]), ['Total', money(d.totalEmployer)]);
  y = Math.max(yA, yB) + 10;

  // ─── Cumuls annuels ───
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BROWN);
  t(`CUMULS DE L'ANNÉE (${d.cumuls.months} bulletin${d.cumuls.months > 1 ? 's' : ''})`, M, y); y += 12;
  const cum: Array<[string, number]> = [
    ['Brut', d.cumuls.gross], ['Brut imposable', d.cumuls.brutImposable], ['Net imposable', d.cumuls.netImposable],
    ['CNSS', d.cumuls.cnss], ['AMO', d.cumuls.amo], ['IR', d.cumuls.ir], ['Net à payer', d.cumuls.net],
  ];
  const cw = CW / cum.length;
  cum.forEach(([label, v], i) => {
    doc.rect(M + i * cw, y, cw, 26).lineWidth(0.4).stroke(BORDER);
    doc.font('Helvetica').fontSize(6.5).fillColor(TEXT_MUTED); t(label.toUpperCase(), M + i * cw + 3, y + 4, { width: cw - 6, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_DARK); t(money(v), M + i * cw + 3, y + 14, { width: cw - 6, align: 'center' });
  });
  y += 36;

  // ─── Pied ───
  doc.font('Helvetica-Oblique').fontSize(7).fillColor(TEXT_MUTED);
  t('Conservez ce bulletin sans limitation de durée. Il ne vaut pas reçu pour solde de tout compte.', M, y, { width: CW, align: 'center' });
  t(`Édité le ${d.generatedAt}`, M, y + 10, { width: CW, align: 'center' });

  doc.end();
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
}
