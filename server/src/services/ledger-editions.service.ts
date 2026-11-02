/**
 * Éditions comptables (feuille de route compta, lot Important 8) : livre-journal,
 * grand livre, balance, bilan, CPC et balance âgée, en PDF (livres imprimables)
 * et en Excel.
 *
 * Un état = un modèle unique (colonnes + lignes typées) rendu deux fois :
 *   - PDF (pdfkit) : en-tête légal (raison sociale, IF, ICE, RC) répété à
 *     chaque page, en-tête de tableau répété, « À reporter / Report » des
 *     colonnes débit-crédit en bas et haut de page (journal, grand livre),
 *     « Page x / y », date d'édition, auteur et tête de la chaîne
 *     d'inaltérabilité (mig 413) : l'édition est rattachée à un état scellé.
 *   - Excel (exceljs) : mêmes lignes, montants numériques au format comptable,
 *     en-tête figé, sous-totaux en gras.
 */
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { db } from '../config/database.js';
import { loadCompanyLegal, type CompanyLegal } from '../utils/company-legal.js';
import { financialStatementsRepository, balanceSheetRepository } from '../repositories/ledger.repository.js';
import { agedBalanceRepository, AGED_BUCKETS, type AgedSide } from '../repositories/aged-balance.repository.js';

/* ─── Modèle ────────────────────────────────────────────────────────── */

export type EditionCol = { key: string; label: string; width: number; align?: 'left' | 'right'; amount?: boolean };
export type EditionRowKind = 'line' | 'group' | 'note' | 'subtotal' | 'total';
export type EditionRow = { kind: EditionRowKind; cells: Record<string, string | number | null | undefined> };
export type Edition = {
  key: string;                 // nom de fichier
  title: string;
  period: string;
  orientation: 'portrait' | 'landscape';
  columns: EditionCol[];
  rows: EditionRow[];
  carry?: string[];            // colonnes reportées de page en page (lignes 'line' seulement)
  notes?: string[];
};
export type EditionContext = { legal: CompanyLegal; author: string; generatedAt: Date; chain: { seq: number; hash: string } | null };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
/** Montant français, espaces insécables remplacés (absents des polices PDF standard). */
export const fmtAmount = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const fmtDate = (v: unknown) => {
  if (!v) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return s.split('-').reverse().join('/');
};
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const periodLabel = (start?: string, end?: string) =>
  start && end ? `Du ${fmtDate(start)} au ${fmtDate(end)}` : end ? `Au ${fmtDate(end)}` : start ? `Depuis le ${fmtDate(start)}` : 'Toutes périodes';
/** Débit/crédit d'un solde signé : on n'affiche que le côté porteur. */
const dc = (balance: number) => ({ d: balance > 0.004 ? r2(balance) : null, c: balance < -0.004 ? r2(-balance) : null });

export async function editionContext(userId: string): Promise<EditionContext> {
  const [legal, u, chain] = await Promise.all([
    loadCompanyLegal(),
    db.query(`SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name FROM users WHERE id = $1`, [userId]),
    db.query(`SELECT chain_seq, chain_hash FROM journal_entries WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1`),
  ]);
  const c = chain.rows[0];
  return {
    legal, author: u.rows[0]?.name || 'utilisateur', generatedAt: new Date(),
    chain: c ? { seq: Number(c.chain_seq), hash: String(c.chain_hash) } : null,
  };
}

/* ─── États ─────────────────────────────────────────────────────────── */

