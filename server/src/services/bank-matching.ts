import { db, withTransaction } from '../config/database.js';
import { manualEntryRepository } from '../repositories/manual-entry.repository.js';

/**
 * Moteur de rapprochement bancaire (G4-02, mig 544).
 *
 * Remplace « montant exact à ± 7 jours, une requête par ligne ». Les lignes du relevé et
 * les lignes d'écriture candidates sont chargées en DEUX requêtes (ensemblistes), puis
 * appariées en mémoire, en quatre passes, de la plus sûre à la moins sûre :
 *
 *   1. référence  (confiance 100) : un numéro de facture, de chèque, de règlement ou de
 *                  pièce de l'écriture figure dans le libellé, et le montant est égal ;
 *   2. règle      (95 si elle génère l'écriture, 90 sinon) : règles de bank_rules par
 *                  priorité — générer l'écriture de frais, rapprocher avec tolérances, ou
 *                  (mig 601, « commission de carte ») rapprocher un flux NET des
 *                  encaissements BRUTS d'un ou plusieurs jours en générant l'écart ;
 *   3. montant    (80) : montant égal à ± 7 jours, candidat unique ;
 *   4. regroupement (70) : une ligne de relevé égale à la somme de 2 à 5 écritures
 *                  proches (virement pour plusieurs factures, remise de chèques),
 *                  combinaison unique.
 * Une écriture ne sert qu'une fois ; une ligne ambiguë (deux candidats) n'est pas proposée.
 *
 * `propose()` n'écrit rien. `apply()` verrouille les lignes du relevé et les écritures
 * candidates, recalcule, puis enregistre les propositions retenues (et génère les
 * écritures de frais) dans UNE transaction.
 *
 * Analogie Oracle : le « AutoReconciliation » de Cash Management, avec ses règles de
 * correspondance (reconciliation rule sets).
 */
export type BankRule = {
  id: string; priority: number; label: string; label_contains: string | null; label_regex: string | null;
  direction: 'in' | 'out' | null; amount_min: number | null; amount_max: number | null;
  action: 'match' | 'post_entry' | 'match_fee'; counter_account_id: string | null; entry_label: string | null;
  amount_tolerance: number; date_tolerance_days: number;
  /** match_fee (mig 601) : écart (brut − net) admis, en % du brut. */
  fee_pct_min?: number | null; fee_pct_max?: number | null;
  /** 'card' : seules les écritures d'encaissement carte sont candidates. */
  candidate_source?: 'card' | null;
};
type BankLine = { id: string; operation_date: string; label: string | null; reference: string | null; amount: number; direction: 'in' | 'out' };
type Candidate = { id: string; entry_date: string; amount: number; side: 'in' | 'out'; entry_number: string; refs: string[]; card?: boolean };
export type Proposal = {
  bankLineId: string; method: 'reference' | 'rule' | 'amount' | 'group'; confidence: number;
  entryLineIds: string[]; ruleId?: string; ruleLabel?: string;
  /**
   * Écriture à générer : règle « post_entry » (montant de la ligne), ou écart d'une règle
   * « match_fee » (`amount` : brut − net ; négatif si la banque a versé plus que le brut).
   */
  generate?: { counterAccountId: string; label: string; amount?: number };
  /** match_fee : brut des encaissements rapprochés et taux de l'écart. */
  gross?: number; feePct?: number;
  entryNumbers: string[];
};

const days = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
const eq = (a: number, b: number, tol = 0) => Math.abs(a - b) <= tol + 0.005;
const text = (l: BankLine) => `${l.label ?? ''} ${l.reference ?? ''}`.toUpperCase();

/** Une ligne de relevé satisfait-elle la condition d'une règle ? */
export function ruleMatches(rule: BankRule, line: BankLine): boolean {
  if (rule.direction && rule.direction !== line.direction) return false;
  if (rule.amount_min != null && line.amount < Number(rule.amount_min) - 0.005) return false;
  if (rule.amount_max != null && line.amount > Number(rule.amount_max) + 0.005) return false;
  const t = text(line);
  if (rule.label_contains && !t.includes(rule.label_contains.toUpperCase())) return false;
  if (rule.label_regex) {
    try { if (!new RegExp(rule.label_regex, 'i').test(t)) return false; } catch { return false; }
  }
  return true;
}

