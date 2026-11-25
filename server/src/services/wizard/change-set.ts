import { db, withTransaction } from '../../config/database.js';
import { sectorRepository } from '../../repositories/sector.repository.js';
import { specializationRepository } from '../../repositories/specialization.repository.js';
import { wizardCatalog, validateWizardCatalog } from './catalog.js';
import { WIZARD_STEPS, wizardIssues, type WizardAnswers, type WizardMode, type WizardIssue, type WizardData } from './steps.js';
import { COMPANY_FIELDS,INTERFACE_FIELDS,prepareWizardLayers,validateLayerData } from './layer-operations.js';
import { readInterfacePreferences } from '../interface-preferences.js';
import { VOCABULARY_KEY_SET } from '@ofauria/shared';
import { wizardParameterField } from './parameter-definitions.js';
import { applyWizardParameters } from './parameter-operations.js';

export type ChangeOperation = { step: string; data: WizardData; execution: 'sector_modules' | 'company_context' | 'vocabulary' | 'specializations' | 'parameters' | 'interface_preferences' | 'pending'; reason?: string };

/** Stable, explicit compilation. No user-provided table names or executable actions. */
export function compileChangeSet(answers: WizardAnswers): ChangeOperation[] {
  const operations: ChangeOperation[] = [];
  for (const step of WIZARD_STEPS) {
    if (step.key === 'review') continue;
    const data = answers[step.key]?.data;
    if (!data || !Object.keys(data).length) continue;
    const scope = step.key === 'sector' || step.key === 'modules';
    const execution=scope?'sector_modules':step.key==='company'?'company_context':step.key==='vocabulary'?'vocabulary':step.key==='specialties'?'specializations':step.key==='interfaces'?'interface_preferences':step.key==='operations'||step.key==='rules'?'parameters':'pending';
    const entries=Object.entries(data);
    const supported=(k:string)=>scope||(step.key==='company'&&(COMPANY_FIELDS as readonly string[]).includes(k))||(step.key==='interfaces'&&(INTERFACE_FIELDS as readonly string[]).includes(k))||(step.key==='vocabulary'&&VOCABULARY_KEY_SET.has(k))||(step.key==='specialties'&&k==='selected'&&Array.isArray(data[k]))||!!wizardParameterField(step.key,k);
    const ready=Object.fromEntries(entries.filter(([k])=>supported(k)));
    const pending=Object.fromEntries(entries.filter(([k,v])=>!supported(k)&&v!==''));
    if(Object.keys(ready).length) operations.push({step:step.key,data:ready,execution});
    if(Object.keys(pending).length)operations.push({step:step.key,data:pending,execution:'pending',reason:'Application métier non encore raccordée à la transaction de publication.'});
  }
  return operations;
}

export function compilationIssues(answers: WizardAnswers, mode: WizardMode, operations: ChangeOperation[]): WizardIssue[] {
  const issues = [...wizardIssues(mode, answers),...validateLayerData(answers.company?.data,answers.vocabulary?.data)];
  for (const op of operations.filter(o => o.execution === 'pending')) issues.push({ step: op.step, severity: 'warning', message: op.reason! });
  return issues;
}

const stale = () => Object.assign(new Error('Le brouillon ou la configuration active a changé. Reconstituez le jeu de changements.'), { statusCode: 409 });
export const technicalSimulationAvailable = () => process.env.NODE_ENV !== 'production' && process.env.KALUM_WIZARD_SIMULATION_ENABLED === 'true';

export async function currentWizardChangeSet(id: string) {
  const {rows} = await db.query(`SELECT c.* FROM config_change_sets c JOIN config_wizard_sessions s ON s.id=c.session_id AND s.revision=c.session_revision WHERE s.id=$1 AND s.status IN ('draft','simulated')`,[id]);
  return rows[0] ?? null;
}

async function lockSession(id: string, revision: number) {
  const { rows } = await db.query(`SELECT id,answers,mode,revision,base_version_id FROM config_wizard_sessions WHERE id=$1 AND revision=$2 AND status IN ('draft','simulated') FOR UPDATE`, [id,revision]);
  if (!rows[0]) throw stale();
  return rows[0];
}

