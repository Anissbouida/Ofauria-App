/**
 * Fichier des Écritures Comptables (FEC) — avis CNC n° 24 (2023), art. 210 CGI.
 *
 * Les 18 colonnes du FEC couvrent les onze informations exigées par l'avis :
 * journal, numéro en séquence continue, date, compte, compte auxiliaire, pièce
 * justificative, libellé, débit/crédit, lettrage et sa date, date de
 * validation, devise. Conventions techniques du FEC (l'avis n'en impose pas
 * d'autres) : UTF-8, tabulation, ligne d'en-tête, dates AAAAMMJJ, virgule
 * décimale sans séparateur de milliers.
 *
 * Choix propres à Kalum :
 *   - EcritureNum : numéro continu 1..N dans l'ordre de validation (ordre de la
 *     chaîne d'inaltérabilité, mig 413). Les numéros internes (AC-2026-00012)
 *     ont des trous hérités de brouillons supprimés : ils restent lisibles en fin
 *     de libellé et les manquants sont listés dans l'attestation.
 *   - ValidDate : date de comptabilisation (posted_at) — l'écriture est figée
 *     dès cet instant (gardes mig 311/413), seule l'extourne la corrige.
 *   - Une attestation accompagne le fichier : empreinte SHA-256, vérification
 *     de la chaîne, ancres de clôture.
 */
import crypto from 'crypto';
import { db } from '../config/database.js';
import { ledgerIntegrityRepository, type IntegrityActor } from '../repositories/ledger-integrity.repository.js';

const COLUMNS = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
] as const;

type FecRow = {
  journal_code: string; journal_lib: string; num: string; entry_number: string; entry_date: string;
  compte_num: string; compte_lib: string; aux_num: string | null; aux_lib: string | null;
  piece_ref: string; piece_date: string; ecriture_lib: string; debit: string; credit: string;
  let_rank: string | null; date_let: string | null; valid_date: string;
  montant_devise: string | null; idevise: string | null;
};

