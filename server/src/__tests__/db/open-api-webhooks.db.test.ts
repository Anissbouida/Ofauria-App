/**
 * G6-08 — API ouverte (description OpenAPI générée, événements de webhook).
 *  - la description liste les points publics, avec le corps de POST /v1/orders généré depuis
 *    le schéma de validation (customerName, items requis…) et un webhook par événement du catalogue ;
 *  - la page de documentation est servie sans script externe ;
 *  - un point abonné aux événements de production reçoit « ordre confirmé » puis « lot produit »
 *    et « ordre terminé » (livraisons en file, signées) ; un non-abonné ne reçoit rien.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('API ouverte et webhooks (G6-08)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let oa: typeof import('../../services/openapi.js');
  let wh: typeof import('../../repositories/webhook.repository.js')['webhookRepository'];
  let fx: Fixtures; let productId: string; let epId: string; let otherId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    oa = await import('../../services/openapi.js');
    wh = (await import('../../repositories/webhook.repository.js')).webhookRepository;
    fx = await createBaseFixtures();
    productId = (await createProductWithRecipe(fx, { name: `Pain G608 ${RUN}`, price: 2, ingredients: [] })).productId;
    epId = (await wh.createEndpoint({ label: `Prod G608 ${RUN}`, url: 'https://exemple.test/hook', events: ['production.order_confirmed', 'production.lot_created', 'production.order_completed'] })).id;
    otherId = (await wh.createEndpoint({ label: `Autre G608 ${RUN}`, url: 'https://exemple.test/autre', events: ['order.status_changed'] })).id;
  }, 60_000);

  afterAll(async () => {
    for (const id of [epId, otherId]) if (id) await wh.setActive(id, false).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('description OpenAPI générée et documentation', () => {
    const spec = oa.buildOpenApi() as Record<string, any>;
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(['/v1/ping', '/v1/products', '/v1/orders']);
    const body = spec.paths['/v1/orders'].post.requestBody.content['application/json'].schema;
    expect(body.required).toEqual(['items']);
    // zod 4 (z.toJSONSchema) : un champ nullable s'écrit anyOf [chaîne, null] (OpenAPI 3.1).
    expect(body.properties.customerName.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'string', maxLength: 200 }), { type: 'null' }]));
    expect(body.properties.items).toMatchObject({ type: 'array', minItems: 1, maxItems: 200 });
    expect(body.additionalProperties).toBe(false);
    expect(Object.keys(spec.webhooks)).toContain('production.lot_created');
    const html = oa.renderDocsHtml(oa.buildOpenApi());
    expect(html).toContain('production.order_completed');
    expect(html).not.toMatch(/<script/i);
  });

  it('événements de production en file pour le point abonné seulement', async () => {
    const pl = await repos.productionRepository.create({ planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 3 }] });
    fx.ids.plans.push(pl.id);
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [pl.id])).rows[0].id;
    await repos.productionRepository.confirm(pl.id, fx.userId);
    await repos.productionRepository.start(pl.id, fx.userId);
    await repos.productionRepository.produceItems(pl.id, [{ planItemId: itemId, actualQuantity: 3 }], fx.userId, fx.storeId);
    const mine = (await p().query(
      `SELECT event, signature, payload->'data'->>'plan_id' AS plan_id FROM webhook_deliveries WHERE endpoint_id = $1 AND payload->'data'->>'plan_id' = $2 ORDER BY created_at, event`, [epId, pl.id])).rows;
    expect(mine.map(d => d.event).sort()).toEqual(['production.lot_created', 'production.order_completed', 'production.order_confirmed']);
    expect(mine.every(d => /^[0-9a-f]{64}$/.test(d.signature))).toBe(true);
    expect((await p().query(`SELECT count(*)::int AS n FROM webhook_deliveries WHERE endpoint_id = $1 AND payload->'data'->>'plan_id' = $2`, [otherId, pl.id])).rows[0].n).toBe(0);
  });
});
