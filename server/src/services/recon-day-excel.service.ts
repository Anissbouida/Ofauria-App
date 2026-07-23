import ExcelJS from 'exceljs';

// Rapport xlsx d'une journée du module Contrôle des ventes, au format
// « document papier » : une seule feuille — bandeau entreprise, légende,
// tableau numéroté par catégorie (Appro / Reçu / Vendu / Invendu / Écart),
// sous-totaux avec taux de vente, récapitulatif général, section stock
// antérieur, signatures.
//
// Convention identique à l'écran : Écart = Vendu + Invendu − Reçu (repli sur
// l'Appro si le Reçu n'est pas saisi). Négatif → manque à expliquer ;
// positif → vendu plus que reçu (stock antérieur) ; 0 → OK.

type ReconLineRow = {
  sku: string | null;
  product_name: string;
  category: string | null;
  appro_qty: string | number;
  recu_qty: string | number;
  vendu_qty: string | number;
  vendu_amount: string | number;
  invendu_qty: string | number;
  unit_price: string | number;
  ecart_qty: string | number;
  ecart_value: string | number;
  source_vendu?: string;
};

type ReconDayRow = {
  business_date: string | Date;
  status: 'open' | 'closed';
  notes?: string | null;
  lines: ReconLineRow[];
};

const N = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

/** business_date arrive de pg en objet Date (colonne date → minuit local) : on
 * formate en AAAA-MM-JJ via les composantes locales pour éviter tout décalage UTC. */
function isoDateOf(v: string | Date): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

// Palette du document de référence (ARGB).
const C = {
  darkBlue: 'FF1F4E79',
  midBlue: 'FF2E75B6',
  catBand: 'FFE8F0FE',
  subtotal: 'FFD6E4F0',
  yellow: 'FFFFF2CC',
  ecartNeg: 'FFFFC7CE',   // manque → rouge
  ecartPos: 'FFBDD7EE',   // vendu plus que reçu (stock antérieur) → bleu
  ecartZero: 'FFC6EFCE',  // OK → vert
  ecartWarn: 'FFFFE5CC',  // reçu saisi mais rien vendu ni compté → orange
  red: 'FFC00000',
  grey: 'FF666666',
  white: 'FFFFFFFF',
};

const thin = { style: 'thin' as const };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const NB_COLS = 9;

const MOIS = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE'];