/** Livre-journal : écritures validées dans l'ordre chronologique, avec leurs lignes. */
export async function buildJournal(p: { startDate: string; endDate: string; journalCode?: string; storeId?: string | null }): Promise<Edition> {
  const v: unknown[] = [p.startDate, p.endDate];
  let extra = '';
  if (p.journalCode) { v.push(p.journalCode); extra += ` AND j.code = $${v.length}`; }
  if (p.storeId) { v.push(p.storeId); extra += ` AND (je.store_id IS NULL OR je.store_id = $${v.length})`; }
  const r = await db.query(
    `SELECT je.id, je.entry_number, je.entry_date, je.description, je.piece_ref, je.status, j.code AS journal_code,
            a.code AS account_code, a.label AS account_label, aa.label AS aux_label, jel.label, jel.debit, jel.credit
       FROM journal_entries je
       JOIN journals j ON j.id = je.journal_id
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN accounts a ON a.id = jel.account_id
       LEFT JOIN account_auxiliaries aa ON aa.id = jel.auxiliary_id
      WHERE je.status IN ('posted', 'reversed') AND je.entry_date BETWEEN $1::date AND $2::date${extra}
      ORDER BY je.entry_date, j.code, je.entry_number, jel.line_order`, v);
  const rows: EditionRow[] = [];
  let last = '', td = 0, tc = 0, entries = 0;
  for (const l of r.rows) {
    if (l.id !== last) {
      last = l.id; entries++;
      rows.push({ kind: 'group', cells: {
        date: fmtDate(l.entry_date), account: l.entry_number,
        label: [l.description, l.piece_ref && `pièce ${l.piece_ref}`, l.status === 'reversed' && '(extournée)'].filter(Boolean).join(' · '),
      } });
    }
    const d = num(l.debit), c = num(l.credit);
    td += d; tc += c;
    rows.push({ kind: 'line', cells: {
      account: l.account_code, label: [l.aux_label || l.account_label, l.label].filter(Boolean).join(' — '),
      debit: d || null, credit: c || null,
    } });
  }
  rows.push({ kind: 'total', cells: { label: `Total du journal (${entries} écriture(s))`, debit: r2(td), credit: r2(tc) } });
  return {
    key: `livre-journal_${p.startDate}_${p.endDate}${p.journalCode ? `_${p.journalCode}` : ''}`,
    title: p.journalCode ? `Livre-journal — journal ${p.journalCode}` : 'Livre-journal',
    period: periodLabel(p.startDate, p.endDate), orientation: 'landscape',
    columns: [
      { key: 'date', label: 'Date', width: 9 },
      { key: 'account', label: 'Compte / N°', width: 14 },
      { key: 'label', label: 'Libellé', width: 51 },
      { key: 'debit', label: 'Débit', width: 13, align: 'right', amount: true },
      { key: 'credit', label: 'Crédit', width: 13, align: 'right', amount: true },
    ],
    rows, carry: ['debit', 'credit'],
  };
}

/** Grand livre : par compte, ouverture, mouvements avec solde progressif, clôture. */
export async function buildGrandLivre(p: { startDate: string; endDate: string; accountClass?: number; account?: string; storeId?: string | null }): Promise<Edition> {
  const gl = await financialStatementsRepository.generalLedgerByPeriod({
    startDate: p.startDate, endDate: p.endDate, accountClass: p.accountClass, accountCode: p.account, storeId: p.storeId ?? undefined,
  });
  const rows: EditionRow[] = [];
  for (const a of gl.accounts) {
    rows.push({ kind: 'group', cells: { date: a.code, label: a.label } });
    let bal = a.opening;
    rows.push({ kind: 'note', cells: { label: 'Solde d\'ouverture', balance: bal ? `${fmtAmount(Math.abs(bal))} ${bal > 0 ? 'D' : 'C'}` : '0,00' } });
    for (const m of a.movements as Record<string, unknown>[]) {
      const d = num(m.debit), c = num(m.credit);
      bal = r2(bal + d - c);
      rows.push({ kind: 'line', cells: {
        date: fmtDate(m.entry_date), number: String(m.entry_number),
        label: [m.auxiliary_label, m.entry_description || m.line_label].filter(Boolean).join(' · '),
        debit: d || null, credit: c || null, balance: `${fmtAmount(Math.abs(bal))} ${bal >= 0 ? 'D' : 'C'}`,
      } });
    }
    rows.push({ kind: 'subtotal', cells: {
      label: `Total ${a.code} / solde de clôture`, debit: a.total_debit, credit: a.total_credit,
      balance: `${fmtAmount(Math.abs(a.closing))} ${a.closing >= 0 ? 'D' : 'C'}`,
    } });
  }
  rows.push({ kind: 'total', cells: { label: `Total général (${gl.account_count} compte(s))`, debit: gl.total_debit, credit: gl.total_credit } });
  return {
    key: `grand-livre_${p.startDate}_${p.endDate}`,
    title: p.account ? `Grand livre — compte ${p.account}` : p.accountClass ? `Grand livre — classe ${p.accountClass}` : 'Grand livre',
    period: periodLabel(p.startDate, p.endDate), orientation: 'landscape',
    columns: [
      { key: 'date', label: 'Date', width: 9 },
      { key: 'number', label: 'Écriture', width: 13 },
      { key: 'label', label: 'Libellé', width: 40 },
      { key: 'debit', label: 'Débit', width: 12.5, align: 'right', amount: true },
      { key: 'credit', label: 'Crédit', width: 12.5, align: 'right', amount: true },
      { key: 'balance', label: 'Solde', width: 13, align: 'right' },
    ],
    rows, carry: ['debit', 'credit'],
  };
}

