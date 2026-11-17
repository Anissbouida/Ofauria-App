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
 *                  priorité — générer l'écriture de frais, ou rapprocher avec tolérances ;
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
  action: 'match' | 'post_entry'; counter_account_id: string | null; entry_label: string | null;
  amount_tolerance: number; date_tolerance_days: number;
};
type BankLine = { id: string; operation_date: string; label: string | null; reference: string | null; amount: number; direction: 'in' | 'out' };
type Candidate = { id: string; entry_date: string; amount: number; side: 'in' | 'out'; entry_number: string; refs: string[] };
export type Proposal = {
  bankLineId: string; method: 'reference' | 'rule' | 'amount' | 'group'; confidence: number;
  entryLineIds: string[]; ruleId?: string; ruleLabel?: string;
  /** Écriture à générer (règle « post_entry ») : rien n'existe encore côté comptabilité. */
  generate?: { counterAccountId: string; label: string };
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
                               si.invoice_number, si.supplier_invoice_number], NULL) AS refs
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
            action, counter_account_id, entry_label, amount_tolerance::float8 AS amount_tolerance, date_tolerance_days
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
            const bankSide = line.direction === 'in' ? { debit: line.amount, credit: 0 } : { debit: 0, credit: line.amount };
            const { id } = await manualEntryRepository.createAndPost({
              journalCode: 'BQ', date: line.operation_date, description: `${p.generate.label} — ${line.label ?? ''}`.slice(0, 200),
              lines: [
                { accountId: stmt.account_id, ...bankSide, label: line.label ?? p.generate.label },
                { accountId: p.generate.counterAccountId, debit: bankSide.credit, credit: bankSide.debit, label: p.generate.label },
              ],
            }, { userId: opts.userId, storeId: opts.storeId ?? null });
            generatedEntryId = id;
            entryLineIds = (await db.query(
              `SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [id, stmt.account_id])).rows.map(r => r.id);
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