export async function compileWizardSession(id: string, revision: number, actor: string) {
  return withTransaction(async () => {
    const session = await lockSession(id,revision);
    const answers = session.answers as WizardAnswers;
    const operations = compileChangeSet(answers);
    const issues = [...compilationIssues(answers, session.mode as WizardMode, operations), ...validateWizardCatalog(answers,await wizardCatalog(false))];
    const latest = (await db.query(`SELECT max(id) AS id FROM config_versions`)).rows[0]?.id ?? null;
    if (latest !== session.base_version_id) issues.push({ step:'review',severity:'blocking',message:'La version de référence a changé ; reprendre la préparation sur une référence à jour.' });
    const status = issues.some(i => i.severity === 'blocking' || i.severity === 'info') ? 'blocked' : 'compiled';
    const result = await db.query(`INSERT INTO config_change_sets(session_id,session_revision,base_version_id,operations,issues,status,created_by)
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
      ON CONFLICT (session_id,session_revision) DO UPDATE SET operations=EXCLUDED.operations,issues=EXCLUDED.issues,status=EXCLUDED.status,simulation=NULL,updated_at=now()
      WHERE config_change_sets.status <> 'applied' RETURNING *`, [id,revision,session.base_version_id,JSON.stringify(operations),JSON.stringify(issues),status,actor]);
    if (!result.rows[0]) throw stale();
    return result.rows[0];
  });
}


type SessionRow = { id: string; answers: unknown; mode: string; revision: number; base_version_id: string | null };
type ChangeSetRow = { id: string; operations: ChangeOperation[]; base_version_id: string | null; simulation: unknown };

const latestVersion = async () => (await db.query(`SELECT max(id) AS id FROM config_versions`)).rows[0]?.id ?? null;

/** Contrôles communs à la simulation et à la publication, dans la transaction appelante :
 *  brouillon verrouillé, jeu de changements à jour, aucune anomalie bloquante,
 *  version de référence inchangée. Retourne le brouillon et le jeu de changements. */
async function lockForExecution(id: string, revision: number, statuses: string[]) {
  const session = await lockSession(id, revision) as SessionRow;
  const row = (await db.query(`SELECT * FROM config_change_sets WHERE session_id=$1 AND session_revision=$2 AND status = ANY($3::text[]) FOR UPDATE`, [id, revision, statuses])).rows[0] as ChangeSetRow | undefined;
  if (!row) throw Object.assign(new Error('Compilez le jeu de changements avant de poursuivre.'), { statusCode: 409 });
  const latest = await latestVersion();
  if (latest !== session.base_version_id || latest !== row.base_version_id) throw stale();
  const answers = session.answers as WizardAnswers;
  const matches = (await db.query(`SELECT operations=$2::jsonb AS ok FROM config_change_sets WHERE id=$1`, [row.id, JSON.stringify(compileChangeSet(answers))])).rows[0]?.ok;
  if (!matches) throw Object.assign(new Error('Le compilateur a évolué depuis la préparation. Recompilez les changements.'), { statusCode: 409 });
  const primary = answers.sector?.data?.primary, modules = answers.modules?.data?.selected;
  if (typeof primary !== 'string' || !Array.isArray(modules)) throw Object.assign(new Error('Les secteurs et modules doivent être préparés.'), { statusCode: 409 });
  const issues = [...wizardIssues(session.mode as WizardMode, answers), ...validateLayerData(answers.company?.data, answers.vocabulary?.data), ...validateWizardCatalog(answers, await wizardCatalog(false))];
  if (issues.some(i => i.severity !== 'warning')) throw Object.assign(new Error('Terminez la préparation et corrigez les points bloquants.'), { statusCode: 409 });
  // Sérialise avec les écritures de configuration qui verrouillent cette ligne.
  await db.query(`SELECT id FROM company_settings WHERE id=1 FOR UPDATE`);
  if ((await latestVersion()) !== session.base_version_id) throw stale();
  return { session, row, answers };
}

/** Écrit toutes les couches raccordées dans la transaction ambiante.
 *  Ordre : secteurs/modules/couches (une version), spécialités, paramètres. */