/** Balance générale à 6 colonnes (ouverture, mouvements, clôture), sous-totaux par classe. */
export async function buildBalance(p: { startDate: string; endDate: string; storeId?: string | null }): Promise<Edition> {
  const bal = await financialStatementsRepository.balance({ startDate: p.startDate, endDate: p.endDate, storeId: p.storeId ?? undefined });
  const rows: EditionRow[] = [];
  const zero = () => ({ od: 0, oc: 0, md: 0, mc: 0, cd: 0, cc: 0 });
  const total = zero();
  let cls: number | null = null, sub = zero();
  const flush = () => {
    if (cls == null) return;
    rows.push({ kind: 'subtotal', cells: { label: `Total classe ${cls}`, ...Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, r2(v)])) } });
  };
  for (const a of bal as (Record<string, unknown> & { code: string; opening: number; closing: number })[]) {
    const c = Number(a.account_class);
    if (c !== cls) { flush(); cls = c; sub = zero(); rows.push({ kind: 'group', cells: { code: `Classe ${c}` } }); }
    const o = dc(a.opening), cl = dc(a.closing);
    const line = { od: o.d ?? 0, oc: o.c ?? 0, md: num(a.total_debit), mc: num(a.total_credit), cd: cl.d ?? 0, cc: cl.c ?? 0 };
    for (const k of Object.keys(line) as (keyof typeof line)[]) { sub[k] += line[k]; total[k] += line[k]; }
    rows.push({ kind: 'line', cells: { code: a.code, label: String(a.label), ...Object.fromEntries(Object.entries(line).map(([k, v]) => [k, v || null])) } });
  }
  flush();
  rows.push({ kind: 'total', cells: { label: 'Total général', ...Object.fromEntries(Object.entries(total).map(([k, v]) => [k, r2(v)])) } });
  const amt = (key: string, label: string): EditionCol => ({ key, label, width: 10.3, align: 'right', amount: true });
  return {
    key: `balance_${p.startDate}_${p.endDate}`, title: 'Balance générale', period: periodLabel(p.startDate, p.endDate), orientation: 'landscape',
    columns: [
      { key: 'code', label: 'Compte', width: 7 }, { key: 'label', label: 'Intitulé', width: 31 },
      amt('od', 'Ouverture D'), amt('oc', 'Ouverture C'), amt('md', 'Mouvements D'), amt('mc', 'Mouvements C'), amt('cd', 'Solde D'), amt('cc', 'Solde C'),
    ],
    rows,
  };
}

/** Bilan à une date (présentation actif / passif de l'écran Bilan). */
export async function buildBilan(p: { endDate: string; storeId?: string | null }): Promise<Edition> {
  const b = await balanceSheetRepository.balanceSheet({ endDate: p.endDate, storeId: p.storeId ?? undefined });
  const rows: EditionRow[] = [];
  const section = (title: string, lines: { code: string; label: string; amount: number }[], totalLabel: string, totalAmount: number) => {
    rows.push({ kind: 'group', cells: { code: title } });
    for (const l of lines) rows.push({ kind: 'line', cells: { code: l.code, label: l.label, amount: l.amount } });
    rows.push({ kind: 'subtotal', cells: { label: totalLabel, amount: totalAmount } });
  };
  rows.push({ kind: 'group', cells: { code: 'ACTIF' } });
  section('Actif immobilisé (net)', b.actif.immobilise, 'Total actif immobilisé', b.actif.total_immobilise);
  section('Actif circulant', b.actif.circulant, 'Total actif circulant', b.actif.total_circulant);
  section('Trésorerie — actif', b.actif.tresorerie, 'Total trésorerie actif', b.actif.total_tresorerie);
  rows.push({ kind: 'total', cells: { label: 'TOTAL ACTIF', amount: b.actif.total } });
  rows.push({ kind: 'group', cells: { code: 'PASSIF' } });
  const fin = [...b.passif.financement_permanent];
  if (b.passif.resultat_anterieur) fin.push({ code: '', label: 'Résultats des exercices antérieurs non clôturés', amount: b.passif.resultat_anterieur });
  fin.push({ code: '', label: 'Résultat net de l\'exercice', amount: b.passif.resultat_net });
  section('Financement permanent', fin, 'Total financement permanent', b.passif.total_financement);
  section('Passif circulant', b.passif.circulant, 'Total passif circulant', b.passif.total_circulant);
  section('Trésorerie — passif', b.passif.tresorerie, 'Total trésorerie passif', b.passif.total_tresorerie);
  rows.push({ kind: 'total', cells: { label: 'TOTAL PASSIF', amount: b.passif.total } });
  return {
    key: `bilan_${p.endDate}`, title: 'Bilan', period: periodLabel(undefined, p.endDate), orientation: 'portrait',
    columns: [{ key: 'code', label: 'Compte', width: 14 }, { key: 'label', label: 'Rubrique', width: 61 }, { key: 'amount', label: 'Montant (DH)', width: 25, align: 'right', amount: true }],
    rows,
    notes: b.ecart ? [`Écart actif − passif : ${fmtAmount(b.ecart)} DH`] : undefined,
  };
}