/** Sous-ensembles de 2 à `max` candidats dont la somme vaut `target` (au centime). */
function subsetsSumming(cands: Candidate[], target: number, max = 5): Candidate[][] {
  const out: Candidate[][] = [];
  const goal = Math.round(target * 100);
  const cents = cands.map(c => Math.round(c.amount * 100));
  const walk = (start: number, picked: number[], sum: number) => {
    if (out.length > 1) return;                       // deux solutions : ambigu, inutile de continuer
    if (picked.length >= 2 && sum === goal) { out.push(picked.map(i => cands[i])); return; }
    if (picked.length === max || sum >= goal) return;
    for (let i = start; i < cands.length; i++) walk(i + 1, [...picked, i], sum + cents[i]);
  };
  walk(0, [], 0);
  return out;
}

const signed = (c: Candidate) => (c.side === 'in' ? c.amount : -c.amount);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Règle « match_fee » (mig 601) pour UNE ligne : jours consécutifs (parmi ceux qui portent
 * des encaissements candidats, dans les `date_tolerance_days` précédant l'opération) dont
 * le brut S couvre le net N avec un écart (S − N) entre fee_pct_min et fee_pct_max % de S
 * — ou un écart négatif d'au plus amount_tolerance. Renvoie la combinaison si elle est
 * UNIQUE, sinon null.
 */
function feeMatch(rule: BankRule, line: BankLine, pool: Candidate[]): { lines: Candidate[]; gross: number; fee: number; pct: number } | null {
  const near = pool.filter(c => (!rule.candidate_source || c.card)
    && c.entry_date <= line.operation_date && days(c.entry_date, line.operation_date) <= rule.date_tolerance_days);
  const dayKeys = [...new Set(near.map(c => c.entry_date))].sort();
  const min = Number(rule.fee_pct_min ?? 0);
  const max = Number(rule.fee_pct_max ?? 0);
  const found: { lines: Candidate[]; gross: number; fee: number; pct: number }[] = [];
  for (let i = 0; i < dayKeys.length && found.length < 2; i++) {
    for (let j = i; j < dayKeys.length && found.length < 2; j++) {
      const span = near.filter(c => c.entry_date >= dayKeys[i] && c.entry_date <= dayKeys[j]);
      const gross = round2(span.reduce((t, c) => t + signed(c), 0));
      if (gross <= 0) continue;
      const fee = round2(gross - line.amount);
      const pct = (fee / gross) * 100;
      const ok = fee < -0.005
        ? -fee <= Number(rule.amount_tolerance) + 0.005
        : pct >= min - 1e-9 && pct <= max + 1e-9;
      if (ok) found.push({ lines: span, gross, fee, pct: Math.round(pct * 100) / 100 });
    }
  }
  return found.length === 1 ? found[0] : null;
}

/** Appariement pur (sans base) : testable tel quel. */
export function computeProposals(lines: BankLine[], candidates: Candidate[], rules: BankRule[]): Proposal[] {
  const used = new Set<string>();
  const done = new Set<string>();
  const out: Proposal[] = [];
  const free = (side: 'in' | 'out') => candidates.filter(c => c.side === side && !used.has(c.id));
  const take = (p: Proposal) => { out.push(p); done.add(p.bankLineId); p.entryLineIds.forEach(id => used.add(id)); };

  // 1. Référence exacte.
  const byRef = new Map<string, string[]>();   // écriture → lignes du relevé qui la désignent
  const refHits = new Map<string, Candidate[]>();
  for (const l of lines) {
    const t = text(l);
    const hits = free(l.direction).filter(c => eq(c.amount, l.amount) && c.refs.some(r => r.length >= 4 && t.includes(r.toUpperCase())));
    refHits.set(l.id, hits);
    for (const h of hits) byRef.set(h.id, [...(byRef.get(h.id) ?? []), l.id]);
  }
  for (const l of lines) {
    const hits = refHits.get(l.id) ?? [];
    if (hits.length === 1 && (byRef.get(hits[0].id) ?? []).length === 1) {
      take({ bankLineId: l.id, method: 'reference', confidence: 100, entryLineIds: [hits[0].id], entryNumbers: [hits[0].entry_number] });
    }
  }

  // 2. Règles, par priorité.
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    if (rule.action === 'match_fee') {
      // Chaque ligne cherche sa combinaison de jours ; deux lignes qui veulent la même
      // écriture sont laissées de côté (ambiguïté), comme pour la passe « montant ».
      const wants = new Map<string, NonNullable<ReturnType<typeof feeMatch>>>();
      for (const l of lines) {
        if (done.has(l.id) || l.direction !== 'in' || !ruleMatches(rule, l)) continue;
        const m = feeMatch(rule, l, free('in').concat(free('out')));
        if (m) wants.set(l.id, m);
      }
      const claims = new Map<string, number>();
      for (const m of wants.values()) for (const c of m.lines) claims.set(c.id, (claims.get(c.id) ?? 0) + 1);
      for (const [lineId, m] of wants) {
        if (m.lines.some(c => claims.get(c.id)! > 1 || used.has(c.id))) continue;
        take({
          bankLineId: lineId, method: 'rule', confidence: 90, entryLineIds: m.lines.map(c => c.id), ruleId: rule.id, ruleLabel: rule.label,
          entryNumbers: m.lines.map(c => c.entry_number), gross: m.gross, feePct: m.pct,
          ...(Math.abs(m.fee) >= 0.005 ? { generate: { counterAccountId: rule.counter_account_id!, label: rule.entry_label || rule.label, amount: m.fee } } : {}),
        });
      }
      continue;
    }
    for (const l of lines) {
      if (done.has(l.id) || !ruleMatches(rule, l)) continue;
      if (rule.action === 'post_entry') {
        take({ bankLineId: l.id, method: 'rule', confidence: 95, entryLineIds: [], ruleId: rule.id, ruleLabel: rule.label,
          generate: { counterAccountId: rule.counter_account_id!, label: rule.entry_label || rule.label }, entryNumbers: [] });
        continue;
      }
      const hits = free(l.direction).filter(c => eq(c.amount, l.amount, Number(rule.amount_tolerance)) && days(c.entry_date, l.operation_date) <= rule.date_tolerance_days);
      if (hits.length === 1) take({ bankLineId: l.id, method: 'rule', confidence: 90, entryLineIds: [hits[0].id], ruleId: rule.id, ruleLabel: rule.label, entryNumbers: [hits[0].entry_number] });
    }
  }

  // 3. Montant exact à ± 7 jours, candidat unique (et la ligne d'écriture n'est voulue que par une ligne).
  const amountHits = new Map<string, Candidate[]>();
  const wanted = new Map<string, number>();
  for (const l of lines.filter(x => !done.has(x.id))) {
    const hits = free(l.direction).filter(c => eq(c.amount, l.amount) && days(c.entry_date, l.operation_date) <= 7);
    amountHits.set(l.id, hits);
    for (const h of hits) wanted.set(h.id, (wanted.get(h.id) ?? 0) + 1);
  }
  for (const [lineId, hits] of amountHits) {
    if (hits.length === 1 && wanted.get(hits[0].id) === 1 && !used.has(hits[0].id)) {
      take({ bankLineId: lineId, method: 'amount', confidence: 80, entryLineIds: [hits[0].id], entryNumbers: [hits[0].entry_number] });
    }
  }

  // 4. Regroupement : somme de 2 à 5 écritures proches (les 12 plus proches en date).
  for (const l of lines.filter(x => !done.has(x.id))) {
    const near = free(l.direction)
      .filter(c => c.amount < l.amount + 0.005 && days(c.entry_date, l.operation_date) <= 7)
      .sort((a, b) => days(a.entry_date, l.operation_date) - days(b.entry_date, l.operation_date))
      .slice(0, 12);
    const sets = subsetsSumming(near, l.amount);
    if (sets.length === 1) {
      take({ bankLineId: l.id, method: 'group', confidence: 70, entryLineIds: sets[0].map(c => c.id), entryNumbers: sets[0].map(c => c.entry_number) });
    }
  }
  return out;
}

