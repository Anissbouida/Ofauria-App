/**
 * Télédéclarations EDI de la DGI (portail SIMPL, lot Bonus 14) : fichiers XML
 * à téléverser, générés depuis la comptabilité et la paie.
 *
 *   - Relevé des déductions de TVA (Simpl-TVA) : cahier des charges EDI V2.0
 *     du 30/11/2017 et annexe 1 V4.0. Racine DeclarationReleveDeduction, une
 *     ligne <rd> par facture et par taux ; mode de paiement 1 espèces,
 *     2 chèque, 3 prélèvement, 4 virement, 5 effet, 6 compensation, 7 autres ;
 *     dates AAAA-MM-JJ ; fichier zippé avant envoi. Le fichier charge une
 *     déclaration « brouillon » qui doit exister sur le portail pour la période.
 *   - État 9421, traitements et salaires (Simpl-IR) : cahier des charges DTS
 *     V5.1 (27/07/2026), annexes 1 et 2. Racine TraitementEtSalaire, liste du
 *     personnel permanent ; situation familiale C/M/V/D, taux de frais
 *     professionnels TPP.35.2009 / TPP.25.2009.
 *   - Liasse IS (Simpl-IS) : cahier des charges V2.0.3 et annexes EDI 2026.
 *     Racine Liasse, modèle 1 (normal) ou 7 (simplifié), une cellule par code
 *     DGI (liasse-edi.codes) pour le bilan, le CPC, le passage et l'ESG.
 * Rien n'est écrit en base : un fichier accepté devient un brouillon à valider
 * et déposer sur le portail (mode EFI).
 */
import { deflateRawSync } from 'node:zlib';
import { db } from '../config/database.js';
import { loadCompanyLegal } from '../utils/company-legal.js';
import { payrollDeclarationRepository } from '../repositories/payroll-declarations.repository.js';
import { liasseRepository } from '../repositories/liasse.repository.js';
import { LIASSE_MODEL_ID, liasseEdiTables, simplifiedGaps, type EdiTable } from './liasse-edi.codes.js';
import type { LiasseModel } from './liasse.rules.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amt = (n: number) => r2(n).toFixed(2);
export const xmlEscape = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // Caractères de contrôle interdits en XML 1.0.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

export type EdiIssue = { level: 'error' | 'warning'; message: string };

/** Élément XML indenté ; un tableau d'enfants donne un élément composé. */
type Node = [string, string | number | boolean | null | undefined | Node[]];
function render(nodes: Node[], depth = 0): string {
  const pad = '\t'.repeat(depth);
  return nodes.map(([name, v]) => Array.isArray(v)
    ? `${pad}<${name}>\r\n${render(v, depth + 1)}${pad}</${name}>\r\n`
    : `${pad}<${name}>${xmlEscape(v)}</${name}>\r\n`).join('');
}

/* ─── ZIP (une entrée, compression deflate) ───────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Archive ZIP d'un seul fichier (le portail SIMPL attend le XML zippé). */
export function zipOne(name: string, data: Buffer, date = new Date()): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const body = deflateRawSync(data);
  const crc = crc32(data);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10); central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  const end = Buffer.alloc(22);
  const centralOffset = local.length + nameBuf.length + body.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBuf, body, central, nameBuf, end]);
}

/* ─── Relevé des déductions de TVA ─────────────────────────────────── */

/** Mode de paiement Kalum → code DGI du relevé (1 à 7). */
export const VAT_PAYMENT_CODE: Record<string, number> = {
  cash: 1, cheque: 2, cheque_barre: 2, virement: 4, effet: 5, carte: 7, mobile: 7,
};

export type VatRegime = 1 | 2;
export type VatDeductionLine = {
  ord: number; invoice_id: string; num: string; des: string; mht: number; tva: number; ttc: number;
  supplier: string; if: string | null; ice: string | null; tx: number; mp: number; payment_mode: string | null;
  dpai: string | null; dfac: string;
};

/** Période de déclaration : mois (régime 1) ou trimestre (régime 2). */
export function vatPeriodBounds(year: number, period: number, regime: VatRegime) {
  const m0 = regime === 1 ? period : (period - 1) * 3 + 1;
  const m1 = regime === 1 ? period : period * 3;
  return { start: `${year}-${String(m0).padStart(2, '0')}-01`, end: lastDay(year, m1) };
}

