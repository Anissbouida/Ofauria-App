import { db } from '../../config/database.js';
import { storeRepository } from '../../repositories/store.repository.js';
import type { WizardAnswers, WizardIssue } from './steps.js';

/**
 * Lot 3 — établissements préparés dans l'assistant (étape Entreprise), créés à la
 * publication par le dépôt existant. Réponses : company.data['store:<n>:name|kind|city'].
 * Un établissement existant n'est jamais modifié ici.
 */
export const STORE_KEY = /^store:(\d{1,2}):(name|kind|city)$/;
export const STORE_KINDS = ['shop', 'workshop', 'warehouse', 'office', 'mixed'] as const;

export function wizardStores(answers: WizardAnswers) {
  const byIndex = new Map<number, { name: string; kind: string; city: string }>();
  for (const [key, v] of Object.entries(answers.company?.data ?? {})) {
    const m = STORE_KEY.exec(key);
    if (!m || typeof v !== 'string') continue;
    const cur = byIndex.get(Number(m[1])) ?? { name: '', kind: 'shop', city: '' };
    cur[m[2] as 'name' | 'kind' | 'city'] = v.trim();
    byIndex.set(Number(m[1]), cur);
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s).filter(s => s.name || s.city);
}

export async function existingStoreNames(): Promise<string[]> {
  return (await db.query(`SELECT name FROM stores`)).rows.map(r => String(r.name).toLowerCase());
}

export function storeIssues(answers: WizardAnswers, existing: string[]): WizardIssue[] {
  const issues: WizardIssue[] = [];
  const seen = new Set<string>();
  for (const s of wizardStores(answers)) {
    if (!s.name) { issues.push({ step: 'company', severity: 'blocking', message: 'Un établissement à créer n’a pas de nom.' }); continue; }
    if (s.name.length > 200) issues.push({ step: 'company', severity: 'blocking', message: `Nom d’établissement trop long : ${s.name.slice(0, 40)}…` });
    if (!(STORE_KINDS as readonly string[]).includes(s.kind)) issues.push({ step: 'company', severity: 'blocking', message: `Type d’établissement inconnu pour « ${s.name} ».` });
    const k = s.name.toLowerCase();
    if (existing.includes(k) || seen.has(k)) issues.push({ step: 'company', severity: 'blocking', message: `L’établissement « ${s.name} » existe déjà.` });
    seen.add(k);
  }
  return issues;
}

/** Publication : création des établissements préparés, dans la transaction ambiante. */
export async function applyWizardStores(answers: WizardAnswers, actor: string) {
  const created: string[] = [];
  for (const s of wizardStores(answers)) {
    if (!s.name) continue;
    await storeRepository.create({ name: s.name, kind: s.kind, city: s.city || null }, actor);
    created.push(s.name);
  }
  return created;
}
