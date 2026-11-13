import Anthropic from '@anthropic-ai/sdk';
import { ACTIVATABLE_MODULES, CORE_MODULES, MODULE_DESCRIPTIONS, MODULE_LABELS, type AppModule } from '@ofauria/shared';
import { db } from '../config/database.js';
import { sectorRepository } from '../repositories/sector.repository.js';
import { parseConfigModel, previewConfigModel, type ConfigModel } from './config-templates.js';

/**
 * Configuration en langage naturel (plan Production générique, lot P11).
 *
 * L'administrateur décrit son activité (« je fabrique des meubles sur commande et je
 * vends en showroom ») ; Claude propose secteur de base, modules, options, vocabulaire
 * et types d'étape / d'équipement, sous la forme d'un modèle `kalum.config` (P10).
 *
 * Rien n'est appliqué ici : la proposition repasse par parseConfigModel (sortie d'IA =
 * donnée NON FIABLE, comme un fichier importé), puis l'administrateur choisit
 * « Mettre dans le brouillon » (aperçu d'impact P0b, puis Enregistrer) ou « Ajouter
 * ce secteur » (secteur personnalisé P10). Seul lot du plan qui appelle une IA ; sans
 * clé ANTHROPIC_API_KEY, l'assistant est simplement indisponible.
 */

const MODEL = 'claude-opus-5-5';
export const MAX_DESCRIPTION = 2000;
/** Repli si sector_labels est vide : clés lues par les écrans (mig 514). */
/** Toujours proposés, quelle que soit la description (choix de l'éditeur). */
const ALWAYS_MODULES: AppModule[] = ['accounting', 'employees'];
const DEFAULT_LABEL_KEYS = ['product', 'products', 'recipe', 'recipes', 'production', 'production_plan', 'production_plans', 'new_plan'];

type Ref = { code: string; label: string };
/** Réponse attendue de l'IA (schéma JSON imposé, revalidée ensuite). */
export type AssistantAnswer = {
  name: string;
  base_sector: string;
  modules: string[];
  features: string[];
  labels: { key: string; value: string }[];
  step_types: Ref[];
  equipment_types: Ref[];
  rationale: string;
  questions: string[];
};

/** Appel au modèle, injectable pour les tests. */
export type Completer = (req: { system: string; prompt: string; schema: Record<string, unknown> }) => Promise<string>;

export class AssistantUnavailable extends Error {}

export function assistantConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const claudeCompleter: Completer = async ({ system, prompt, schema }) => {
  if (!assistantConfigured()) throw new AssistantUnavailable('Assistant non configuré : la clé ANTHROPIC_API_KEY est absente du serveur');
  const client = new Anthropic({ timeout: 120_000 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      // Refus des filtres de sécurité : le serveur rejoue sur le modèle de repli recommandé.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AssistantUnavailable('Clé ANTHROPIC_API_KEY refusée');
    if (err instanceof Anthropic.RateLimitError) throw new AssistantUnavailable('Assistant saturé : réessayez dans une minute');
    if (err instanceof Anthropic.APIConnectionError) throw new AssistantUnavailable('Assistant injoignable');
    if (err instanceof Anthropic.APIError) {
      // Le message brut de l'API (anglais, request_id) ne remonte pas à l'écran.
      if (/credit balance/i.test(err.message)) throw new AssistantUnavailable('Crédit Anthropic épuisé : rechargez le compte (Plans & Billing) pour utiliser l\'assistant');
      if (err instanceof Anthropic.PermissionDeniedError) throw new AssistantUnavailable('Clé ANTHROPIC_API_KEY sans accès à ce modèle');
      throw new AssistantUnavailable(`Assistant indisponible (erreur ${err.status ?? 'inconnue'}) : réessayez plus tard`);
    }
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new AssistantUnavailable("L'assistant n'a pas pu traiter cette description");
  if (response.stop_reason === 'max_tokens') throw new AssistantUnavailable('Réponse incomplète : raccourcissez la description');
  const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  if (!text.trim()) throw new AssistantUnavailable("L'assistant n'a rien proposé");
  return text;
};

async function context() {
  const [act, sectors, labelRows] = await Promise.all([
    sectorRepository.activation(),
    sectorRepository.list(),
    db.query(`SELECT DISTINCT label_key FROM sector_labels ORDER BY 1`),
  ]);
  const labelKeys = labelRows.rows.length ? labelRows.rows.map(r => r.label_key as string) : DEFAULT_LABEL_KEYS;
  const modules = ACTIVATABLE_MODULES.filter(m => !CORE_MODULES.has(m));
  return { act, sectors, labelKeys, modules };
}

const refSchema = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false, required: ['code', 'label'],
    properties: { code: { type: 'string', description: 'snake_case, minuscules sans accent' }, label: { type: 'string' } },
  },
};

