import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType,
  VerticalAlign, ImageRun, HeightRule, TableLayoutType,
} from 'docx';
import { readFileSync, existsSync } from 'fs';

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

// ── Ofauria brand color palette ──
const C = {
  brown:     '8E4A1F',
  beige:     'F5F0E8',
  cream:     'FDFAF4',
  white:     'FFFFFF',
  gold:      '9C7A52',
  darkGold:  'B8860B',
  textDark:  '3B2F2F',
  textMuted: '7A7168',
  textLight: 'FAF6EF',
  border:    'D6CFC4',
};

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 1, color: C.border };
const THIN_BORDERS = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: C.white };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

const FONT = 'Calibri';
const FONT_TITLE = 'Georgia';

function t(text: string, opts: {
  sz?: number; b?: boolean; color?: string; font?: string; i?: boolean; u?: boolean;
} = {}): TextRun {
  return new TextRun({
    text,
    font: opts.font || FONT,
    size: opts.sz || 20,
    bold: opts.b || false,
    italics: opts.i || false,
    color: opts.color || C.textDark,
    underline: opts.u ? {} : undefined,
  });
}

function mk(runs: TextRun[], align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT, spacing?: { before?: number; after?: number }): Paragraph {
  return new Paragraph({ alignment: align, spacing: { after: 0, line: 240, ...spacing }, children: runs });
}

function c(
  content: Paragraph[],
  opts: { w?: number; bg?: string; borders?: typeof THIN_BORDERS | typeof NO_BORDERS; span?: number; rowSpan?: number } = {}
): TableCell {
  return new TableCell({
    width: opts.w ? { size: opts.w, type: WidthType.DXA } : undefined,
    shading: opts.bg ? { fill: opts.bg } : undefined,
    borders: opts.borders ?? THIN_BORDERS,
    columnSpan: opts.span,
    rowSpan: opts.rowSpan,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: content,
  });
}

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