/** Charge le relevé, ses lignes non rapprochées, les écritures candidates et les règles. */
async function load(statementId: string, lock: boolean) {
  const stmt = (await db.query(`SELECT id, account_id, statement_date::text AS statement_date FROM bank_statements WHERE id = $1`, [statementId])).rows[0];
  if (!stmt) throw Object.assign(new Error('Relevé introuvable'), { statusCode: 404 });
  const lines = (await db.query(
    `SELECT id, operation_date::text AS operation_date, label, reference, amount::float8 AS amount, direction
       FROM bank_statement_lines WHERE bank_statement_id = $1 AND NOT reconciled
      ORDER BY operation_date, created_at${lock ? ' FOR UPDATE' : ''}`, [statementId])).rows as BankLine[];
  if (!lines.length) return { stmt, lines, candidates: [] as Candidate[], rules: [] as BankRule[] };
  const from = lines.reduce((m, l) => (l.operation_date < m ? l.operation_date : m), lines[0].operation_date);
  const to = lines.reduce((m, l) => (l.operation_date > m ? l.operation_date : m), lines[0].operation_date);
  // Écritures du compte non rapprochées, sur la période du relevé élargie de 60 jours,
  // avec les références qui peuvent apparaître dans un libellé bancaire.
  const candidates = (await db.query(
    `SELECT jel.id, je.entry_date::text AS entry_date, je.entry_number,
            CASE WHEN jel.debit > 0 THEN 'in' ELSE 'out' END AS side,
            GREATEST(jel.debit, jel.credit)::float8 AS amount,
            array_remove(ARRAY[je.entry_number, je.piece_ref, p.reference, p.check_number, i.invoice_number, i.supplier_invoice_number,
                               si.invoice_number, si.supplier_invoice_number], NULL) AS refs,
            -- Encaissement carte (règle « commission de carte », mig 601) : vente carte ou mixte,
            -- saisie des ventes du jour, écart carte de la fermeture de caisse.
            (je.source_kind = 'shift_entry'
             OR (je.source_kind = 'closure_diff' AND je.source_detail = 'card')
             OR (je.source_kind = 'sale' AND EXISTS (SELECT 1 FROM sales sa WHERE sa.id = je.source_id AND sa.payment_method IN ('card', 'mixed')))) AS card
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       LEFT JOIN payments p ON p.id = je.source_id
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN invoices si ON si.id = je.source_id
      WHERE jel.account_id = $1 AND je.status = 'posted' AND je.source_kind NOT IN ('reversal', 'opening')
        AND (jel.debit > 0 OR jel.credit > 0)
        AND je.entry_date BETWEEN $2::date - 60 AND $3::date + 60
        AND NOT EXISTS (SELECT 1 FROM bank_statement_line_matches m WHERE m.entry_line_id = jel.id)
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.matched_entry_line_id = jel.id)
      ORDER BY je.entry_date, je.entry_number${lock ? ' FOR UPDATE OF jel' : ''}`,
    [stmt.account_id, from, to])).rows as Candidate[];
  const rules = (await db.query(
    `SELECT id, priority, label, label_contains, label_regex, direction, amount_min::float8 AS amount_min, amount_max::float8 AS amount_max,
            action, counter_account_id, entry_label, amount_tolerance::float8 AS amount_tolerance, date_tolerance_days,
            fee_pct_min::float8 AS fee_pct_min, fee_pct_max::float8 AS fee_pct_max, candidate_source
       FROM bank_rules WHERE is_active ORDER BY priority, created_at`)).rows as BankRule[];
  return { stmt, lines, candidates, rules };
}