/** Compte de produits et charges. */
export async function buildCpc(p: { startDate: string; endDate: string; storeId?: string | null }): Promise<Edition> {
  const c = await financialStatementsRepository.incomeStatement({ startDate: p.startDate, endDate: p.endDate, storeId: p.storeId ?? undefined });
  const rows: EditionRow[] = [];
  const block = (title: string, lines: { code: string; label: string; amount: string }[], totalLabel: string, total: number) => {
    rows.push({ kind: 'group', cells: { code: title } });
    for (const l of lines) rows.push({ kind: 'line', cells: { code: l.code, label: l.label, amount: num(l.amount) } });
    rows.push({ kind: 'subtotal', cells: { label: totalLabel, amount: r2(total) } });
  };
  block('PRODUITS (classe 7)', c.produits, 'Total des produits', c.total_produits);
  block('CHARGES (classe 6)', c.charges, 'Total des charges', c.total_charges);
  rows.push({ kind: 'total', cells: { label: c.resultat_net >= 0 ? 'RÉSULTAT NET (bénéfice)' : 'RÉSULTAT NET (perte)', amount: r2(c.resultat_net) } });
  return {
    key: `cpc_${p.startDate}_${p.endDate}`, title: 'Compte de produits et charges (CPC)', period: periodLabel(p.startDate, p.endDate), orientation: 'portrait',
    columns: [{ key: 'code', label: 'Compte', width: 14 }, { key: 'label', label: 'Poste', width: 61 }, { key: 'amount', label: 'Montant (DH)', width: 25, align: 'right', amount: true }],
    rows,
  };
}

/** Balance âgée (lignes non lettrées des comptes de tiers). */
export async function buildBalanceAgee(p: { side: AgedSide; asOf: string }): Promise<Edition> {
  const a = await agedBalanceRepository.compute(p);
  const labels: Record<string, string> = { current: 'Non échu', d30: '1-30 j', d60: '31-60 j', d90: '61-90 j', over90: '+ 90 j' };
  const rows: EditionRow[] = a.tiers.map(t => ({ kind: 'line' as const, cells: { tiers: `${t.label} (${t.code})`, ...t.buckets, total: t.total } }));
  rows.push({ kind: 'total', cells: { tiers: `Total (${a.totals.tiers} tiers)`, ...a.totals.buckets, total: a.totals.total } });
  return {
    key: `balance-agee_${p.side === 'suppliers' ? 'fournisseurs' : 'clients'}_${p.asOf}`,
    title: `Balance âgée ${p.side === 'suppliers' ? 'fournisseurs' : 'clients'}`, period: periodLabel(undefined, p.asOf), orientation: 'landscape',
    columns: [
      { key: 'tiers', label: p.side === 'suppliers' ? 'Fournisseur' : 'Client', width: 34 },
      ...AGED_BUCKETS.map(k => ({ key: k, label: labels[k], width: 11, align: 'right' as const, amount: true })),
      { key: 'total', label: 'Total', width: 11, align: 'right', amount: true },
    ],
    rows,
    notes: [`Total égal au solde comptable des comptes de tiers : ${fmtAmount(a.ledger_balance)} DH.`],
  };
}

/* ─── Rendu PDF ─────────────────────────────────────────────────────── */

const INK = '#2B2B2B', MUTED = '#6B6B6B', RULE = '#C9C9C9', GROUP_BG = '#F1EDE6', TOTAL_BG = '#3B3B3B';