export async function generateInvoiceDocx(data: InvoiceData): Promise<Buffer> {
  const W = 10490; // full table width

  // ── Load logo ──
  let logoRun: ImageRun | undefined;
  if (data.logoPath && existsSync(data.logoPath)) {
    try {
      const buf = readFileSync(data.logoPath);
      logoRun = new ImageRun({ data: buf, transformation: { width: 260, height: 90 }, type: 'png' });
    } catch { /* skip */ }
  }

  // ════════════════════════════════════════════════════════════
  // HEADER — logo left-aligned in brown box
  // ════════════════════════════════════════════════════════════
  const headerChildren: Paragraph[] = [];
  if (logoRun) {
    headerChildren.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
      children: [logoRun],
    }));
  } else {
    headerChildren.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 20 },
      children: [
        t('\u00D4FAURIA', { sz: 32, b: true, color: C.brown, font: FONT_TITLE }),
      ],
    }));
    headerChildren.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
      children: [
        t('B O U L A N G E R I E  -  P \u00C2 T I S S E R I E', { sz: 14, color: C.gold, i: true }),
      ],
    }));
  }

  // ════════════════════════════════════════════════════════════
  // TITLE — "FACTURE" right-aligned, italic serif, underlined
  // ════════════════════════════════════════════════════════════
  const titleParagraph = new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 100, after: 300 },
    children: [
      t('FACTURE', { sz: 48, b: true, i: true, color: C.brown, font: FONT_TITLE, u: true }),
    ],
  });

  // ════════════════════════════════════════════════════════════
  // INFO TABLE — N° | value | Date emission | value
  //              Mode | value | Date echeance | value
  // ════════════════════════════════════════════════════════════
  const CL = 2622; // column label
  const CV = 2623; // column value

  const infoTable = new Table({
    width: { size: W, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [CL, CV, CL, CV],
    rows: [
      new TableRow({
        height: { value: 420, rule: HeightRule.ATLEAST },
        children: [
          c([mk([t('N\u00B0 FACTURE', { sz: 16, b: true, color: C.brown })])], { w: CL, bg: C.beige }),
          c([mk([t(data.invoiceNumber, { sz: 20, b: true })])], { w: CV }),
          c([mk([t('DATE D\u2019\u00C9MISSION', { sz: 16, b: true, color: C.brown })])], { w: CL, bg: C.beige }),
          c([mk([t(data.invoiceDate, { sz: 20, b: true })])], { w: CV }),
        ],
      }),
      new TableRow({
        height: { value: 420, rule: HeightRule.ATLEAST },
        children: [
          c([mk([t('MODE PAIEMENT', { sz: 16, b: true, color: C.brown })])], { w: CL, bg: C.beige }),
          c([mk([t(data.paymentMethod || '', { sz: 20 })])], { w: CV }),
          c([mk([t('DATE D\u2019\u00C9CH\u00C9ANCE', { sz: 16, b: true, color: C.brown })])], { w: CL, bg: C.beige }),
          c([mk([t(data.dueDate || '', { sz: 20, b: true })])], { w: CV }),
        ],
      }),
    ],
  });

  // ════════════════════════════════════════════════════════════
  // CLIENT BOX — right-aligned, half-page width
  // ════════════════════════════════════════════════════════════
  const clientLines: Paragraph[] = [
    mk([t(data.customerName || '[Nom du client / Entreprise]', { sz: 22, b: true, color: C.white })]),
  ];
  if (data.customerAddress) clientLines.push(mk([t(data.customerAddress, { sz: 18, color: C.textLight })]));
  if (data.customerPhone) clientLines.push(mk([t(data.customerPhone, { sz: 18, color: C.textLight })]));
  if (data.customerEmail) clientLines.push(mk([t(data.customerEmail, { sz: 18, color: C.textLight })]));
  if (data.customerICE) clientLines.push(mk([t(`ICE / IF : ${data.customerICE}`, { sz: 18, color: C.textLight })]));

  const clientTable = new Table({
    width: { size: W, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [W / 2, W / 2],
    rows: [
      new TableRow({
        children: [
          // Left side empty (pushes client box to the right)
          c([mk([t('')])], { w: W / 2, borders: NO_BORDERS }),
          // Right side: FACTURER A header + client info
          new TableCell({
            width: { size: W / 2, type: WidthType.DXA },
            borders: NO_BORDERS,
            children: [
              // Nested table for the client box
              new Table({
                width: { size: W / 2, type: WidthType.DXA },
                layout: TableLayoutType.FIXED,
                rows: [
                  new TableRow({
                    children: [
                      c([mk([t('FACTURER \u00C0', { sz: 18, b: true, color: C.white })])], { bg: C.brown }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      c(clientLines, { bg: C.brown }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // ════════════════════════════════════════════════════════════
  // ITEMS TABLE — 5 columns with brown header + alternating rows
  // ════════════════════════════════════════════════════════════
  const CD = 3500; // Designation
  const CC = 2100; // Categorie
  const CQ = 1000; // Qte
  const CP = 1800; // Prix U.
  const CM = 2090; // Montant

  const itemHeaderRow = new TableRow({
    height: { value: 460, rule: HeightRule.ATLEAST },
    children: [
      c([mk([t('DESIGNATION', { sz: 18, b: true, color: C.white })], AlignmentType.LEFT)], { w: CD, bg: C.brown }),
      c([mk([t('CATEGORIE', { sz: 18, b: true, color: C.white })], AlignmentType.CENTER)], { w: CC, bg: C.brown }),
      c([mk([t('QTE', { sz: 18, b: true, color: C.white })], AlignmentType.CENTER)], { w: CQ, bg: C.brown }),
      c([mk([t('PRIX U. (DH)', { sz: 18, b: true, color: C.white })], AlignmentType.CENTER)], { w: CP, bg: C.brown }),
      c([mk([t('MONTANT (DH)', { sz: 18, b: true, color: C.white })], AlignmentType.CENTER)], { w: CM, bg: C.brown }),
    ],
  });

  const itemRows: TableRow[] = data.items.map((item, idx) => {
    const bg = idx % 2 === 0 ? C.cream : C.white;
    return new TableRow({
      height: { value: 400, rule: HeightRule.ATLEAST },
      children: [
        c([mk([t(item.description, { sz: 20, b: true })])], { w: CD, bg }),
        c([mk([t(item.category || '', { sz: 18, color: C.textMuted })], AlignmentType.CENTER)], { w: CC, bg }),
        c([mk([t(String(item.quantity), { sz: 20 })], AlignmentType.CENTER)], { w: CQ, bg }),
        c([mk([t(n(item.unit_price), { sz: 20 })], AlignmentType.RIGHT)], { w: CP, bg }),
        c([mk([t(n(item.subtotal), { sz: 20, b: true })], AlignmentType.RIGHT)], { w: CM, bg }),
      ],
    });
  });

  // Empty filler rows
  const fillCount = Math.max(0, 5 - data.items.length);
  for (let i = 0; i < fillCount; i++) {
    const bg = (data.items.length + i) % 2 === 0 ? C.cream : C.white;
    itemRows.push(new TableRow({
      height: { value: 360, rule: HeightRule.ATLEAST },
      children: [
        c([mk([t('')])], { w: CD, bg }),
        c([mk([t('')])], { w: CC, bg }),
        c([mk([t('')])], { w: CQ, bg }),
        c([mk([t('')])], { w: CP, bg }),
        c([mk([t('')])], { w: CM, bg }),
      ],
    }));
  }

  const itemsTable = new Table({
    width: { size: W, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [CD, CC, CQ, CP, CM],
    rows: [itemHeaderRow, ...itemRows],
  });

  // ════════════════════════════════════════════════════════════
  // BOTTOM SECTION — Notes (left) + Totals (right)
  // ════════════════════════════════════════════════════════════
  const NW = 5400;  // notes width
  const TLW = 2800; // total label width
  const TVW = 2290; // total value width

  const amountWords = data.amountInWords || numberToWordsFR(data.totalTTC);

  // Build notes content paragraphs
  const notesContent: Paragraph[] = [
    mk([t('NOTES & CONDITIONS', { sz: 16, b: true, color: C.brown })]),
    new Paragraph({ spacing: { after: 100 }, children: [] }),
    mk([t('ARRETE LA PRESENTE FACTURE A LA SOMME DE :', { sz: 16, b: true })]),
    mk([t(amountWords, { sz: 18, i: true, color: C.darkGold })]),
  ];

  if (data.companyBankName || data.companyBankAccount) {
    notesContent.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
    notesContent.push(mk([t('Information bancaire :', { sz: 16, b: true })]));
    if (data.companyBankName) notesContent.push(mk([t(`BANQUE : ${data.companyBankName}`, { sz: 16, color: C.textMuted })]));
    if (data.companyBankAccount) notesContent.push(mk([t(`RIB. : ${data.companyBankAccount}`, { sz: 16, color: C.textMuted })]));
  }

  const totalsTable = new Table({
    width: { size: W, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [NW, TLW, TVW],
    rows: [
      // Row 1: Notes (rowSpan 4) | SOUS-TOTAL HT | value
      new TableRow({
        height: { value: 380, rule: HeightRule.ATLEAST },
        children: [
          c(notesContent, { w: NW, bg: C.beige, rowSpan: 4 }),
          c([mk([t('SOUS-TOTAL HT', { sz: 18, b: true })], AlignmentType.LEFT)], { w: TLW }),
          c([mk([t(`${n(data.totalHT)} DH`, { sz: 20, b: true })], AlignmentType.RIGHT)], { w: TVW }),
        ],
      }),
      // Row 2: REMISE
      new TableRow({
        height: { value: 380, rule: HeightRule.ATLEAST },
        children: [
          c([mk([t('REMISE', { sz: 18, b: true })], AlignmentType.LEFT)], { w: TLW }),
          c([mk([t('0 %', { sz: 20 })], AlignmentType.RIGHT)], { w: TVW }),
        ],
      }),
      // Row 3: TVA
      new TableRow({
        height: { value: 380, rule: HeightRule.ATLEAST },
        children: [
          c([mk([t(`TVA (${data.tvaRate} %)`, { sz: 18, b: true })], AlignmentType.LEFT)], { w: TLW }),
          c([mk([t(`${n(data.totalTVA)} DH`, { sz: 20 })], AlignmentType.RIGHT)], { w: TVW }),
        ],
      }),
      // Row 4: TOTAL TTC (brown background)
      new TableRow({
        height: { value: 460, rule: HeightRule.ATLEAST },
        children: [
          c([mk([t('TOTAL TTC', { sz: 22, b: true, color: C.white })], AlignmentType.LEFT)], { w: TLW, bg: C.brown }),
          c([mk([t(`${n(data.totalTTC)} DH`, { sz: 24, b: true, color: C.white })], AlignmentType.RIGHT)], { w: TVW, bg: C.brown }),
        ],
      }),
    ],
  });

  // ════════════════════════════════════════════════════════════
  // SIGNATURE
  // ════════════════════════════════════════════════════════════
  const signatureLine = new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 600, after: 100 },
    children: [t('_________________________', { sz: 18, color: C.textMuted })],
  });
  const signatureLabel = new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 0 },
    children: [t('Signature & Cachet', { sz: 18, i: true, color: C.textMuted })],
  });

  // ════════════════════════════════════════════════════════════
  // FOOTER — company legal info
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

  const footerParagraphs: Paragraph[] = [];
  // Separator line in footer
  footerParagraphs.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: C.brown, space: 4 } },
    spacing: { after: 60 },
    children: [],
  }));
  if (fl1.length) footerParagraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 20 },
    children: [t(fl1.join(' | '), { sz: 14, color: C.textMuted })],
  }));
  if (fl2.length) footerParagraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 20 },
    children: [t(fl2.join(' | '), { sz: 14, color: C.textMuted })],
  }));
  if (fl3.length) footerParagraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 0 },
    children: [t(fl3.join(' \u2013 '), { sz: 14, color: C.textMuted })],
  }));

  // ════════════════════════════════════════════════════════════
  // ASSEMBLE DOCUMENT
  // ════════════════════════════════════════════════════════════
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20, color: C.textDark } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1800, right: 720, bottom: 1200, left: 720 },
        },
      },
      headers: {
        default: new Header({ children: headerChildren }),
      },
      footers: {
        default: new Footer({
          children: footerParagraphs.length > 1 ? footerParagraphs : [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [t(data.companyName, { sz: 14, color: C.textMuted })] }),
          ],
        }),
      },
      children: [
        titleParagraph,
        infoTable,
        new Paragraph({ spacing: { after: 200 }, children: [] }),
        clientTable,
        new Paragraph({ spacing: { after: 250 }, children: [] }),
        itemsTable,
        new Paragraph({ spacing: { after: 80 }, children: [] }),
        totalsTable,
        signatureLine,
        signatureLabel,
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer as Buffer;
}

export { numberToWordsFR };