export const bankMatching = {
  /** Propositions de rapprochement, sans rien écrire. */
  async propose(statementId: string) {
    const { lines, candidates, rules } = await load(statementId, false);
    const proposals = computeProposals(lines, candidates, rules);
    return { unmatched: lines.length, proposals };
  },

  /**
   * Enregistre les propositions retenues : toutes celles d'au moins `minConfidence`, ou
   * seulement celles des lignes `bankLineIds`. Les écritures de frais sont générées au
   * journal de banque, à la date de l'opération.
   */
  async apply(statementId: string, opts: { userId: string; storeId?: string | null; bankLineIds?: string[]; minConfidence?: number }) {
    return withTransaction(async () => {
      const { stmt, lines, candidates, rules } = await load(statementId, true);
      const all = computeProposals(lines, candidates, rules);
      const keep = all.filter(p => (opts.bankLineIds ? opts.bankLineIds.includes(p.bankLineId) : p.confidence >= (opts.minConfidence ?? 80)));
      const byId = new Map(lines.map(l => [l.id, l]));
      const errors: string[] = [];
      let applied = 0;
      for (const p of keep) {
        const line = byId.get(p.bankLineId)!;
        let entryLineIds = p.entryLineIds;
        let generatedEntryId: string | null = null;
        if (p.generate) {
          try {
            // post_entry : l'écriture porte la ligne entière. match_fee : seulement l'écart
            // (commission : banque C / 6147 D ; écart négatif : banque D / compte C), qui
            // s'ajoute aux encaissements rapprochés — leur somme vaut le net viré.
            const fee = p.generate.amount;
            const bankSide = fee != null
              ? (fee > 0 ? { debit: 0, credit: round2(fee) } : { debit: round2(-fee), credit: 0 })
              : line.direction === 'in' ? { debit: line.amount, credit: 0 } : { debit: 0, credit: line.amount };
            const label = fee != null ? `${p.generate.label} (${p.feePct ?? 0} % de ${(p.gross ?? 0).toFixed(2)})` : p.generate.label;
            // Rapprochement défait puis relancé : l'écriture générée la première fois est restée en
            // comptabilité (unmatchLine). On la réutilise si elle est identique, sinon refus —
            // jamais une seconde écriture de frais pour la même ligne du relevé.
            const prev = (await db.query(
              `SELECT bsl.generated_entry_id AS id,
                      (SELECT json_agg(json_build_object('account_id', jel.account_id, 'debit', jel.debit::float8, 'credit', jel.credit::float8))
                         FROM journal_entry_lines jel WHERE jel.journal_entry_id = bsl.generated_entry_id) AS lines
                 FROM bank_statement_lines bsl JOIN journal_entries je ON je.id = bsl.generated_entry_id AND je.status = 'posted'
                WHERE bsl.id = $1`, [line.id])).rows[0] as { id: string; lines: { account_id: string; debit: number; credit: number }[] } | undefined;
            if (prev) {
              const bankL = prev.lines.find(x => x.account_id === stmt.account_id);
              const counterL = prev.lines.find(x => x.account_id === p.generate!.counterAccountId);
              const same = prev.lines.length === 2 && bankL && counterL
                && Math.abs(bankL.debit - bankSide.debit) < 0.005 && Math.abs(bankL.credit - bankSide.credit) < 0.005;
              if (!same) throw new Error('une écriture générée lors d\'un précédent rapprochement existe et diffère : extournez-la avant de relancer');
              generatedEntryId = prev.id;
              const generated = (await db.query(
                `SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [prev.id, stmt.account_id])).rows.map(r => r.id as string);
              entryLineIds = fee != null ? [...p.entryLineIds, ...generated] : generated;
            } else {
              const { id } = await manualEntryRepository.createAndPost({
                journalCode: 'BQ', date: line.operation_date, description: `${label} — ${line.label ?? ''}`.slice(0, 200),
                lines: [
                  { accountId: stmt.account_id, ...bankSide, label: line.label ?? label },
                  { accountId: p.generate.counterAccountId, debit: bankSide.credit, credit: bankSide.debit, label },
                ],
              }, { userId: opts.userId, storeId: opts.storeId ?? null });
              generatedEntryId = id;
              const generated = (await db.query(
                `SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [id, stmt.account_id])).rows.map(r => r.id as string);
              entryLineIds = fee != null ? [...p.entryLineIds, ...generated] : generated;
            }
          } catch (e) {
            errors.push(`${line.label ?? line.id} : ${(e as Error).message}`);
            continue;
          }
        }
        for (const id of entryLineIds) {
          await db.query(`INSERT INTO bank_statement_line_matches (entry_line_id, bank_line_id) VALUES ($1, $2)`, [id, p.bankLineId]);
        }
        await db.query(
          `UPDATE bank_statement_lines SET matched_entry_line_id = $2, reconciled = true, reconciled_at = now(), reconciled_by = $3,
                  match_method = $4, match_rule_id = $5, match_confidence = $6, generated_entry_id = $7
            WHERE id = $1`,
          [p.bankLineId, entryLineIds[0], opts.userId, p.method, p.ruleId ?? null, p.confidence, generatedEntryId]);
        applied++;
      }
      return { applied, proposed: all.length, unmatched: lines.length - applied, errors };
    });
  },
};