/** Texte sans tabulation ni saut de ligne (ils casseraient les colonnes). */
const clean = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
/** AAAA-MM-JJ → AAAAMMJJ. */
const ymd = (v: string | null) => (v ? v.slice(0, 10).replace(/-/g, '') : '');
/** 1234.5 → « 1234,50 ». */
const amount = (v: string | number | null) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
/** Rang de lettrage → code A, B, …, Z, AA, AB… */
const letterCode = (rank: number) => {
  let s = '';
  for (let n = rank; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const TZ = 'Africa/Casablanca';

/** Lignes du FEC, dans l'ordre de validation, sur [start, end]. */
async function fecRows(start: string, end: string): Promise<FecRow[]> {
  const r = await db.query(
    `WITH e AS (
       SELECT je.*, row_number() OVER (ORDER BY je.chain_seq NULLS LAST, je.posted_at, je.entry_number) AS num
         FROM journal_entries je
        WHERE je.status IN ('posted', 'reversed') AND je.entry_date BETWEEN $1::date AND $2::date
     ), lett AS (
       SELECT jel.lettrage_id, max(je2.entry_date) AS last_date,
              dense_rank() OVER (ORDER BY min(je2.entry_date), jel.lettrage_id) AS rk
         FROM journal_entry_lines jel
         JOIN journal_entries je2 ON je2.id = jel.journal_entry_id
        WHERE jel.lettrage_id IN (SELECT l.lettrage_id FROM journal_entry_lines l JOIN e ON e.id = l.journal_entry_id
                                   WHERE l.lettrage_id IS NOT NULL)
        GROUP BY jel.lettrage_id
     ), lett_audit AS (
       SELECT lettrage_id, max(at) AS at FROM ledger_audit_log WHERE event = 'letter' GROUP BY lettrage_id
     )
     SELECT j.code AS journal_code, j.label AS journal_lib, e.num::text AS num, e.entry_number,
            e.entry_date::text AS entry_date, a.code AS compte_num, a.label AS compte_lib,
            aa.code AS aux_num, aa.label AS aux_lib,
            COALESCE(CASE WHEN inv.invoice_type = 'received' THEN COALESCE(inv.supplier_invoice_number, inv.invoice_number)
                          ELSE inv.invoice_number END,
                     pay.reference, pay.check_number, sa.sale_number, rv.voucher_number,
                     cs.closure_number::text, e.entry_number) AS piece_ref,
            COALESCE(inv.invoice_date, pay.payment_date, (sa.created_at AT TIME ZONE '${TZ}')::date,
                     rv.reception_date, (cs.closed_at AT TIME ZONE '${TZ}')::date, e.entry_date)::text AS piece_date,
            COALESCE(NULLIF(jel.label, ''), e.description, '') AS ecriture_lib,
            jel.debit::text AS debit, jel.credit::text AS credit,
            lett.rk::text AS let_rank, COALESCE((la.at AT TIME ZONE '${TZ}')::date, lett.last_date)::text AS date_let,
            (COALESCE(e.posted_at, e.created_at) AT TIME ZONE '${TZ}')::date::text AS valid_date,
            -- Dette ou créance en devise : montant d'origine sur la ligne de tiers.
            CASE WHEN a.is_collective AND COALESCE(inv.currency_code, pay.currency_code, 'MAD') <> 'MAD'
                      AND COALESCE(inv.exchange_rate, pay.exchange_rate, 0) > 0
                 THEN round((jel.debit + jel.credit) / COALESCE(inv.exchange_rate, pay.exchange_rate), 2)::text END AS montant_devise,
            CASE WHEN a.is_collective AND COALESCE(inv.currency_code, pay.currency_code, 'MAD') <> 'MAD'
                      AND COALESCE(inv.exchange_rate, pay.exchange_rate, 0) > 0
                 THEN COALESCE(inv.currency_code, pay.currency_code) END AS idevise
       FROM e
       JOIN journals j ON j.id = e.journal_id
       JOIN journal_entry_lines jel ON jel.journal_entry_id = e.id
       JOIN accounts a ON a.id = jel.account_id
       LEFT JOIN account_auxiliaries aa ON aa.id = jel.auxiliary_id
       -- Pièce justificative : retrouvée par l'identifiant source, quel que soit
       -- le type d'écriture (le rattrapage historique garde l'id du document).
       LEFT JOIN invoices inv ON inv.id = e.source_id
       LEFT JOIN payments pay ON pay.id = e.source_id
       LEFT JOIN sales sa ON sa.id = e.source_id
       LEFT JOIN reception_voucher_items rvi ON rvi.id = e.source_id
       LEFT JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
       LEFT JOIN cash_register_sessions cs ON cs.id = e.source_id
       LEFT JOIN lett ON lett.lettrage_id = jel.lettrage_id
       LEFT JOIN lett_audit la ON la.lettrage_id = jel.lettrage_id
      ORDER BY e.num, jel.line_order`,
    [start, end]);
  return r.rows as FecRow[];
}

/** Numéros internes non attribués sur la période (par journal), pour l'attestation. */
async function numberingGaps(start: string, end: string) {
  const r = await db.query(
    `WITH n AS (
       SELECT j.code, substring(je.entry_number FROM '^[A-Z]+-(\\d{4})-')::int AS yr,
              substring(je.entry_number FROM '(\\d+)$')::int AS seq
         FROM journal_entries je JOIN journals j ON j.id = je.journal_id
        WHERE je.status <> 'draft' AND je.entry_date BETWEEN $1::date AND $2::date
          AND je.entry_number ~ ('^' || j.code || '-\\d{4}-\\d+$')
     ), b AS (SELECT code, yr, min(seq) AS lo, max(seq) AS hi FROM n GROUP BY code, yr)
     SELECT b.code || '-' || b.yr || '-' || lpad(s::text, 5, '0') AS missing
       FROM b, generate_series(1, b.hi) s
      WHERE NOT EXISTS (SELECT 1 FROM n WHERE n.code = b.code AND n.yr = b.yr AND n.seq = s)
      ORDER BY 1 LIMIT 500`, [start, end]);
  return r.rows.map((x: { missing: string }) => x.missing);
}

export type FecExport = {
  filename: string; content: string;
  attestationFilename: string; attestation: string;
  stats: { entries: number; lines: number; totalDebit: number; totalCredit: number; sha256: string; start: string; end: string };
};

/**
 * Produit le FEC d'un exercice (ou d'une période) et son attestation.
 * Scelle d'abord les écritures en attente : la numérotation continue suit
 * l'ordre de la chaîne et reste stable d'un export à l'autre.
 */
export async function buildFec(p: { year?: number; start?: string; end?: string }, actor: IntegrityActor): Promise<FecExport> {
  let start = p.start, end = p.end;
  let fy: { year: number; status: string; closed_at: string | null; chain_seq: number | null; chain_hash: string | null } | null = null;
  if (p.year) {
    const r = await db.query(
      `SELECT year, status, (closed_at AT TIME ZONE 'Africa/Casablanca')::date::text AS closed_at, chain_seq, chain_hash,
              start_date::text AS start_date, end_date::text AS end_date
         FROM fiscal_years WHERE year = $1`, [p.year]);
    if (!r.rows[0]) throw Object.assign(new Error(`Exercice ${p.year} introuvable`), { statusCode: 404 });
    fy = r.rows[0];
    start = r.rows[0].start_date; end = r.rows[0].end_date;
  }
  if (!start || !end || start > end) throw Object.assign(new Error('Période invalide'), { statusCode: 400 });

  await ledgerIntegrityRepository.seal(actor);
  const [rows, gaps, verify, company, anchors, who] = await Promise.all([
    fecRows(start, end),
    numberingGaps(start, end),
    ledgerIntegrityRepository.verify(actor),
    db.query(`SELECT legal_name, legal_ice, legal_if, legal_rc FROM company_settings LIMIT 1`),
    db.query(
      `SELECT fp.month, fp.year, e.to_status, e.chain_seq, e.chain_hash, e.at
         FROM fiscal_period_events e JOIN fiscal_periods fp ON fp.id = e.period_id
        WHERE e.chain_hash IS NOT NULL AND fp.start_date BETWEEN $1::date AND $2::date
        ORDER BY e.at`, [start, end]),
    actor.userId ? db.query(`SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name FROM users WHERE id = $1`, [actor.userId]) : null,
  ]);

  const tracedDeletions = gaps.length
    ? Number((await db.query(
        `SELECT count(*)::int AS n FROM ledger_audit_log WHERE event = 'draft_delete' AND entry_number = ANY($1)`, [gaps])).rows[0].n)
    : 0;

  const lines = [COLUMNS.join('\t')];
  let totalDebit = 0, totalCredit = 0;
  const entries = new Set<string>();
  for (const r of rows) {
    entries.add(r.num);
    totalDebit += Number(r.debit); totalCredit += Number(r.credit);
    const lib = clean(r.ecriture_lib);
    lines.push([
      clean(r.journal_code), clean(r.journal_lib), r.num, ymd(r.entry_date),
      clean(r.compte_num), clean(r.compte_lib), clean(r.aux_num), clean(r.aux_lib),
      clean(r.piece_ref), ymd(r.piece_date),
      // Numéro interne en fin de libellé : le lien avec l'écran Journal de Kalum.
      lib.includes(r.entry_number) ? lib : `${lib} [${r.entry_number}]`.trim(),
      amount(r.debit), amount(r.credit),
      r.let_rank ? letterCode(Number(r.let_rank)) : '', r.let_rank ? ymd(r.date_let) : '',
      ymd(r.valid_date), amount(r.montant_devise), clean(r.idevise),
    ].join('\t'));
  }
  const content = lines.join('\r\n') + '\r\n';
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');

  const co = company.rows[0] ?? {};
  const fiscalId = String(co.legal_if || co.legal_ice || 'SOCIETE').replace(/\W+/g, '');
  const filename = `${fiscalId}FEC${ymd(end)}.txt`;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const stats = { entries: entries.size, lines: rows.length, totalDebit: r2(totalDebit), totalCredit: r2(totalCredit), sha256, start, end };
  const now = new Date();

  const att: string[] = [
    "ATTESTATION D'INTÉGRITÉ — FICHIER DES ÉCRITURES COMPTABLES",
    '',
    `Société        : ${co.legal_name ?? '—'}`,
    `ICE            : ${co.legal_ice ?? '—'}    IF : ${co.legal_if ?? '—'}    RC : ${co.legal_rc ?? '—'}`,
    `Période        : du ${start} au ${end}` + (fy ? ` — exercice ${fy.year}, ${fy.status === 'closed' ? `clôturé le ${fy.closed_at}` : 'ouvert (export provisoire)'}` : ''),
    `Fichier        : ${filename}`,
    `Généré le      : ${now.toISOString()} par ${who?.rows[0]?.name || 'système'}`,
    '',
    `Écritures      : ${stats.entries}`,
    `Lignes         : ${stats.lines}`,
    `Total débit    : ${amount(stats.totalDebit)}`,
    `Total crédit   : ${amount(stats.totalCredit)}`,
    `SHA-256        : ${sha256}`,
    '',
    "CHAÎNE D'INALTÉRABILITÉ (SHA-256 chaîné, mig 413)",
    `Vérification   : ${verify.ok ? 'intacte' : `${verify.anomalies.length} anomalie(s)`} — ${verify.checked} écriture(s) scellée(s), tête n° ${verify.headSeq}`,
    `Tête de chaîne : ${verify.headHash ?? '—'}`,
  ];
  if (fy?.chain_hash) att.push(`Ancre de clôture de l'exercice : n° ${fy.chain_seq} — ${fy.chain_hash}`);
  if (anchors.rows.length) {
    att.push('Ancres des clôtures de période :');
    for (const a of anchors.rows) {
      att.push(`  ${String(a.month).padStart(2, '0')}/${a.year} ${a.to_status === 'locked' ? 'verrouillage' : 'clôture   '} n° ${a.chain_seq} — ${a.chain_hash}`);
    }
  }
  if (!verify.ok) {
    att.push('Anomalies :');
    for (const a of verify.anomalies.slice(0, 50)) att.push(`  rang ${a.seq} ${a.entry_no ?? ''} : ${a.problem}`);
  }
  att.push(
    '',
    'NUMÉROTATION',
    'EcritureNum est un numéro continu de 1 à N dans l\'ordre de validation (ordre de la chaîne).',
    'Le numéro interne de Kalum (ex. AC-2026-00012) figure entre crochets en fin d\'EcritureLib.',
    gaps.length
      ? `Numéros internes attribués puis supprimés (${gaps.length}${gaps.length === 500 ? '+' : ''}), dont ${tracedDeletions} suppression(s) de brouillon tracée(s) au journal d'audit :`
      : 'Numéros internes : aucun trou.',
  );
  for (let i = 0; i < gaps.length; i += 6) att.push('  ' + gaps.slice(i, i + 6).join('  '));
  if (gaps.length) {
    att.push(
      'Avant la migration 311, une écriture pouvait être supprimée ; depuis, seule la suppression d\'un brouillon',
      'reste possible (une écriture comptabilisée se corrige par extourne), et chaque suppression est tracée au',
      'journal d\'audit depuis la migration 413.',
    );
  }
  att.push(
    '',
    'FORMAT',
    'Avis CNC n° 24 (2023), article 210 du CGI. 18 colonnes, UTF-8, séparateur tabulation, ligne d\'en-tête,',
    'dates AAAAMMJJ, montants à virgule décimale sans séparateur de milliers, fins de ligne CRLF.',
    'ValidDate = date de comptabilisation : l\'écriture est figée dès cet instant, seule une extourne la corrige.',
    'Les à-nouveaux (journal AN) font partie de l\'exercice qui les reçoit.',
    'Montantdevise / Idevise : renseignés sur les lignes de tiers des pièces en devise.',
    '',
  );

  await db.query(
    `INSERT INTO ledger_audit_log (event, actor, client_ip, details) VALUES ('fec_export', $1, $2, $3)`,
    [actor.userId, actor.ip || null, JSON.stringify({ ...stats, year: fy?.year ?? null, filename, chain_seq: verify.headSeq })]);

  return { filename, content, attestationFilename: filename.replace(/\.txt$/, '_attestation.txt'), attestation: att.join('\r\n'), stats };
}