async function executeOperations(answers: WizardAnswers, actor: string, label: string) {
  const primary = answers.sector!.data!.primary as string;
  const secondary = answers.sector?.data?.secondary;
  const modules = answers.modules!.data!.selected as string[];
  const plan = await sectorRepository.planWizardSelection(primary, Array.isArray(secondary) ? secondary : [], modules);
  const layers = await prepareWizardLayers(primary, answers.company?.data, answers.vocabulary?.data, answers.interfaces?.data);
  const beforeInterface = layers.interface_preferences ? await readInterfacePreferences() : null;
  await sectorRepository.commit(plan.current, plan.target, actor, label, { layers });
  const interfaceImpact = beforeInterface ? { before: beforeInterface.values, after: (await readInterfacePreferences()).values } : undefined;
  const specialtyImpact = { enabled: [] as string[], disabled: [] as string[] };
  const selected = answers.specialties?.data?.selected;
  if (Array.isArray(selected)) {
    const active = await specializationRepository.active();
    for (const code of active.filter(code => !selected.includes(code))) {
      const r = await specializationRepository.disable(code, actor);
      if ('error' in r) throw Object.assign(new Error(r.error), { statusCode: 409 });
      specialtyImpact.disabled.push(code);
    }
    for (const code of [...new Set(selected)].filter(code => !active.includes(code))) {
      const r = await specializationRepository.enable(code, actor);
      if ('error' in r) throw Object.assign(new Error(r.error), { statusCode: 409 });
      specialtyImpact.enabled.push(code);
    }
  }
  const parameterImpact = await applyWizardParameters(answers, actor);
  return { impact: plan.diff, specialtyImpact, parameterImpact, interfaceImpact };
}

const scopeOf = (ops: ChangeOperation[]) => [...new Set(ops.filter(o => o.execution !== 'pending').map(o => o.step))];
const pendingOf = (ops: ChangeOperation[]) => ops.filter(o => o.execution === 'pending').map(o => o.step);

/** Only connected configuration write paths are simulated and rolled back.
 *  No order, invoice, or remaining layer is represented as having been simulated. */
export async function simulateWizardChangeSet(id: string, revision: number, actor: string) {
  if (!technicalSimulationAvailable()) throw Object.assign(new Error('Simulation technique réservée à un environnement de test explicitement activé.'), { statusCode: 409 });
  return withTransaction(async () => {
    const { row, answers } = await lockForExecution(id, revision, ['compiled', 'simulated_partial']);
    const rollback = new Error('rollback simulation technique');
    let outcome: Awaited<ReturnType<typeof executeOperations>> | undefined;
    sectorRepository.invalidate();
    try {
      await withTransaction(async () => { outcome = await executeOperations(answers, actor, 'Simulation technique assistant'); throw rollback; });
    } catch (e) { if (e !== rollback) throw e; }
    finally { sectorRepository.invalidate(); }
    const result = { scope: scopeOf(row.operations), rolledBack: true, ...outcome, pending: pendingOf(row.operations),
      note: 'Les écritures de configuration ont été annulées. Les séquences SQL peuvent avoir des écarts. Aucun cycle métier n’a été simulé.' };
    return (await db.query(`UPDATE config_change_sets SET simulation=$3::jsonb,status='simulated_partial',updated_at=now() WHERE session_id=$1 AND session_revision=$2 RETURNING *`, [id, revision, JSON.stringify(result)])).rows[0];
  });
}

/** Publication (lot 13) : applique le jeu de changements compilé dans UNE transaction.
 *  Tout ou rien : secteurs, modules, couches, spécialités et paramètres sont validés
 *  ensemble, puis une version « publication » est enregistrée. La version de référence
 *  du brouillon reste restaurable depuis l'historique des versions (retour arrière).
 *  Les réponses non raccordées (« pending ») restent dans le brouillon, sans effet. */
export async function applyWizardChangeSet(id: string, revision: number, actor: string) {
  try {
    return await withTransaction(async () => {
      const { session, row, answers } = await lockForExecution(id, revision, ['compiled', 'simulated_partial']);
      sectorRepository.invalidate();
      const outcome = await executeOperations(answers, actor, 'Assistant de configuration');
      sectorRepository.invalidate();
      // Version finale : capture aussi les spécialités et paramètres écrits après le commit.
      await sectorRepository.recordVersion('Assistant de configuration — publication', actor);
      const published = await latestVersion();
      const result = { scope: scopeOf(row.operations), rolledBack: false, applied: true, ...outcome, pending: pendingOf(row.operations),
        restoreVersionId: session.base_version_id, publishedVersionId: published,
        note: 'Configuration publiée. La version précédente reste restaurable depuis l’historique des versions.' };
      const applied = (await db.query(`UPDATE config_change_sets SET simulation=$3::jsonb,status='applied',published_version_id=$4,updated_at=now()
        WHERE session_id=$1 AND session_revision=$2 RETURNING *`, [id, revision, JSON.stringify(result), published])).rows[0];
      await db.query(`UPDATE config_wizard_sessions SET status='applied',updated_by=$2,updated_at=now() WHERE id=$1`, [id, actor]);
      return applied;
    });
  } finally { sectorRepository.invalidate(); }
}
