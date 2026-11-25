import { db } from '../../config/database.js';
import { sectorRepository } from '../../repositories/sector.repository.js';
import { impactPreview } from '../module-impact.js';
import { wizardCatalog, validateWizardCatalog } from './catalog.js';
import { wizardIssues, type WizardAnswers, type WizardMode } from './steps.js';

/** Read-only impact of a saved draft. Not a transaction simulation or approval. */
export async function previewWizardSession(id: string) {
  const row = (await db.query(`SELECT answers, mode, revision, base_version_id FROM config_wizard_sessions WHERE id=$1 AND status IN ('draft','simulated')`, [id])).rows[0];
  if (!row) throw Object.assign(new Error('Brouillon introuvable'), { statusCode: 404 });
  const answers = row.answers as WizardAnswers;
  const catalog = await wizardCatalog(false);
  const issues = [...wizardIssues(row.mode as WizardMode, answers), ...validateWizardCatalog(answers, catalog)];
  const latest = (await db.query(`SELECT max(id) AS id FROM config_versions`)).rows[0]?.id ?? null;
  if (latest !== row.base_version_id) issues.push({ step: 'review', severity: 'warning', message: 'La configuration active a évolué depuis la création du brouillon.' });
  const primary = answers.sector?.data?.primary, secondary = answers.sector?.data?.secondary, modules = answers.modules?.data?.selected;
  if (typeof primary !== 'string' || !Array.isArray(modules)) return { revision: row.revision, issues, impact: null };
  if (issues.some(i => i.severity === 'blocking')) return { revision: row.revision, issues, impact: null };
  try {
    const features = answers.modules?.data?.features;
    const plan = await sectorRepository.previewWizardSelection(primary, Array.isArray(secondary) ? secondary : [], modules, Array.isArray(features) ? features : undefined);
    return { revision: row.revision, issues, impact: await impactPreview(plan.diff, sectorRepository.featureLabel(plan.current)) };
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode !== 409) throw e;
    issues.push({ step: 'modules', severity: 'blocking', message: (e as Error).message });
    return { revision: row.revision, issues, impact: null };
  }
}