function dateFr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MOIS[(m ?? 1) - 1]} ${y}`;
}

/** Base de calcul : le reçu s'il est saisi, sinon l'appro (même règle que l'UI). */
const baseOf = (l: ReconLineRow) => (N(l.recu_qty) > 0 ? N(l.recu_qty) : N(l.appro_qty));
const caOf = (l: ReconLineRow) => (N(l.vendu_amount) > 0 ? N(l.vendu_amount) : N(l.vendu_qty) * N(l.unit_price));

type Obs = { text: string; kind: 'ok' | 'info' | 'warn' | 'missing' };

/** Convention app : écart négatif = manque, positif = vendu plus que reçu. */
function observationOf(ecart: number, vendu: number, invendu: number, base: number): Obs {
  if (ecart < 0) {
    if (vendu === 0 && invendu === 0) return { text: '⚠️ Rien vendu ni compté en vitrine', kind: 'warn' };
    return { text: `❌ ${Math.abs(ecart)} article(s) manquant(s)`, kind: 'missing' };
  }
  if (ecart > 0) return { text: `ℹ️ ${ecart} vendu(s) du stock antérieur`, kind: 'info' };
  if (invendu === 0 && vendu === base && base > 0) return { text: '✅ Tout vendu (pas de reste)', kind: 'ok' };
  return { text: '✅ OK — cohérent', kind: 'ok' };
}

function fillOf(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** Ligne bandeau fusionnée sur toute la largeur. */
function band(ws: ExcelJS.Worksheet, text: string, opts: { fill: string; fontColor?: string; size?: number; height?: number }) {
  const row = ws.addRow([text]);
  if (opts.height) row.height = opts.height;
  // Style sur toutes les cellules AVANT fusion, sinon bordures/fond incomplets.
  for (let c = 1; c <= NB_COLS; c++) {
    row.getCell(c).style = {
      font: { name: 'Arial', size: opts.size ?? 10, bold: true, color: { argb: opts.fontColor ?? C.white } },
      fill: fillOf(opts.fill),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: allBorders,
    };
  }
  ws.mergeCells(row.number, 1, row.number, NB_COLS);
  return row;
}

export async function generateReconDayWorkbook(day: ReconDayRow): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ofauria';
  wb.created = new Date();

  const dateIso = isoDateOf(day.business_date);
  const [y, m, d] = dateIso.split('-');
  const ws = wb.addWorksheet(`Écart ${d}-${m}-${y}`, { properties: { defaultRowHeight: 15 } });
  ws.columns = [
    { width: 4 },   // A  N°
    { width: 34 },  // B  Article
    { width: 10 },  // C  Appro
    { width: 10 },  // D  Reçu
    { width: 10 },  // E  Vendu
    { width: 10 },  // F  Invendu
    { width: 9 },   // G  ÉCART
    { width: 10 },  // H  PU (DH)
    { width: 13 },  // I  Val. Écart (DH)
  ];

  // ── Bandeaux titre + légende
  band(ws, 'BOULANGERIE-PÂTISSERIE OFAURIA', { fill: C.darkBlue, size: 14, height: 20 });
  band(ws, `CONTRÔLE DES ÉCARTS : PRODUCTION vs CAISSE vs VITRINE — ${dateFr(dateIso)}`, { fill: C.darkBlue, size: 12 });
  const legend = ws.addRow(['Écart = Vendu + Invendu − Reçu (repli sur l’Appro si le Reçu n’est pas saisi).  Négatif → manque à expliquer  |  Positif → vendu plus que reçu (stock antérieur)  |  0 → OK ✓']);
  for (let c = 1; c <= NB_COLS; c++) {
    legend.getCell(c).style = {
      font: { name: 'Arial', size: 9, bold: true },
      fill: fillOf(C.yellow),
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
      border: allBorders,
    };
  }
  ws.mergeCells(legend.number, 1, legend.number, NB_COLS);
  ws.addRow([]);

  // ── En-têtes du tableau
  const hdr = ws.addRow(['N°', 'Article', 'Appro', 'Reçu', 'Vendu (caisse)', 'Invendu (vitrine)', 'ÉCART', 'PU (DH)', 'Val. Écart (DH)']);
  hdr.height = 24;
  hdr.eachCell(cell => {
    cell.style = {
      font: { name: 'Arial', size: 9, bold: true, color: { argb: C.white } },
      fill: fillOf(C.darkBlue),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: allBorders,
    };
  });

  // ── Répartition des lignes : stock antérieur (vendu sans appro ni reçu) à part.
  // Uniquement si la journée a des transferts saisis : sans aucun appro/reçu
  // (ex. import Loyverse seul), tout reste dans le tableau principal.
  const dayHasSupply = day.lines.some(l => baseOf(l) > 0);
  const anterieur = dayHasSupply
    ? day.lines.filter(l => baseOf(l) === 0 && N(l.vendu_qty) > 0)
    : [];
  const main = day.lines.filter(l => !anterieur.includes(l));

  // Groupes consécutifs (le repo trie par catégorie puis nom).
  const groups: { cat: string; items: ReconLineRow[] }[] = [];
  for (const l of main) {
    const cat = (l.category || 'AUCUNE CATÉGORIE').toUpperCase();
    const last = groups[groups.length - 1];
    if (last && last.cat === cat) last.items.push(l);
    else groups.push({ cat, items: [l] });
  }

  const zero = () => ({ appro: 0, recu: 0, base: 0, vendu: 0, invendu: 0, ecart: 0, ecartVal: 0, ca: 0 });
  const g = zero();

  for (const { cat, items } of groups) {
    // Bandeau catégorie
    const bandRow = ws.addRow([`  ▸ ${cat}  (${items.length} article${items.length > 1 ? 's' : ''})`]);
    for (let c = 1; c <= NB_COLS; c++) {
      bandRow.getCell(c).style = {
        font: { name: 'Arial', size: 10, bold: true, color: { argb: C.darkBlue } },
        fill: fillOf(C.catBand),
        alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
        border: allBorders,
      };
    }
    ws.mergeCells(bandRow.number, 1, bandRow.number, NB_COLS);

    const sub = zero();
    items.forEach((l, i) => {
      const appro = N(l.appro_qty), recu = N(l.recu_qty), base = baseOf(l);
      const vendu = N(l.vendu_qty), invendu = N(l.invendu_qty), pu = N(l.unit_price);
      const ecart = N(l.ecart_qty);
      const ecartVal = N(l.ecart_value);
      const obs = observationOf(ecart, vendu, invendu, base);

      const row = ws.addRow([
        i + 1, l.product_name, appro, recu, vendu, invendu, ecart,
        pu > 0 ? pu : '—',
        ecart !== 0 ? ecartVal : null,
      ]);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = allBorders;
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle', wrapText: true };
      });
      // Cellule ÉCART colorée selon le cas ; l'explication reste en note au survol.
      const eFill = ecart < 0 ? (obs.kind === 'warn' ? C.ecartWarn : C.ecartNeg)
        : ecart > 0 ? C.ecartPos : C.ecartZero;
      const eCell = row.getCell(7);
      eCell.fill = fillOf(eFill);
      eCell.font = { name: 'Arial', size: 10, bold: true };
      eCell.numFmt = '+#,##0;-#,##0;0';
      if (ecart !== 0 || obs.kind !== 'ok') {
        eCell.note = { texts: [{ font: { size: 10, name: 'Arial' }, text: obs.text }] } as any;
      }
      row.getCell(9).numFmt = '+#,##0.00;-#,##0.00;0.00';

      sub.appro += appro; sub.recu += recu; sub.base += base;
      sub.vendu += vendu; sub.invendu += invendu;
      sub.ecart += ecart; sub.ecartVal += ecartVal; sub.ca += caOf(l);
    });

    // Sous-total catégorie (taux de vente et CA intégrés au libellé)
    const taux = sub.base > 0 ? Math.round((sub.vendu / sub.base) * 100) : 0;
    const stLabel = sub.base > 0
      ? `Sous-total ${cat} — vente ${taux}% · CA ${Math.round(sub.ca)} DH`
      : `Sous-total ${cat} — CA ${Math.round(sub.ca)} DH`;
    const st = ws.addRow([
      null, stLabel, sub.appro, sub.recu, sub.vendu, sub.invendu, sub.ecart, null,
      sub.ecartVal !== 0 ? sub.ecartVal : null,
    ]);
    st.height = 18;
    st.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.style = {
        font: { name: 'Arial', size: 10, bold: true },
        fill: fillOf(C.subtotal),
        alignment: { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle', wrapText: true },
        border: allBorders,
      };
    });
    st.getCell(7).numFmt = '+#,##0;-#,##0;0';
    st.getCell(9).numFmt = '+#,##0.00;-#,##0.00;0.00';

    g.appro += sub.appro; g.recu += sub.recu; g.base += sub.base;
    g.vendu += sub.vendu; g.invendu += sub.invendu;
    g.ecart += sub.ecart; g.ecartVal += sub.ecartVal; g.ca += sub.ca;
  }

  // ── Récapitulatif général
  ws.addRow([]);
  band(ws, 'RÉCAPITULATIF GÉNÉRAL', { fill: C.darkBlue, size: 12 });

  const caAnterieur = anterieur.reduce((s, l) => s + caOf(l), 0);
  const recap: [string, string, { labelFill?: string; valueFill?: string; valueColor?: string; valueSize?: number }][] = [
    ['Total appro (production prévue)', String(g.appro), {}],
    ['Total reçu (magasin)', String(g.recu), {}],
    ['Total vendu (caisse enregistreuse)', String(g.vendu), {}],
    ['Total invendu (compté en vitrine)', String(g.invendu), {}],
    ['ÉCART TOTAL (Vendu + Invendu − Reçu)', `${g.ecart > 0 ? '+' : ''}${g.ecart}`, { labelFill: C.ecartNeg, valueFill: C.ecartNeg, valueColor: C.red, valueSize: 12 }],
    ["Valeur de l'écart (DH)", `${g.ecartVal > 0 ? '+' : ''}${g.ecartVal.toFixed(2)} DH`, {}],
  ];
  // Style appliqué à TOUTES les cellules des plages fusionnées (l'ancre seule
  // laisse les bordures/remplissages incomplets sur le reste de la plage).
  const styleRange = (row: ExcelJS.Row, from: number, to: number, style: Partial<ExcelJS.Style>) => {
    for (let c = from; c <= to; c++) row.getCell(c).style = style as ExcelJS.Style;
  };
  for (const [label, value, o] of recap) {
    const row = ws.addRow([label, null, null, null, null, value]);
    styleRange(row, 1, 5, {
      font: { name: 'Arial', size: 10, bold: true },
      fill: fillOf(o.labelFill ?? C.subtotal),
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
      border: allBorders,
    });
    styleRange(row, 6, NB_COLS, {
      font: { name: 'Arial', size: o.valueSize ?? 10, bold: true, color: { argb: o.valueColor ?? 'FF000000' } },
      fill: fillOf(o.valueFill ?? C.subtotal),
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: allBorders,
    });
    ws.mergeCells(row.number, 1, row.number, 5);
    ws.mergeCells(row.number, 6, row.number, NB_COLS);
  }
  ws.addRow([]);
  {
    const row = ws.addRow(['CA total caisse enregistreuse du jour', null, null, null, null, `${(g.ca + caAnterieur).toFixed(2)} DH`]);
    styleRange(row, 1, 5, {
      font: { name: 'Arial', size: 10, bold: true },
      fill: fillOf(C.yellow),
      alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
      border: allBorders,
    });
    styleRange(row, 6, NB_COLS, {
      font: { name: 'Arial', size: 10, bold: true },
      fill: fillOf(C.yellow),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: allBorders,
    });
    ws.mergeCells(row.number, 1, row.number, 5);
    ws.mergeCells(row.number, 6, row.number, NB_COLS);
  }

  // ── Stock antérieur (vendu sans appro ni reçu du jour)
  if (anterieur.length > 0) {
    ws.addRow([]);
    band(ws, 'ARTICLES VENDUS DU STOCK ANTÉRIEUR (pas dans la fiche production du jour)', { fill: C.midBlue });
    let totalVal = 0;
    for (const l of anterieur) {
      const val = caOf(l);
      totalVal += val;
      const row = ws.addRow([null, l.product_name, '—', '—', N(l.vendu_qty), '—', null, N(l.unit_price) > 0 ? N(l.unit_price) : '—', val]);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = allBorders;
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle', wrapText: true };
      });
      row.getCell(9).numFmt = '#,##0.00';
    }
    const tr = ws.addRow([null, 'Total stock antérieur vendu', null, null, null, null, null, null, totalVal]);
    tr.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.style = {
        font: { name: 'Arial', size: 10, bold: true },
        fill: fillOf(C.subtotal),
        alignment: { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' },
        border: allBorders,
      };
    });
    tr.getCell(9).numFmt = '#,##0.00';
  }

  // ── Signatures
  ws.addRow([]);
  band(ws, 'SIGNATURES', { fill: C.subtotal, fontColor: C.darkBlue, size: 11 });
  const sigHdr = ws.addRow(['Responsable Magasin', null, null, null, 'Directeur / Gérant']);
  const sigHdrStyle = (h: 'left' | 'center'): Partial<ExcelJS.Style> => ({
    font: { name: 'Arial', size: 10, bold: true },
    fill: fillOf(C.yellow),
    alignment: { horizontal: h, vertical: 'middle' },
    border: allBorders,
  });
  styleRange(sigHdr, 1, 4, sigHdrStyle('center'));
  styleRange(sigHdr, 5, NB_COLS, sigHdrStyle('center'));
  ws.mergeCells(sigHdr.number, 1, sigHdr.number, 4);
  ws.mergeCells(sigHdr.number, 5, sigHdr.number, NB_COLS);

  const sig1 = ws.addRow(['Nom :\nSignature :', null, null, null, 'Nom :\nSignature :']);
  const sig2 = ws.addRow([]);
  sig1.height = 30; sig2.height = 30;
  const sigBoxStyle: Partial<ExcelJS.Style> = {
    font: { name: 'Arial', size: 10 },
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
    border: allBorders,
  };
  styleRange(sig1, 1, NB_COLS, sigBoxStyle);
  styleRange(sig2, 1, NB_COLS, sigBoxStyle);
  ws.mergeCells(sig1.number, 1, sig2.number, 4);
  ws.mergeCells(sig1.number, 5, sig2.number, NB_COLS);

  // Impression : A4 portrait, ajusté en largeur, en-têtes répétés.
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printTitlesRow: '5:5',
  };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