export async function vatDeductionStatement(p: { year: number; period: number; regime: VatRegime }) {
  const { start, end } = vatPeriodBounds(p.year, p.period, p.regime);
  // Factures dont le droit à déduction est né dans la période (mig 311 : date
  // du règlement qui les solde), ventilées par taux ; à défaut de lignes
  // taxées, le taux moyen de l'en-tête.
  const rows = (await db.query(
    `WITH inv AS (
       SELECT v.* FROM v_vat_deduction_statement v
        WHERE v.is_vat_recoverable AND v.vat_recoverable_from BETWEEN $1::date AND $2::date
     ), by_rate AS (
       SELECT ii.invoice_id, round(ii.tva_rate, 2)::float8 AS rate, sum(ii.subtotal)::float8 AS ht, sum(ii.tva_amount)::float8 AS tva,
              string_agg(DISTINCT NULLIF(btrim(ii.description), ''), ', ') AS des
         FROM invoice_items ii JOIN inv ON inv.invoice_id = ii.invoice_id
        WHERE ii.tva_rate IS NOT NULL AND ii.tva_amount IS NOT NULL AND ii.tva_amount <> 0
        GROUP BY 1, 2
     )
     SELECT inv.invoice_id, COALESCE(inv.supplier_invoice_number, inv.invoice_number) AS num, inv.invoice_date, inv.supplier_name,
            inv.supplier_if, inv.supplier_ice, inv.vat_recoverable_from,
            COALESCE(br.rate, CASE WHEN inv.amount_ht > 0 THEN round(inv.amount_tva / inv.amount_ht * 100, 2) ELSE 0 END)::float8 AS rate,
            COALESCE(br.ht, inv.amount_ht)::float8 AS ht, COALESCE(br.tva, inv.amount_tva)::float8 AS tva, br.des,
            pay.payment_mode, pay.payment_date
       FROM inv
       LEFT JOIN by_rate br ON br.invoice_id = inv.invoice_id
       LEFT JOIN LATERAL (
         SELECT p.payment_mode, p.payment_date FROM payments p
          WHERE p.invoice_id = inv.invoice_id AND p.status <> 'void' AND p.amount > 0 AND p.payment_date <= inv.vat_recoverable_from
          ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 1
       ) pay ON true
      ORDER BY inv.vat_recoverable_from, inv.invoice_date, num, rate`, [start, end])).rows;
  const issues: EdiIssue[] = [];
  const lines: VatDeductionLine[] = rows.map((r: Record<string, unknown>, i: number) => {
    const ht = r2(Number(r.ht)), tva = r2(Number(r.tva));
    const mode = (r.payment_mode as string | null) ?? null;
    return {
      ord: i + 1, invoice_id: String(r.invoice_id), num: String(r.num), des: String(r.des || `Facture ${r.supplier_name}`).slice(0, 250),
      mht: ht, tva, ttc: r2(ht + tva), supplier: String(r.supplier_name),
      if: (r.supplier_if as string | null) || null, ice: (r.supplier_ice as string | null) || null,
      tx: r2(Number(r.rate)), mp: mode ? VAT_PAYMENT_CODE[mode] ?? 7 : 7, payment_mode: mode,
      dpai: r.payment_date ? iso(r.payment_date) : null, dfac: iso(r.invoice_date),
    };
  });
  // Anomalies regroupées par fournisseur : « OVOTEC (3 factures) ».
  const group = (pred: (l: VatDeductionLine) => boolean) => {
    const m = new Map<string, Set<string>>();
    for (const l of lines.filter(pred)) m.set(l.supplier, (m.get(l.supplier) ?? new Set()).add(l.num));
    return [...m].map(([sup, nums]) => `${sup} (${nums.size > 1 ? `${nums.size} factures` : `facture ${[...nums][0]}`})`).join(', ');
  };
  const noId = group(l => !l.if && !l.ice), noIce = group(l => !!l.if && !l.ice);
  const noPay = group(l => !l.dpai), badRate = group(l => ![20, 14, 10, 7].includes(l.tx));
  if (noId) issues.push({ level: 'error', message: `Fournisseurs sans IF ni ICE (fiche fournisseur) : ${noId}` });
  if (noIce) issues.push({ level: 'warning', message: `Fournisseurs sans ICE : ${noIce}` });
  if (noPay) issues.push({ level: 'error', message: `Aucun règlement daté avant la déduction : ${noPay}` });
  if (badRate) issues.push({ level: 'warning', message: `Taux hors des taux légaux (20, 14, 10, 7 %) : ${badRate}` });
  const totals = { ht: r2(lines.reduce((s, l) => s + l.mht, 0)), tva: r2(lines.reduce((s, l) => s + l.tva, 0)), ttc: r2(lines.reduce((s, l) => s + l.ttc, 0)) };
  return { period: { year: p.year, period: p.period, regime: p.regime, start, end }, lines, totals, issues };
}

