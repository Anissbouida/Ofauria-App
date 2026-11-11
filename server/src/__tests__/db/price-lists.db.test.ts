/**
 * Phase 6.1–6.3 (mig 486) — listes de prix, paliers, résolution prioritaire.
 *
 *  - la liste la plus SPÉCIFIQUE en vigueur gagne (client > groupe > type > canal > générale) ;
 *  - au sein d'une liste, le bon palier de quantité s'applique ;
 *  - une liste hors validité est ignorée ;
 *  - sans aucune liste, la résolution renvoie null (le prix catalogue s'applique).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { resolveSalePrice, priceContextForCustomer } from '../../services/pricing.service.js';

describe.skipIf(!hasTestDb)('Listes de prix — résolution', () => {
  const p = () => testPool();
  let productId: string;
  let channelId: string;
  let customerId: string;
  const createdLists: string[] = [];

  const addList = async (targets: Record<string, any>, price: number, minQty = 0) => {
    const l = (await p().query(
      `INSERT INTO price_lists (name, channel_id, customer_type, price_group, customer_id, valid_from, valid_to, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0)) RETURNING id`,
      [`L ${RUN} ${createdLists.length}`, targets.channelId ?? null, targets.customerType ?? null,
       targets.priceGroup ?? null, targets.customerId ?? null, targets.validFrom ?? null, targets.validTo ?? null, targets.priority ?? null])).rows[0].id;
    createdLists.push(l);
    await p().query(`INSERT INTO price_list_items (price_list_id, product_id, min_quantity, unit_price) VALUES ($1,$2,$3,$4)`, [l, productId, minQty, price]);
    return l;
  };

  beforeAll(async () => {
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,50) RETURNING id`, [`Prod Pl ${RUN}`, `prod-pl-${RUN}`])).rows[0].id;
    channelId = (await p().query(`INSERT INTO sales_channels (code, label) VALUES ($1,$2) RETURNING id`, [`pl-${RUN}`.slice(0, 40), `Canal ${RUN}`])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type, price_group) VALUES ('Pro','Pl ${RUN}','professionnel',$1) RETURNING id`, [`Hotels ${RUN}`.slice(0, 40)])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM price_list_items WHERE price_list_id = ANY($1)`, [createdLists]).catch(() => undefined);
    await p().query(`DELETE FROM price_lists WHERE id = ANY($1)`, [createdLists]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
    await p().query(`DELETE FROM sales_channels WHERE id = $1`, [channelId]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await closeTestPool();
  });

  it('sans liste : renvoie null', async () => {
    expect(await resolveSalePrice(p(), productId, 1, { channelId })).toBeNull();
  });

  it('choisit la liste la plus spécifique', async () => {
    await addList({}, 50);                                   // générale
    await addList({ channelId }, 45);                        // canal
    await addList({ customerType: 'professionnel' }, 40);    // type
    await addList({ customerId }, 35);                       // client précis
    const ctx = await priceContextForCustomer(p(), customerId, channelId);
    const r = await resolveSalePrice(p(), productId, 1, ctx);
    expect(r?.unitPrice).toBe(35); // client précis l'emporte
    // Sans client : le canal l'emporte sur la générale.
    const r2 = await resolveSalePrice(p(), productId, 1, { channelId });
    expect(r2?.unitPrice).toBe(45);
  });

  it('applique le bon palier de quantité', async () => {
    const l = await addList({ priceGroup: `Tiers ${RUN}` }, 30, 0);
    await p().query(`INSERT INTO price_list_items (price_list_id, product_id, min_quantity, unit_price) VALUES ($1,$2,500,25)`, [l, productId]);
    const ctx = { priceGroup: `Tiers ${RUN}` };
    expect((await resolveSalePrice(p(), productId, 100, ctx))?.unitPrice).toBe(30);
    expect((await resolveSalePrice(p(), productId, 800, ctx))?.unitPrice).toBe(25);
  });

  it('ignore une liste hors validité', async () => {
    // La liste expirée (10) ciblerait ce groupe, mais elle est hors validité : la liste
    // générale (50, créée plus haut) s'applique à la place — l'expirée est bien ignorée.
    await addList({ priceGroup: `Expire ${RUN}`, validFrom: '2020-01-01', validTo: '2020-12-31' }, 10);
    const r = await resolveSalePrice(p(), productId, 1, { priceGroup: `Expire ${RUN}` });
    expect(r?.unitPrice).toBe(50);
  });
});
