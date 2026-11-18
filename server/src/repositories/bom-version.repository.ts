import { db, withTransaction } from '../config/database.js';
import { localIsoDate } from '../utils/local-date.js';

/**
 * Versions de nomenclature (M4-01, mig 559).
 *
 * La fiche courante est la copie de travail ; une version est un instantané figé de son
 * contenu (fn_recipe_bom_snapshot). Une seule version active par fiche. Activer fige le
 * contenu courant en version N+1 active et rend la précédente obsolète la veille de la
 * date d'effet. Les versions active et obsolètes ne sont jamais modifiées (déclencheur).
 */
type Snapshot = {
  header: Record<string, unknown> | null;
  ingredients: { ingredient_id: string; name: string; quantity: number; unit: string | null }[];
  sub_recipes: { sub_recipe_id: string; name: string; quantity: number }[];
  components: { role: string; source_recipe_id: string | null; source_ingredient_id: string | null; name: string; quantite: number; unite: string; perte_pct: number | null }[];
  formats: { format_id: string; contenant_id: string | null; is_default: boolean; components: Snapshot['components'] }[];
  packaging: { packaging_id: string; quantity: number; unit: string | null }[];
};

export type BomDiffLine = { section: string; name: string; before: string | null; after: string | null; change: 'ajout' | 'retrait' | 'quantite' };

/** Lignes comparables d'un instantané : section, clé, libellé, valeur. */
function lines(s: Snapshot) {
  const out = new Map<string, { section: string; name: string; value: string }>();
  for (const i of s.ingredients ?? []) out.set(`ing|${i.ingredient_id}`, { section: 'Ingrédients', name: i.name, value: `${Number(i.quantity)} ${i.unit ?? ''}`.trim() });
  for (const r of s.sub_recipes ?? []) out.set(`sub|${r.sub_recipe_id}`, { section: 'Sous-recettes', name: r.name, value: String(Number(r.quantity)) });
  for (const c of s.components ?? []) out.set(`comp|${c.source_recipe_id ?? c.source_ingredient_id}|${c.role}`, { section: 'Composants', name: c.name, value: `${Number(c.quantite)} ${c.unite}${c.perte_pct ? ` (perte ${Number(c.perte_pct)} %)` : ''}` });
  (s.formats ?? []).forEach((f, idx) => {
    for (const c of f.components ?? []) out.set(`fmt|${f.format_id}|${c.source_recipe_id ?? c.source_ingredient_id}|${c.role}`, { section: `Format ${idx + 1}${f.is_default ? ' (défaut)' : ''}`, name: c.name, value: `${Number(c.quantite)} ${c.unite}` });
  });
  for (const p of s.packaging ?? []) out.set(`pack|${p.packaging_id}`, { section: 'Emballages', name: p.packaging_id, value: `${Number(p.quantity)} ${p.unit ?? ''}`.trim() });
  return out;
}

export function diffSnapshots(a: Snapshot, b: Snapshot): BomDiffLine[] {
  const la = lines(a), lb = lines(b);
  const out: BomDiffLine[] = [];
  for (const [k, v] of la) {
    const w = lb.get(k);
    if (!w) out.push({ section: v.section, name: v.name, before: v.value, after: null, change: 'retrait' });
    else if (w.value !== v.value) out.push({ section: v.section, name: v.name, before: v.value, after: w.value, change: 'quantite' });
  }
  for (const [k, w] of lb) if (!la.has(k)) out.push({ section: w.section, name: w.name, before: null, after: w.value, change: 'ajout' });
  const ha = a.header ?? {}, hb = b.header ?? {};
  for (const key of ['yield_quantity', 'yield_unit', 'perte_standard_pct', 'mode_cout', 'piece_weight_kg']) {
    if (JSON.stringify(ha[key] ?? null) !== JSON.stringify(hb[key] ?? null)) {
      out.push({ section: 'En-tête', name: key, before: ha[key] == null ? null : String(ha[key]), after: hb[key] == null ? null : String(hb[key]), change: 'quantite' });
    }
  }
  return out.sort((x, y) => x.section.localeCompare(y.section) || x.name.localeCompare(y.name));
}

