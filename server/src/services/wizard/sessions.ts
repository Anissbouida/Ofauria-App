import { db } from '../../config/database.js';
import { normalizeStep, visibleSteps, wizardIssues, type WizardAnswers, type WizardMode } from './steps.js';

type Kind = 'initial' | 'evolution' | 'upgrade';
const select = `id, kind, status, mode, current_step, answers, issues, base_version_id, revision, created_at, updated_at`;
function view(row: Record<string, any>) {
  const mode = row.mode as WizardMode;
  const answers = row.answers as WizardAnswers;
  return { id: row.id as string, kind: row.kind as Kind, status: row.status as string,
    mode, answers, current_step: row.current_step as string, revision: row.revision as number,
    base_version_id: row.base_version_id as string | null, created_at: row.created_at as string, updated_at: row.updated_at as string,
    steps: visibleSteps(mode), issues: [...new Map([...wizardIssues(mode, answers), ...(Array.isArray(row.issues) ? row.issues : [])].map(i => [`${i.step}:${i.message}`, i])).values()] };
}
const conflict = () => Object.assign(new Error('Le brouillon a changé ou est fermé. Rechargez sa dernière version.'), { statusCode: 409 });

export async function listWizardSessions() {
  try {
    const { rows } = await db.query(`SELECT ${select} FROM config_wizard_sessions WHERE status IN ('draft','simulated') ORDER BY updated_at DESC LIMIT 50`);
    return rows.map(view);
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') throw Object.assign(new Error('La base de données doit être mise à niveau avant d’utiliser l’assistant.'),{statusCode:503});
    throw e;
  }
}

export async function createWizardSession(kind: Kind, mode: WizardMode, userId: string | null) {
  const { rows } = await db.query(`INSERT INTO config_wizard_sessions(kind, mode, base_version_id, created_by, updated_by)
    VALUES ($1, $2, (SELECT max(id) FROM config_versions), $3, $3)
    ON CONFLICT (kind) WHERE kind = 'initial' AND status IN ('draft','simulated') DO NOTHING RETURNING ${select}`, [kind, mode, userId]);
  if (rows[0]) return view(rows[0]);
  throw conflict();
}

export async function saveWizardSession(id: string, input: { mode: WizardMode; current_step: string; revision: number; answers: WizardAnswers }, userId: string | null) {
  const step = normalizeStep(input.mode, input.current_step);
  const issues = wizardIssues(input.mode, input.answers);
  if (input.answers.sector?.data || input.answers.company?.data) {
    const { wizardCatalog, validateWizardCatalog } = await import('./catalog.js');
    issues.push(...validateWizardCatalog(input.answers, await wizardCatalog(false)));
  }
  // Une revue effectuée en mode rapide ne vaut pas revue des étapes supplémentaires.
  const answers = issues.length && input.answers.review?.reviewed
    ? { ...input.answers, review: { ...input.answers.review, reviewed: false } } : input.answers;
  const { rows } = await db.query(`UPDATE config_wizard_sessions SET mode=$2, current_step=$3, answers=$4::jsonb, issues=$5::jsonb,
      revision=revision+1, status='draft', updated_at=now(), updated_by=$6
    WHERE id=$1 AND revision=$7 AND status IN ('draft','simulated') RETURNING ${select}`,
  [id, input.mode, step, JSON.stringify(answers), JSON.stringify(issues), userId, input.revision]);
  if (!rows[0]) throw conflict();
  return view(rows[0]);
}

export async function abandonWizardSession(id: string, revision: number, userId: string | null) {
  const { rows } = await db.query(`UPDATE config_wizard_sessions SET status='abandoned', revision=revision+1, updated_at=now(), updated_by=$3
    WHERE id=$1 AND revision=$2 AND status IN ('draft','simulated') RETURNING id`, [id, revision, userId]);
  if (!rows[0]) throw conflict();
  return { id };
}

/** Reprendre sur la version active sans perdre les réponses ; la révision précédente
 *  et son jeu de changements ne sont plus applicables. */
export async function rebaseWizardSession(id:string,revision:number,userId:string|null) {
  const {rows}=await db.query(`UPDATE config_wizard_sessions SET base_version_id=(SELECT max(id) FROM config_versions),
    answers=jsonb_set(answers,'{review}',COALESCE(answers->'review','{}'::jsonb)||'{"reviewed":false}'::jsonb,true),
    current_step='review',revision=revision+1,status='draft',issues='[]'::jsonb,updated_by=$3,updated_at=now()
    WHERE id=$1 AND revision=$2 AND status IN ('draft','simulated') RETURNING ${select}`,[id,revision,userId]);
  if(!rows[0])throw conflict();return view(rows[0]);
}