/** Consigne et schéma : catalogue réel (modules, options, secteurs, clés de vocabulaire). */
export async function buildAssistantRequest(description: string) {
  const { act, sectors, labelKeys, modules } = await context();
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['name', 'base_sector', 'modules', 'features', 'labels', 'step_types', 'equipment_types', 'rationale', 'questions'],
    properties: {
      name: { type: 'string', description: 'Nom court du secteur proposé, ex. « Menuiserie sur commande »' },
      base_sector: { type: 'string', enum: sectors.filter(s => !s.is_custom).map(s => s.code) },
      modules: { type: 'array', items: { type: 'string', enum: modules } },
      features: { type: 'array', items: { type: 'string', enum: act.catalog.map(f => f.key) } },
      labels: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['key', 'value'],
          properties: { key: { type: 'string', enum: labelKeys }, value: { type: 'string' } },
        },
      },
      step_types: refSchema,
      equipment_types: refSchema,
      rationale: { type: 'string' },
      questions: { type: 'array', items: { type: 'string' } },
    },
  };
  const lines = (xs: string[]) => xs.map(x => `- ${x}`).join('\n');
  const system = [
    "Tu configures Kalum, un ERP pour PME marocaines, à partir de la description qu'un administrateur fait de son activité.",
    'Tu proposes une configuration ; l\'administrateur la vérifie avec un aperçu d\'impact avant de l\'appliquer. Réponds en français.',
    '',
    'Secteurs de base (préréglages livrés) :',
    lines(sectors.filter(s => !s.is_custom).map(s => `${s.code} : ${s.label}`)),
    '',
    'Modules activables (les modules socle Tableau de bord, Paramètres et Utilisateurs sont toujours actifs) :',
    lines(modules.map(m => `${m} : ${MODULE_LABELS[m]}${MODULE_DESCRIPTIONS[m] ? ` — ${MODULE_DESCRIPTIONS[m]}` : ''}`)),
    '',
    'Options (une option ne sert que si son module est actif) :',
    lines(act.catalog.map(f => `${f.key} (module ${f.module_key}) : ${f.label}${f.description ? ` — ${f.description}` : ''}`)),
    '',
    `Vocabulaire personnalisable (clé → libellé affiché à l'écran) : ${labelKeys.join(', ')}.`,
    'Exemple : une menuiserie dit « Nomenclature » plutôt que « Fiche technique » pour recipe, et « Ordre de fabrication » pour production_plan.',
    '',
    'Règles :',
    '- Active le minimum utile : un module que la description ne justifie pas reste éteint. Les options propres à l\'alimentaire (DLC, cuisson, vitrine, froid) restent éteintes hors alimentaire.',
    '- accounting (Comptabilité) et employees (Personnel) sont toujours actifs, quelle que soit la description : garde-les dans modules et ne pose pas de question à leur sujet.',
    '- Les dépendances entre modules sont complétées automatiquement : inutile de les deviner.',
    '- step_types et equipment_types : seulement si la société fabrique ; 3 à 6 entrées concrètes pour son métier, sinon listes vides.',
    '- labels : uniquement les libellés qui changent vraiment pour ce métier.',
    '- rationale : 2 à 4 phrases simples qui expliquent les choix principaux.',
    '- questions : au plus 3 points que la description laisse ouverts et qui changeraient la configuration ; liste vide si rien.',
  ].join('\n');
  const prompt = `Description de l'activité :\n<description>\n${description}\n</description>`;
  return { system, prompt, schema };
}

/** Réponse de l'IA → modèle kalum.config brut (revalidé par parseConfigModel). */
export function answerToRawModel(a: AssistantAnswer): Record<string, unknown> {
  return {
    format: 'kalum.config', version: 1,
    name: a.name, base_sector: a.base_sector,
    modules: [...new Set([...(Array.isArray(a.modules) ? a.modules : []), ...ALWAYS_MODULES])], features: a.features,
    labels: Object.fromEntries((Array.isArray(a.labels) ? a.labels : []).map(l => [l?.key, l?.value])),
    home_route: null, report_keys: [],
    starter: { units: [], stepTypes: a.step_types ?? [], equipmentTypes: a.equipment_types ?? [] },
  };
}

/** Écarts à mettre dans le brouillon de l'écran pour obtenir la configuration proposée. */
function draftChanges(model: ConfigModel, act: Awaited<ReturnType<typeof sectorRepository.activation>>) {
  const wantedModules = new Set(model.modules);
  const modules: Record<string, boolean> = {};
  for (const m of ACTIVATABLE_MODULES) {
    if (CORE_MODULES.has(m)) continue;
    const want = wantedModules.has(m);
    if (want !== act.modules.has(m)) modules[m] = want;
  }
  const wantedFeatures = new Set(model.features);
  const features: Record<string, boolean> = {};
  for (const f of act.catalog) {
    if (!wantedModules.has(f.module_key)) continue; // module éteint : l'option suit
    const want = wantedFeatures.has(f.key);
    if (want !== act.features.has(f.key)) features[f.key] = want;
  }
  return { modules, features };
}

type Preview = Exclude<Awaited<ReturnType<typeof previewConfigModel>>, { error: string }>;
export type AssistantResult = {
  model: ConfigModel;
  preview: Preview;
  changes: { modules: Record<string, boolean>; features: Record<string, boolean> };
  rationale: string;
  questions: string[];
};

/** Description libre → proposition de configuration (rien n'est écrit). */
export async function suggestConfig(description: string, complete: Completer = claudeCompleter): Promise<AssistantResult | { error: string }> {
  const text = description.trim();
  if (text.length < 10) return { error: 'Décrivez votre activité en une ou deux phrases' };
  if (text.length > MAX_DESCRIPTION) return { error: `Description trop longue (${MAX_DESCRIPTION} caractères au plus)` };

  const req = await buildAssistantRequest(text);
  const reply = await complete(req); // AssistantUnavailable remonte tel quel
  let answer: AssistantAnswer;
  try {
    answer = JSON.parse(reply) as AssistantAnswer;
  } catch {
    return { error: "Réponse de l'assistant illisible : réessayez" };
  }
  const raw = answerToRawModel(answer);
  const parsed = await parseConfigModel(raw);
  if ('error' in parsed) return parsed;
  const preview = await previewConfigModel(raw); // garde les remarques du filtrage
  if ('error' in preview) return preview;
  const act = await sectorRepository.activation();
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    model: parsed.model,
    preview,
    changes: draftChanges(parsed.model, act),
    rationale: str(answer.rationale, 1200),
    questions: (Array.isArray(answer.questions) ? answer.questions : []).map(q => str(q, 300)).filter(Boolean).slice(0, 3),
  };
}