export async function renderPdf(e: Edition, ctx: EditionContext): Promise<Buffer> {
  const landscape = e.orientation === 'landscape';
  const PW = landscape ? 841.89 : 595.28, PH = landscape ? 595.28 : 841.89;
  const M = 32, CW = PW - 2 * M, BOTTOM = PH - 46;
  const doc = new PDFDocument({
    size: 'A4', layout: e.orientation, bufferPages: true,
    margins: { top: M, bottom: 0, left: M, right: M },
    info: { Title: `${e.title} — ${e.period}`, Author: ctx.legal.name || 'Kalum', Creator: 'Kalum' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))));

  const totalW = e.columns.reduce((s, c) => s + c.width, 0);
  const widths = e.columns.map(c => (c.width / totalW) * CW);
  const xs = widths.reduce<number[]>((acc, w, i) => [...acc, i ? acc[i - 1] + widths[i - 1] : M], []);
  const ROW = 12.5;
  const fit = (text: string, w: number) => {
    if (doc.widthOfString(text) <= w) return text;
    let t = text;
    while (t.length > 1 && doc.widthOfString(`${t}…`) > w) t = t.slice(0, -1);
    return `${t}…`;
  };
  const cellText = (c: EditionCol, v: unknown) =>
    v == null || v === '' ? '' : c.amount && typeof v === 'number' ? fmtAmount(v) : String(v);

  const ids = [ctx.legal.if && `IF ${ctx.legal.if}`, ctx.legal.ice && `ICE ${ctx.legal.ice}`, ctx.legal.rc && `RC ${ctx.legal.rc}`].filter(Boolean).join(' · ');
  let y = M;
  const header = () => {
    y = M;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(ctx.legal.name || '', M, y, { width: CW / 2, lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(ids, M, y + 11, { width: CW / 2, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(e.title, M + CW / 2, y, { width: CW / 2, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(e.period, M + CW / 2, y + 15, { width: CW / 2, align: 'right', lineBreak: false });
    y += 30;
    doc.rect(M, y, CW, 15).fill(TOTAL_BG);
    e.columns.forEach((c, i) => doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF')
      .text(c.label.toUpperCase(), xs[i] + 3, y + 4.5, { width: widths[i] - 6, align: c.align ?? 'left', lineBreak: false }));
    y += 17;
  };
  const carry = Object.fromEntries((e.carry ?? []).map(k => [k, 0])) as Record<string, number>;
  const carryRow = (label: string) => {
    if (!e.carry?.length) return;
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED);
    const li = e.columns.findIndex(c => c.key === 'label');
    doc.text(label, xs[Math.max(li, 0)] + 3, y + 3, { width: widths[Math.max(li, 0)] - 6, align: 'right', lineBreak: false });
    e.columns.forEach((c, i) => {
      if (c.key in carry) doc.text(fmtAmount(r2(carry[c.key])), xs[i] + 3, y + 3, { width: widths[i] - 6, align: 'right', lineBreak: false });
    });
    y += ROW;
  };

  header();
  for (const row of e.rows) {
    // Un titre (écriture, compte, classe) ne reste jamais seul en bas de page.
    const need = row.kind === 'group' ? 2 * ROW : ROW;
    if (y + need > BOTTOM - (e.carry?.length ? ROW : 0)) {
      carryRow('À reporter');
      doc.addPage();
      header();
      carryRow('Report');
    }
    const bold = row.kind !== 'line' && row.kind !== 'note';
    if (row.kind === 'group') doc.rect(M, y, CW, ROW).fill(GROUP_BG);
    if (row.kind === 'total') doc.rect(M, y, CW, ROW + 1).fill('#E3DED6');
    if (row.kind === 'subtotal') doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font(bold ? 'Helvetica-Bold' : row.kind === 'note' ? 'Helvetica-Oblique' : 'Helvetica').fontSize(7.5).fillColor(row.kind === 'note' ? MUTED : INK);
    // Une ligne de groupe court sur toute la largeur après sa première cellule renseignée.
    if (row.kind === 'group') {
      const text = e.columns.map(c => cellText(c, row.cells[c.key])).filter(Boolean).join('   ');
      doc.text(fit(text, CW - 6), M + 3, y + 3, { width: CW - 6, lineBreak: false });
    } else {
      e.columns.forEach((c, i) => {
        const t = cellText(c, row.cells[c.key]);
        if (t) doc.text(fit(t, widths[i] - 6), xs[i] + 3, y + 3, { width: widths[i] - 6, align: c.align ?? 'left', lineBreak: false });
      });
    }
    if (row.kind === 'line') for (const k of Object.keys(carry)) carry[k] += num(row.cells[k]);
    y += row.kind === 'total' ? ROW + 3 : ROW;
  }
  for (const note of e.notes ?? []) {
    if (y + ROW > BOTTOM) { doc.addPage(); header(); }
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED).text(note, M, y + 4, { width: CW, lineBreak: false });
    y += ROW + 2;
  }

  // Pied de page : édition, auteur, chaîne d'inaltérabilité, pagination.
  const range = doc.bufferedPageRange();
  const stamp = ctx.generatedAt.toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', dateStyle: 'short', timeStyle: 'short' });
  const chain = ctx.chain ? `Chaîne d'inaltérabilité : écriture n° ${ctx.chain.seq}, empreinte ${ctx.chain.hash.slice(0, 16)}…` : '';
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.moveTo(M, PH - 36).lineTo(M + CW, PH - 36).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(`Édité le ${stamp} par ${ctx.author} — Kalum${chain ? ` — ${chain}` : ''}`, M, PH - 31, { width: CW - 70, lineBreak: false })
      .text(`Page ${i + 1} / ${range.count}`, M + CW - 70, PH - 31, { width: 70, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

/* ─── Rendu Excel ───────────────────────────────────────────────────── */

export async function renderXlsx(e: Edition, ctx: EditionContext): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kalum';
  wb.created = ctx.generatedAt;
  const ws = wb.addWorksheet(e.title.slice(0, 31).replace(/[\\/*?:[\]]/g, '-'), {
    pageSetup: { orientation: e.orientation, paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const ids = [ctx.legal.if && `IF ${ctx.legal.if}`, ctx.legal.ice && `ICE ${ctx.legal.ice}`, ctx.legal.rc && `RC ${ctx.legal.rc}`].filter(Boolean).join(' · ');
  ws.addRow([ctx.legal.name || '']).font = { bold: true, size: 12 };
  ws.addRow([`${e.title} — ${e.period}`]).font = { bold: true, size: 11 };
  ws.addRow([[ids, `Édité le ${ctx.generatedAt.toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })} par ${ctx.author}`].filter(Boolean).join(' — ')]).font = { italic: true, size: 9, color: { argb: 'FF6B6B6B' } };
  ws.addRow([]);
  const head = ws.addRow(e.columns.map(c => c.label));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B3B3B' } }; });
  ws.views = [{ state: 'frozen', ySplit: head.number }];
  e.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(10, Math.round(c.width * (c.amount ? 1.3 : 1.4)));
    if (c.amount) col.numFmt = '#,##0.00;-#,##0.00;""';
    if (c.align === 'right') col.alignment = { horizontal: 'right' };
  });
  for (const row of e.rows) {
    const values = e.columns.map(c => {
      const v = row.cells[c.key];
      return v == null || v === '' ? null : c.amount ? num(v) : v;
    });
    const r = ws.addRow(values);
    if (row.kind === 'group') { r.font = { bold: true }; r.eachCell({ includeEmpty: true }, cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EDE6' } }; }); }
    if (row.kind === 'subtotal') { r.font = { bold: true }; r.eachCell({ includeEmpty: true }, cell => { cell.border = { top: { style: 'thin', color: { argb: 'FFC9C9C9' } } }; }); }
    if (row.kind === 'total') { r.font = { bold: true }; r.eachCell({ includeEmpty: true }, cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3DED6' } }; }); }
    if (row.kind === 'note') r.font = { italic: true, color: { argb: 'FF6B6B6B' } };
  }
  for (const note of e.notes ?? []) { ws.addRow([]); ws.addRow([note]).font = { italic: true }; }
  if (ctx.chain) ws.addRow([`Chaîne d'inaltérabilité : écriture n° ${ctx.chain.seq}, empreinte ${ctx.chain.hash}`]).font = { italic: true, size: 8, color: { argb: 'FF6B6B6B' } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type EditionKind = 'journal' | 'grand-livre' | 'balance' | 'bilan' | 'cpc' | 'balance-agee';
export const EDITION_KINDS: EditionKind[] = ['journal', 'grand-livre', 'balance', 'bilan', 'cpc', 'balance-agee'];