/** XML du relevé, à la façon de l'exemple officiel : UTF-8 avec BOM, sans prologue, fins de ligne CRLF. */
export function vatDeductionXml(identifiantFiscal: string, s: Awaited<ReturnType<typeof vatDeductionStatement>>) {
  const rd: Node[] = s.lines.map(l => ['rd', [
    ['ord', l.ord], ['num', l.num], ['des', l.des],
    ['mht', amt(l.mht)], ['tva', amt(l.tva)], ['ttc', amt(l.ttc)],
    ['refF', [['if', l.if ?? ''], ['nom', l.supplier], ['ice', l.ice ?? '']]],
    ['tx', amt(l.tx)],
    ['mp', [['id', l.mp]]],
    ['dpai', l.dpai ?? ''], ['dfac', l.dfac],
  ]]);
  const xml = render([['DeclarationReleveDeduction', [
    ['identifiantFiscal', identifiantFiscal], ['annee', s.period.year], ['periode', s.period.period], ['regime', s.period.regime],
    ['releveDeductions', rd],
  ]]]);
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml, 'utf8')]);
}

export async function buildVatDeductionEdi(p: { year: number; period: number; regime: VatRegime }) {
  const [legal, s] = await Promise.all([loadCompanyLegal(), vatDeductionStatement(p)]);
  const issues = [...s.issues];
  if (!legal.if) issues.unshift({ level: 'error', message: 'Identifiant fiscal (IF) de l\'entreprise manquant : Paramètres › Entreprise' });
  if (!s.lines.length) issues.unshift({ level: 'warning', message: 'Aucune facture déductible sur la période' });
  const name = `releve_deductions_${legal.if ?? 'IF'}_${p.year}_${p.regime === 1 ? 'M' : 'T'}${String(p.period).padStart(2, '0')}`;
  return { ...s, issues, filename: name, xml: vatDeductionXml(legal.if ?? '', s) };
}

/* ─── État 9421 (traitements et salaires) ──────────────────────────── */

/** Taux de frais professionnels appliqué : 35 % sous le seuil annuel, 25 % au-delà. */
export function fraisProRateCode(brutImposable: number, fraisPro: number) {
  if (brutImposable <= 0) return 'TPP.35.2009';
  return fraisPro / brutImposable >= 0.3 ? 'TPP.35.2009' : 'TPP.25.2009';
}