export const bomVersionRepository = {
  /** Versions d'une fiche, et si la copie de travail diffère de la version active. */
  async list(recipeId: string) {
    const versions = (await db.query(
      `SELECT b.id, b.version_no, b.status, b.valid_from::text AS valid_from, b.valid_to::text AS valid_to, b.reason,
              b.unit_cost::float8 AS unit_cost, b.activated_at, b.created_at,
              NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS activated_by_name
         FROM bom_versions b LEFT JOIN users u ON u.id = b.activated_by
        WHERE b.recipe_id = $1 ORDER BY b.version_no DESC`, [recipeId])).rows;
    const pending = (await db.query(
      `SELECT NOT EXISTS (SELECT 1 FROM bom_versions b WHERE b.recipe_id = $1 AND b.status = 'active' AND b.snapshot = fn_recipe_bom_snapshot($1)
                            AND fn_routing_content(b.routing_snapshot) IS NOT DISTINCT FROM fn_routing_content(fn_routing_snapshot(fn_recipe_routing($1)))) AS pending`,
      [recipeId])).rows[0].pending as boolean;
    return { versions, pendingChanges: pending };
  },

  /** Version active d'une fiche à une date (ou aujourd'hui). */
  async activeAt(recipeId: string, date?: string, runner: { query: typeof db.query } = db) {
    const d = date ?? localIsoDate(new Date());
    return (await runner.query(
      `SELECT id, version_no FROM bom_versions
        WHERE recipe_id = $1 AND status IN ('active', 'obsolete') AND valid_from <= $2::date AND (valid_to IS NULL OR valid_to >= $2::date)
        ORDER BY version_no DESC LIMIT 1`, [recipeId, d])).rows[0] as { id: string; version_no: number } | undefined;
  },

  /** Écarts entre la version active et la copie de travail (ce qu'activer changerait). */
  async pendingDiff(recipeId: string) {
    const r = (await db.query(
      `SELECT b.snapshot AS a, fn_recipe_bom_snapshot($1) AS b FROM bom_versions b WHERE b.recipe_id = $1 AND b.status = 'active'`, [recipeId])).rows[0];
    return r ? diffSnapshots(r.a, r.b) : [];
  },

  async compare(recipeId: string, a: number, b: number) {
    const rows = (await db.query(`SELECT version_no, snapshot FROM bom_versions WHERE recipe_id = $1 AND version_no = ANY($2::int[])`, [recipeId, [a, b]])).rows;
    const sa = rows.find(r => r.version_no === a)?.snapshot, sb = rows.find(r => r.version_no === b)?.snapshot;
    if (!sa || !sb) throw new Error('Version introuvable');
    return diffSnapshots(sa, sb);
  },

  /**
   * Fige la copie de travail dans une version BROUILLON (au plus une par fiche) à la date
   * d'effet demandée (aujourd'hui par défaut, jamais dans le futur).
   */
  async createDraft(recipeId: string, input: { reason: string; validFrom?: string }, userId: string) {
    const today = localIsoDate(new Date());
    const validFrom = input.validFrom ?? today;
    if (validFrom > today) throw new Error('La date d\'effet ne peut pas être dans le futur');
    return withTransaction(async () => {
      await db.query(`SELECT id FROM recipes WHERE id = $1 FOR UPDATE`, [recipeId]);
      if ((await db.query(`SELECT 1 FROM bom_versions WHERE recipe_id = $1 AND status = 'brouillon'`, [recipeId])).rows.length) {
        throw new Error('Une nouvelle version est déjà en attente d\'approbation pour cette fiche');
      }
      // M5-01 : une gamme modifiée est une modification de la fiche, comme sa composition.
      const cur = (await db.query(`SELECT version_no, valid_from::text AS valid_from,
                                          snapshot = fn_recipe_bom_snapshot($1)
                                          AND fn_routing_content(routing_snapshot) IS NOT DISTINCT FROM fn_routing_content(fn_routing_snapshot(fn_recipe_routing($1))) AS same
                                     FROM bom_versions WHERE recipe_id = $1 AND status = 'active'`, [recipeId])).rows[0];
      if (cur?.same) throw new Error('Aucune modification depuis la version active');
      if (cur && validFrom < cur.valid_from) throw new Error(`La date d'effet précède celle de la version ${cur.version_no}`);
      const next = Number((await db.query(`SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM bom_versions WHERE recipe_id = $1`, [recipeId])).rows[0].n);
      return (await db.query(
        `INSERT INTO bom_versions (recipe_id, version_no, status, valid_from, reason, snapshot, unit_cost, created_by, routing_id, routing_snapshot)
         SELECT $1, $2, 'brouillon', $3::date, $4, fn_recipe_bom_snapshot($1),
                (SELECT v.total_cost / NULLIF(r.yield_quantity, 0) FROM v_recipe_total_cost_v2 v JOIN recipes r ON r.id = v.id WHERE v.id = $1), $5,
                fn_recipe_routing($1), fn_routing_snapshot(fn_recipe_routing($1))
         RETURNING id, recipe_id, version_no, status, valid_from::text AS valid_from, unit_cost::float8 AS unit_cost`,
        [recipeId, next, validFrom, input.reason, userId])).rows[0] as { id: string; recipe_id: string; version_no: number; status: string; valid_from: string; unit_cost: number | null };
    });
  },

  /** Le brouillon devient la version active ; l'active devient obsolète la veille de sa date d'effet. */
  async promote(versionId: string, actorId: string) {
    return withTransaction(async () => {
      const d = (await db.query(`SELECT id, recipe_id, version_no, valid_from::text AS valid_from FROM bom_versions WHERE id = $1 AND status = 'brouillon' FOR UPDATE`, [versionId])).rows[0];
      if (!d) throw new Error('Cette version n\'est plus en attente');
      const today = localIsoDate(new Date());
      const cur = (await db.query(`SELECT id, valid_from::text AS valid_from FROM bom_versions WHERE recipe_id = $1 AND status = 'active' FOR UPDATE`, [d.recipe_id])).rows[0];
      // Une approbation tardive ne peut pas antidater au-delà de la version en place.
      const validFrom = cur && d.valid_from < cur.valid_from ? today : d.valid_from;
      if (cur) await db.query(`UPDATE bom_versions SET status = 'obsolete', valid_to = $2::date - 1 WHERE id = $1`, [cur.id, validFrom]);
      return (await db.query(
        `UPDATE bom_versions SET status = 'active', valid_from = $2::date, activated_by = $3, activated_at = now() WHERE id = $1
         RETURNING id, version_no, status, valid_from::text AS valid_from`, [versionId, validFrom, actorId])).rows[0];
    });
  },

  /** Retire un brouillon (demande refusée ou abandonnée). */
  async discardDraft(versionId: string) {
    await db.query(`DELETE FROM bom_versions WHERE id = $1 AND status = 'brouillon'`, [versionId]);
  },

  /** Impact d'un brouillon : coût avant / après, allergènes avant / après, ordres ouverts. */
  async impact(versionId: string) {
    const r = (await db.query(
      `WITH d AS (SELECT * FROM bom_versions WHERE id = $1),
            a AS (SELECT b.* FROM bom_versions b, d WHERE b.recipe_id = d.recipe_id AND b.status = 'active'),
            alg AS (
              SELECT src, array_agg(DISTINCT x ORDER BY x) AS allergens FROM (
                SELECT 'after' AS src, unnest(g.allergens) AS x FROM d, ingredients g
                 WHERE g.id::text IN (SELECT jsonb_array_elements(d.snapshot->'ingredients')->>'ingredient_id'
                                      UNION SELECT jsonb_array_elements(d.snapshot->'components')->>'source_ingredient_id'
                                      UNION SELECT jsonb_array_elements(f->'components')->>'source_ingredient_id' FROM jsonb_array_elements(d.snapshot->'formats') f)
                UNION ALL
                SELECT 'before', unnest(g.allergens) FROM a, ingredients g
                 WHERE g.id::text IN (SELECT jsonb_array_elements(a.snapshot->'ingredients')->>'ingredient_id'
                                      UNION SELECT jsonb_array_elements(a.snapshot->'components')->>'source_ingredient_id'
                                      UNION SELECT jsonb_array_elements(f->'components')->>'source_ingredient_id' FROM jsonb_array_elements(a.snapshot->'formats') f)
              ) z GROUP BY src)
       SELECT d.recipe_id, d.version_no, d.reason, d.valid_from::text AS valid_from, r.name AS recipe_name,
              a.unit_cost::float8 AS cost_before, d.unit_cost::float8 AS cost_after,
              COALESCE((SELECT allergens FROM alg WHERE src = 'before'), '{}') AS allergens_before,
              COALESCE((SELECT allergens FROM alg WHERE src = 'after'), '{}') AS allergens_after,
              (SELECT COUNT(DISTINCT pp.id)::int FROM production_plan_items ppi JOIN production_plans pp ON pp.id = ppi.plan_id
                WHERE pp.status IN ('draft', 'confirmed', 'awaiting_ingredients', 'ready_to_produce')
                  AND (ppi.base_recipe_id = d.recipe_id OR ppi.product_id = r.product_id)) AS open_orders
         FROM d JOIN recipes r ON r.id = d.recipe_id LEFT JOIN a ON true`, [versionId])).rows[0];
    const before = Number(r.cost_before) || 0, after = Number(r.cost_after) || 0;
    const added = (r.allergens_after as string[]).filter(x => !(r.allergens_before as string[]).includes(x));
    return { ...r, cost_change_pct: before > 0 ? Math.round(Math.abs(after - before) / before * 1000) / 10 : 0, allergens_added: added };
  },

  /** Activation directe (sans circuit) : brouillon puis passage à l'état actif. */
  async activate(recipeId: string, input: { reason: string; validFrom?: string }, userId: string) {
    const draft = await this.createDraft(recipeId, input, userId);
    return this.promote(draft.id, userId);
  },

  /**
   * M4-02 (reste) — exécute `fn` (un calcul de besoins en LECTURE) comme si chaque fiche de
   * l'arborescence (`rootIds` et leurs bases, composants, formats) avait le contenu de sa
   * version en vigueur à `date`. Les fiches modifiées sans nouvelle version active sont
   * rejouées (fn_bom_snapshot_apply, mig 593) dans un point de sauvegarde, annulé après `fn` :
   * la fiche courante n'est jamais modifiée. `fn` ne doit rien écrire (ses écritures seraient
   * annulées) : les sorties de stock se font après, à partir de son résultat.
   * Sans fiche modifiée, aucun point de sauvegarde. `notReplayable` : versions dont un format
   * a été supprimé — le calcul garde alors la fiche courante.
   */
  async withVersionsInForce<T>(client: { query: typeof db.query }, rootIds: string[], date: string, fn: () => Promise<T>):
    Promise<{ result: T; replayed: string[]; notReplayable: string[] }> {
    const replayed: string[] = [];
    const notReplayable: string[] = [];
    const seen = new Set<string>();
    let frontier = [...new Set(rootIds.filter(Boolean))];
    let opened = false;
    const sp = 'm4_02_bom_versions';
    try {
      while (frontier.length) {
        frontier.forEach(id => seen.add(id));
        const inForce = (await client.query(
          `SELECT DISTINCT ON (b.recipe_id) b.recipe_id, b.version_no, r.name, b.snapshot,
                  b.snapshot = fn_recipe_bom_snapshot(b.recipe_id) AS same
             FROM bom_versions b JOIN recipes r ON r.id = b.recipe_id
            WHERE b.recipe_id = ANY($1::uuid[]) AND b.status IN ('active', 'obsolete')
              AND b.valid_from <= $2::date AND (b.valid_to IS NULL OR b.valid_to >= $2::date)
            ORDER BY b.recipe_id, b.version_no DESC`, [frontier, date])).rows;
        for (const v of inForce) {
          if (v.same) continue;
          if (!opened) { await client.query(`SAVEPOINT ${sp}`); opened = true; }
          const ok = (await client.query(`SELECT fn_bom_snapshot_apply($1, $2::jsonb) AS ok`, [v.recipe_id, JSON.stringify(v.snapshot)])).rows[0].ok;
          (ok ? replayed : notReplayable).push(`${String(v.name).trim()} v${v.version_no}`);
        }
        // Bases et sous-ensembles de ces fiches (contenu rejoué compris), pas encore vus.
        const children = (await client.query(
          `SELECT sub_recipe_id AS id FROM recipe_sub_recipes WHERE recipe_id = ANY($1::uuid[])
           UNION SELECT source_recipe_id FROM recipe_components WHERE recipe_id = ANY($1::uuid[]) AND source_recipe_id IS NOT NULL
           UNION SELECT fc.source_recipe_id FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id
                  WHERE f.recipe_id = ANY($1::uuid[]) AND fc.source_recipe_id IS NOT NULL`, [frontier])).rows
          .map(r => r.id as string);
        frontier = [...new Set(children)].filter(id => !seen.has(id));
      }
      const result = await fn();
      return { result, replayed, notReplayable };
    } finally {
      if (opened) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      }
    }
  },
};
