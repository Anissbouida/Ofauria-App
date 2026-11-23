/**
 * Mig 651 : deux quantités de crème pâtissière manifestement fausses, corrigées sur valeur
 * exacte (Amandine 1 g → 1 kg ; Tarte aux amandes 22 g → 242 g). Toute autre ligne reste.
 * Déroulé dans une transaction annulée : la migration vise des noms de fiche précis.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = fs.readFileSync(path.join(here, '../../../migrations/651_quantites_creme_patissiere.sql'), 'utf8');

describe.skipIf(!hasTestDb)('Mig 651 — quantités de crème pâtissière', () => {
  afterAll(async () => { await closeTestPool(); });

  it('corrige les deux valeurs fautives et rien d\'autre', async () => {
    const c = await testPool().connect();
    try {
      await c.query('BEGIN');
      const recipe = async (name: string, base = false) => (await c.query(
        `INSERT INTO recipes (name, is_base, yield_quantity, yield_unit, mode_cout) VALUES ($1, $2, $3, $4, 'compose') RETURNING id`,
        [name, base, base ? 1560 : 22, base ? 'g' : 'unit'])).rows[0].id as string;
      const fmt = async (rid: string) => (await c.query(
        `INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite, nb_par_defaut, is_default, is_active)
         VALUES ($1, NULL, 1, 'g', 1, true, true) RETURNING id`, [rid])).rows[0].id as string;
      const line = (f: string, src: string, q: number, u: string) => c.query(
        `INSERT INTO recipe_format_components (format_id, source_recipe_id, quantite, unite, ordre, perte_pct) VALUES ($1, $2, $3, $4, 0, 0) RETURNING id`,
        [f, src, q, u]).then(r => r.rows[0].id as string);
      const qty = async (id: string) => (await c.query(`SELECT quantite::float8 AS q, unite FROM recipe_format_components WHERE id = $1`, [id])).rows[0];

      const creme = await recipe('Crème pâtissière', true);
      const autre = await recipe('Crème d\'amande test 651', true);
      const fAmandine = await fmt(await recipe('Amandine'));
      const fTarte = await fmt(await recipe('Tarte aux amandes'));
      const fAutre = await fmt(await recipe('Autre fiche 651'));
      const a1 = await line(fAmandine, creme, 1, 'g');
      const a2 = await line(fAmandine, autre, 1, 'g');      // autre base : inchangée
      const t1 = await line(fTarte, creme, 22, 'g');
      const o1 = await line(fAutre, creme, 1, 'g');         // autre fiche : inchangée

      await c.query(MIG);
      expect(await qty(a1)).toEqual({ q: 1, unite: 'kg' });
      expect(await qty(a2)).toEqual({ q: 1, unite: 'g' });
      expect(await qty(t1)).toEqual({ q: 242, unite: 'g' });
      expect(await qty(o1)).toEqual({ q: 1, unite: 'g' });

      await c.query(MIG); // rejouée : plus rien ne correspond
      expect(await qty(a1)).toEqual({ q: 1, unite: 'kg' });
      expect(await qty(t1)).toEqual({ q: 242, unite: 'g' });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