export async function buildIr9421Edi(year: number) {
  const [legal, rows, cnss] = await Promise.all([
    loadCompanyLegal(),
    payrollDeclarationRepository.annualIr(year),
    db.query(`SELECT employer_cnss_number FROM payroll_settings WHERE id = 1`).then(r => r.rows[0]?.employer_cnss_number as string | null).catch(() => null),
  ]);
  const issues: EdiIssue[] = [];
  if (!legal.if) issues.push({ level: 'error', message: 'Identifiant fiscal (IF) de l\'entreprise manquant : Paramètres › Entreprise' });
  if (!legal.communeCode) issues.push({ level: 'error', message: 'Code commune DGI du siège manquant : Paramètres › Entreprise' });
  if (!cnss) issues.push({ level: 'warning', message: 'Numéro d\'affiliation CNSS de l\'employeur manquant : Paramètres de paie' });
  if (!rows.length) issues.push({ level: 'warning', message: `Aucun bulletin déclaré en ${year}` });
  const deduced: string[] = [];
  const noCin = rows.filter(e => !e.cin).map(e => e.name);
  if (noCin.length) issues.push({ level: 'error', message: `${noCin.length} salarié(s) sans numéro de CIN (fiche salarié) : ${noCin.slice(0, 8).join(', ')}${noCin.length > 8 ? '…' : ''}` });
  const staff = rows.map(e => {
    // La fiche salarié ne porte pas la situation familiale : déduite des personnes à charge.
    deduced.push(e.name);
    const totalDeduction = r2(e.fraisPro + e.cotisations);
    return {
      name: e.name, cin: e.cin as string | null, days: Math.round(e.days), brut: r2(e.brut), exonere: r2(e.exonere),
      brutImposable: r2(e.brutImposable), fraisPro: r2(e.fraisPro), cotisations: r2(e.cotisations), netImposable: r2(e.netImposable),
      ir: r2(e.ir), dependents: e.dependents, situation: e.dependents > 0 ? 'M' : 'C', rate: fraisProRateCode(e.brutImposable, e.fraisPro),
      node: ['PersonnelPermanent', [
        ['nom', e.lastName], ['prenom', e.firstName], ['adressePersonnelle', e.address], ['numCNI', e.cin ?? ''], ['numCE', ''], ['numPPR', ''],
        ['numCNSS', e.cnssNumber ?? ''], ['ifu', ''], ['salaireBaseAnnuel', amt(e.base)],
        ['mtBrutTraitementSalaire', amt(e.brut)], ['periode', Math.round(e.days)], ['mtExonere', amt(e.exonere)], ['mtEcheances', amt(0)],
        ['nbrReductions', e.dependents], ['mtIndemnite', amt(0)], ['mtAvantages', amt(0)],
        ['mtRevenuBrutImposable', amt(e.brutImposable)], ['mtFraisProfess', amt(e.fraisPro)], ['mtCotisationAssur', amt(e.cotisations)],
        ['mtAutresRetenues', amt(0)], ['mtRevenuNetImposable', amt(e.netImposable)], ['mtTotalDeduction', amt(totalDeduction)],
        ['irPreleve', amt(e.ir)], ['casSportif', 'false'], ['numMatricule', ''], ['datePermis', ''], ['dateAutorisation', ''],
        ['refSituationFamiliale', [['code', e.dependents > 0 ? 'M' : 'C']]],
        ['refTaux', [['code', fraisProRateCode(e.brutImposable, e.fraisPro)]]],
      ]] as Node,
    };
  });
  if (deduced.length) issues.push({ level: 'warning', message: `Situation familiale déduite des personnes à charge (marié si au moins une) pour ${deduced.length} salarié(s) : à vérifier sur le portail avant le dépôt` });
  const sum = (k: 'brutImposable' | 'netImposable' | 'ir' | 'brut') => r2(staff.reduce((s, x) => s + x[k], 0));
  const totalDeduction = r2(staff.reduce((s, x) => s + x.fraisPro + x.cotisations, 0));

  // Versements mensuels de l'IR retenu (déclarations de paie réglées, mig 319).
  const vers = (await db.query(
    `SELECT d.month, d.amount::float8 AS amount, d.reference, p.payment_date, p.payment_mode, p.reference AS pay_ref
       FROM payroll_declarations d LEFT JOIN payments p ON p.id = d.payment_id
      WHERE d.kind = 'ir' AND d.year = $1 AND d.status = 'paid' ORDER BY d.month`, [year])).rows as
    { month: number; amount: number; reference: string | null; payment_date: unknown; payment_mode: string | null; pay_ref: string | null }[];
  const moyen = (m: string | null) => (m === 'cash' ? 'ES' : m === 'cheque' || m === 'cheque_barre' ? 'CH' : 'SIR');
  const versements: Node[] = vers.map(v => ['VersementTraitementSalaire', [
    ['mois', v.month], ['totalVersement', amt(v.amount)], ['dateDerniereVersment', v.payment_date ? iso(v.payment_date) : ''],
    ['listDetailPaiement', [['DetailPaiementTraitementSalaire', [
      ['reference', v.reference ?? v.pay_ref ?? ''], ['totalVerse', amt(v.amount)], ['principal', amt(v.amount)],
      ['penalite', amt(0)], ['majorations', amt(0)], ['dateVersement', v.payment_date ? iso(v.payment_date) : ''],
      ['refMoyenPaiement', [['code', moyen(v.payment_mode)]]], ['numQuittance', v.reference ?? ''],
    ]]]],
  ]]);
  const months = new Set(vers.map(v => v.month));
  const unpaid = Array.from({ length: 12 }, (_, i) => i + 1).filter(m => !months.has(m));
  if (rows.length && unpaid.length) issues.push({ level: 'warning', message: `Versements d'IR non réglés dans Kalum pour ${unpaid.length} mois (${unpaid.join(', ')}) : complétez-les sur le portail` });

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\r\n' + render([['TraitementEtSalaire', [
    ['identifiantFiscal', legal.if ?? ''], ['nom', ''], ['prenom', ''], ['raisonSociale', legal.name],
    ['exerciceFiscalDu', `${year}-01-01`], ['exerciceFiscalAu', `${year}-12-31`], ['annee', year],
    ['commune', [['code', legal.communeCode ?? '']]],
    ['adresse', [legal.address, legal.city].filter(Boolean).join(', ')], ['numeroCIN', ''], ['numeroCNSS', cnss ?? ''], ['numeroCE', ''],
    ['numeroRC', legal.rc ?? ''], ['identifiantTP', legal.patente ?? ''], ['numeroFax', ''], ['numeroTelephone', legal.phone ?? ''],
    ['email', legal.email ?? ''],
    ['effectifTotal', staff.length], ['nbrPersoPermanent', staff.length], ['nbrPersoOccasionnel', 0], ['nbrStagiaires', 0],
    ['totalMtRevenuBrutImposablePP', amt(sum('brutImposable'))], ['totalMtRevenuNetImposablePP', amt(sum('netImposable'))],
    ['totalMtTotalDeductionPP', amt(totalDeduction)], ['totalMtIrPrelevePP', amt(sum('ir'))],
    ['totalMtBrutSommesPO', amt(0)], ['totalIrPrelevePO', amt(0)],
    ['totalMtBrutTraitSalaireSTG', amt(0)], ['totalMtBrutIndemnitesSTG', amt(0)], ['totalMtRetenuesSTG', amt(0)], ['totalMtRevenuNetImpSTG', amt(0)],
    ['totalSommePayeRTS', amt(0)], ['totalmtAnuuelRevenuSalarial', amt(0)], ['totalmtAbondement', amt(0)],
    ['montantPermanent', amt(sum('brut'))], ['montantOccasionnel', amt(0)], ['montantStagiaire', amt(0)],
    ['listPersonnelPermanent', staff.map(s => s.node)],
    ['listVersements', versements],
  ]]]).replace('<TraitementEtSalaire>', '<TraitementEtSalaire xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="traitementSalaire.xsd">');
  return {
    year, filename: `etat_9421_${legal.if ?? 'IF'}_${year}`, xml: Buffer.from(xml, 'utf8'), issues,
    staff: staff.map(({ node: _node, ...rest }) => rest),
    totals: { brut: sum('brut'), brutImposable: sum('brutImposable'), netImposable: sum('netImposable'), ir: sum('ir'), deductions: totalDeduction, versements: r2(vers.reduce((s, v) => s + v.amount, 0)) },
  };
}

