/**
 * Configuration en langage naturel (P11) : la consigne porte le catalogue réel, la
 * réponse de l'IA (ici simulée) est filtrée comme un fichier importé, et donne un
 * brouillon d'écarts ou un secteur personnalisé. Aucun appel réseau dans ce test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Assistant de configuration', () => {
  let ai: typeof import('../../services/config-assistant.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const p = () => testPool();

  const answer = {
    name: 'P11 Menuiserie',
    base_sector: 'fabrication',
    modules: ['production', 'orders', 'customers', 'pirate'],
    features: ['dlc_jour', 'inconnue'],
    labels: [{ key: 'recipe', value: 'Nomenclature' }, { key: 'bad key!', value: 'x' }],
    step_types: [{ code: 'debit', label: 'Débit' }, { code: 'BAD CODE', label: 'x' }],
    equipment_types: [{ code: 'scie', label: 'Scie à format' }],
    rationale: 'Fabrication sur commande : production et commandes.',
    questions: ['Vendez-vous aussi en ligne ?', 'Q2', 'Q3', 'Q4 de trop'],
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ai = await import('../../services/config-assistant.js');
  });

  afterAll(async () => {
    await p().query(`DELETE FROM sector_packs WHERE is_custom AND label LIKE 'P11 %'`).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la consigne porte le catalogue réel et la description', async () => {
    const req = await ai.buildAssistantRequest('Je fabrique des meubles sur commande');
    const props = (req.schema as { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }> }).properties;
    expect(props.modules.items?.enum).toEqual(expect.arrayContaining(['production', 'orders']));
    expect(props.modules.items?.enum).not.toContain('settings');
    expect(props.base_sector.enum).toContain('fabrication');
    expect((props.features.items?.enum ?? []).length).toBeGreaterThan(0);
    expect(req.prompt).toContain('meubles sur commande');
    expect(req.system).toMatch(/production : /);
  });

  it('la réponse est filtrée et donne un brouillon d\'écarts', async () => {
    let seen = '';
    const r = await ai.suggestConfig('Je fabrique des meubles sur commande et je vends en showroom', async (req) => {
      seen = req.prompt;
      return JSON.stringify(answer);
    });
    if ('error' in r) throw new Error(r.error);
    expect(seen).toContain('showroom');
    // Module inconnu écarté, dépendances complétées, vocabulaire et étapes nettoyés.
    expect(r.model.modules).toEqual(expect.arrayContaining(['production', 'recipes', 'stock', 'orders']));
    expect(r.model.modules).not.toContain('pirate');
    expect(r.model.labels).toEqual({ recipe: 'Nomenclature' });
    expect(r.model.starter.stepTypes).toEqual([{ code: 'debit', label: 'Débit', metadata: {} }]);
    expect(r.preview.warnings.join(' ')).toMatch(/Modules inconnus ignorés : pirate/);
    expect(r.questions).toHaveLength(3);
    expect(r.rationale).toContain('commande');

    // Le brouillon n'écrit rien : appliquer ses écarts donne exactement les modules proposés.
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    const act = await sectorRepository.activation();
    const after = new Set<string>(act.modules);
    for (const [m, on] of Object.entries(r.changes.modules)) { if (on) after.add(m); else after.delete(m); }
    for (const m of r.model.modules) expect(after.has(m)).toBe(true);
    expect(Object.keys(r.changes.modules)).not.toContain('settings');

    // Ou bien : la proposition devient un secteur personnalisé (P10).
    const tpl = await import('../../services/config-templates.js');
    const saved = await tpl.saveModelAsSector(r.model);
    if ('error' in saved) throw new Error(saved.error);
    expect(saved.code).toBe('perso_p11_menuiserie');
  });

  it('description trop courte, réponse illisible, assistant sans clé', async () => {
    expect(await ai.suggestConfig('court', async () => '{}')).toEqual({ error: 'Décrivez votre activité en une ou deux phrases' });
    expect(await ai.suggestConfig('Je fabrique des meubles', async () => 'pas du json'))
      .toEqual({ error: 'Réponse de l\'assistant illisible : réessayez' });

    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      expect(ai.assistantConfigured()).toBe(false);
      await expect(ai.suggestConfig('Je fabrique des meubles sur commande')).rejects.toBeInstanceOf(ai.AssistantUnavailable);
    } finally {
      if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });
});
