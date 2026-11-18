/**
 * M8-05 — l'aperçu en direct de l'éditeur de gamme (formule partagée routingOpMinutes)
 * donne les mêmes minutes que fn_routing_op_minutes (mig 566), qui fait foi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { routingOpMinutes } from '@ofauria/shared';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Temps de gamme : parité SQL / aperçu (M8-05)', () => {
  const p = () => testPool();
  let routingId = '';
  const ops = [
    { setup: 10, duration: 5, labor: 0.75, machine: 0.2, base: 1 },
    { setup: 0, duration: 0, labor: 12.5, machine: 3, base: 7 },
    { setup: 3.33, duration: 1, labor: 0.333, machine: 0, base: 3 }, // duration_min : entier
  ];
  const opIds: string[] = [];

  beforeAll(async () => {
    routingId = (await p().query(`INSERT INTO routings (name) VALUES ($1) RETURNING id`, [`M805 parité ${RUN}`])).rows[0].id;
    for (const [i, o] of ops.entries()) {
      opIds.push((await p().query(
        `INSERT INTO routing_operations (routing_id, sequence, operation_name, setup_min, duration_min, labor_min_per_unit, machine_min_per_unit, base_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [routingId, i + 1, `op ${i + 1}`, o.setup, o.duration, o.labor, o.machine, o.base])).rows[0].id);
    }
  });

  afterAll(async () => {
    await p().query(`DELETE FROM routings WHERE id = $1`, [routingId]).catch(() => undefined);
    await closeTestPool();
  });

  it('mêmes minutes pour plusieurs quantités', async () => {
    for (const qty of [1, 12, 37.5, 250]) {
      for (const [i, id] of opIds.entries()) {
        const sql = (await p().query(`SELECT labor_min::float8 AS labor, machine_min::float8 AS machine FROM fn_routing_op_minutes($1, $2)`, [id, qty])).rows[0];
        const o = ops[i];
        const ts = routingOpMinutes({ setupMin: o.setup, durationMin: o.duration, laborMinPerUnit: o.labor, machineMinPerUnit: o.machine, baseQuantity: o.base }, qty);
        expect(ts).toEqual({ labor: sql.labor, machine: sql.machine });
      }
    }
  });
});