/* ─── Liasse IS (Simpl-IS) ─────────────────────────────────────────── */

/** XML de la liasse, à la façon des exemples officiels : prologue UTF-8, un ValeursTableau par tableau. */
export function liasseXml(p: { identifiantFiscal: string; year: number; model: LiasseModel; tables: EdiTable[] }) {
  const tables: Node[] = p.tables.map(t => ['ValeursTableau', [
    ['tableau', [['id', t.id]]],
    ['groupeValeurs', t.cells.map(c => ['ValeurCellule', [
      ['cellule', [['codeEdi', c.code]]], ['valeur', c.value],
      ...(c.line ? [['numeroLigne', c.line] as Node] : []),
    ]] as Node)],
    ['extraFieldvaleurs', []],
  ]]);
  return Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\r\n' + render([['Liasse', [
    ['modele', [['id', LIASSE_MODEL_ID[p.model]]]],
    ['resultatFiscal', [['identifiantFiscal', p.identifiantFiscal], ['exerciceFiscalDu', `${p.year}-01-01`], ['exerciceFiscalAu', `${p.year}-12-31`]]],
    ['groupeValeursTableau', tables],
  ]]]), 'utf8');
}

export async function buildLiasseIsEdi(year: number, model: LiasseModel) {
  // La liasse est toujours calculée au détail du modèle normal ; le simplifié en regroupe les rubriques.
  const l = await liasseRepository.build(year, 'normal');
  const tables = liasseEdiTables(l, model);
  const issues: EdiIssue[] = [];
  if (!l.company.if) issues.push({ level: 'error', message: 'Identifiant fiscal (IF) de l\'entreprise manquant : Paramètres › Entreprise' });
  for (const c of l.controls) if (!/^Identité fiscale incomplète/.test(c.message)) issues.push(c);
  if (model === 'simplifie')
    for (const g of simplifiedGaps(l)) issues.push({ level: 'warning', message: `${g.label} (${g.amount.toFixed(2)}) : rubrique absente du modèle simplifié, comptée dans les totaux seulement` });
  if (model !== l.suggested_model)
    issues.push({ level: 'warning', message: `Chiffre d'affaires ${l.totals.revenue.toFixed(2)} : le modèle ${l.suggested_model === 'simplifie' ? 'simplifié' : 'normal'} est celui attendu` });
  issues.push({ level: 'warning', message: 'Seuls le bilan, le CPC, le passage au résultat fiscal et l\'ESG sont générés : les autres tableaux de la liasse se complètent sur le portail' });
  return {
    year, model, filename: `liasse_is_${l.company.if ?? 'IF'}_${year}_${model}`,
    xml: liasseXml({ identifiantFiscal: l.company.if ?? '', year, model, tables }),
    tables: tables.map(t => ({ id: t.id, label: t.label, cells: t.cells.length })),
    totals: { actif: l.totals.actif, passif: l.totals.passif, result: l.totals.result, taxable_result: l.passage.taxable_result },
    status: l.status, issues,
  };
}
