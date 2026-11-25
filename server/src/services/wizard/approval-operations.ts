import { db } from '../../config/database.js';
import { baseCurrencyCode } from '../currency.js';
import type { WizardAnswers, WizardIssue } from './steps.js';

/**
 * Approbations dans l'assistant (étape « Processus et règles ») : le moteur existant
 * (approval_rules, mig 350) reste la seule source. L'assistant n'expose que les règles
 * à seuil simple ({ op, field, value } numérique) et ne modifie que leur activation et
 * leur seuil ; approbateurs et circuits se règlent dans Paramètres › Circuits d'approbation.
 *
 * Réponses : rules.data['approval:<code>:enabled'] (booléen), ['approval:<code>:value'] (texte numérique).
 */
export interface WizardApprovalRule {
  code: string; label: string; doc_type: string; enabled: boolean;
  op: string; field: string; value: number; unit: string; approver: string | null;
}

const unitOf = (field: string) => field === 'amount' ? baseCurrencyCode() : field === 'gap_pct' ? '%' : '';
export const APPROVAL_KEY = /^approval:([a-z][a-z0-9_]{1,39}):(enabled|value)$/;

export async function wizardApprovalRules(): Promise<WizardApprovalRule[]> {
  if (!(await db.query(`SELECT to_regclass('public.approval_rules') AS t`)).rows[0]?.t) return [];
  const rows = (await db.query(`SELECT r.code, r.label, r.doc_type, r.enabled, r.condition,
      (SELECT COALESCE(rl.label, u.first_name || ' ' || u.last_name) FROM approval_rule_steps s
         LEFT JOIN roles rl ON rl.code = s.approver_role LEFT JOIN users u ON u.id = s.approver_user_id
        WHERE s.rule_id = r.id ORDER BY s.step_order LIMIT 1) AS approver
    FROM approval_rules r ORDER BY r.display_order, r.code`)).rows;
  return rows.filter(r => r.condition && typeof r.condition.value === 'number' && ['gt', 'gte'].includes(r.condition.op) && typeof r.condition.field === 'string')
    .map(r => ({ code: r.code, label: r.label, doc_type: r.doc_type, enabled: r.enabled, op: r.condition.op, field: r.condition.field,
      value: Number(r.condition.value), unit: unitOf(r.condition.field), approver: r.approver ?? null }));
}

/** Réponses d'approbation du brouillon, par règle. */
export function approvalAnswers(answers: WizardAnswers) {
  const out = new Map<string, { enabled?: boolean; value?: number; raw?: unknown }>();
  for (const [key, v] of Object.entries(answers.rules?.data ?? {})) {
    const m = APPROVAL_KEY.exec(key);
    if (!m) continue;
    const cur = out.get(m[1]) ?? {};
    if (m[2] === 'enabled') cur.enabled = v === true;
    else { cur.raw = v; cur.value = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/\s/g, '').replace(',', '.')) : NaN; }
    out.set(m[1], cur);
  }
  return out;
}

export function approvalIssues(answers: WizardAnswers, rules: WizardApprovalRule[]): WizardIssue[] {
  const issues: WizardIssue[] = [];
  for (const [code, a] of approvalAnswers(answers)) {
    const rule = rules.find(r => r.code === code);
    if (!rule) { issues.push({ step: 'rules', severity: 'blocking', message: `Règle d'approbation inconnue : ${code}.` }); continue; }
    if (a.raw !== undefined && (!Number.isFinite(a.value) || a.value! < 0 || a.value! > 100_000_000)) issues.push({ step: 'rules', severity: 'blocking', message: `Seuil invalide pour « ${rule.label} ».` });
  }
  return issues;
}

/** Publication : activation et seuil des règles, dans la transaction ambiante. */
export async function applyWizardApprovals(answers: WizardAnswers, actor: string) {
  const changes: { code: string; before: { enabled: boolean; value: number }; after: { enabled: boolean; value: number } }[] = [];
  const pending = approvalAnswers(answers);
  if (!pending.size) return changes;
  const rules = await wizardApprovalRules();
  await db.query(`SELECT set_config('app.user_id', $1, true)`, [actor]);
  for (const [code, a] of pending) {
    const rule = rules.find(r => r.code === code);
    if (!rule) throw Object.assign(new Error(`Règle d'approbation inconnue : ${code}`), { statusCode: 409 });
    const after = { enabled: a.enabled ?? rule.enabled, value: a.value !== undefined && Number.isFinite(a.value) ? a.value : rule.value };
    if (after.enabled === rule.enabled && after.value === rule.value) continue;
    await db.query(`UPDATE approval_rules SET enabled = $2, condition = jsonb_set(condition, '{value}', to_jsonb($3::numeric)), updated_by = $4, updated_at = now() WHERE code = $1`,
      [code, after.enabled, after.value, actor]);
    changes.push({ code, before: { enabled: rule.enabled, value: rule.value }, after });
  }
  return changes;
}
