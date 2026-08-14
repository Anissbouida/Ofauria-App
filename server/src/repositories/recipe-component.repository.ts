import { db } from '../config/database.js';

export interface ComponentInput {
  role?: string | null;
  sourceRecipeId?: string | null;
  sourceIngredientId?: string | null;
  quantite: number;
  unite: string;
  ordre: number;
  /** Mig 265 (audit A5) : perte % par ligne (0-99.99), defaut 0. */
  pertePct?: number | null;
}

export interface ReplacePayload {
  components: ComponentInput[];
  nbParDefaut?: number | null;
  nbParts?: number | null;
  poidsCruG?: number | null;
  poidsCuitG?: number | null;
}

export interface FinanceInput {
  marginMultiplier?: number | null;
  tauxMainOeuvreDhH?: number | null;
  mainOeuvreMin?: number | null;
  coutEnergieFournee?: number | null;
  tauxFraisStructurePct?: number | null;
  perteStandardPct?: number | null;
  compoParPiece?: boolean | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

// Détail financier PAR PIÈCE (la composition est par pièce, cf mig 206).
//   MO/fournée   = (durée_min / 60) × taux ; durée = main_oeuvre_min sinon Σ étapes
//   structure    = (matière + MO + énergie) × taux_structure/100   (comme v_recipe_format_cost)
//   prix         = coût de production × multiplicateur de vente
//   marge brute  = prix − coût de production
function computeFinance(row: Record<string, unknown>) {
  // Rendement = pièces/fournée. Source unique : pieces_par_fournee saisi, sinon le
  // rendement du format (nb_par_defaut), sinon yield_quantity (recettes sans format).
  const pieces = Math.max(1, num(row.pieces_par_fournee) || num(row.format_nb_par_defaut) || num(row.yield_quantity) || 1);
  // total_cost = somme de la composition. Par pièce → c'est déjà le coût d'1 pièce.
  // Par fournée → c'est le coût du lot entier ⇒ on divise par le rendement.
  const totalCompo = num(row.total_cost);
  const matiere = row.compo_par_piece === true ? totalCompo : totalCompo / pieces;
  const dureeMin = row.main_oeuvre_min != null ? num(row.main_oeuvre_min) : num(row.duree_etapes_min);
  const moFournee = (dureeMin / 60) * num(row.taux_main_oeuvre_dh_h);
  const energieFournee = num(row.cout_energie_fournee);
  const moPiece = moFournee / pieces;
  const energiePiece = energieFournee / pieces;
  const base = matiere + moPiece + energiePiece;
  const structPiece = base * (num(row.taux_frais_structure_pct) / 100);
  const coutProduction = base + structPiece;
  const multiplicateur = num(row.margin_multiplier) || 3;
  const prix = coutProduction * multiplicateur;
  const margeBrute = prix - coutProduction;
  return {
    matiere_piece: matiere,
    mo_piece: moPiece,
    energie_piece: energiePiece,
    struct_piece: structPiece,
    cout_production_piece: coutProduction,
    prix_piece: prix,
    marge_brute_piece: margeBrute,
    marge_pct: prix > 0 ? (margeBrute / prix) * 100 : 0,
  };
}

// Normalise une ligne enfant (composant ou legacy) pour le dépliage en arbre.
function toChild(r: Record<string, unknown>) {
  const type = r.source_type as 'recipe' | 'ingredient';
  return {
    type,
    role: (r.role as string | null) ?? null,
    source_id: (r.source_recipe_id ?? r.source_ingredient_id ?? null) as string | null,
    name: r.source_name as string,
    quantite: r.quantite,
    unite: r.unite,
    cout_dh: r.cout_dh,
    expandable: type === 'recipe', // seules les (sous-)recettes se déplient
  };
}

export const recipeComponentRepository = {
  // Rôles configurables (ref_entries table_id='component_roles')
  async listRoles() {
    const r = await db.query(
      `SELECT code, label, description, display_order
       FROM ref_entries
       WHERE table_id = 'component_roles' AND is_active = true
       ORDER BY display_order, label`
    );
    return r.rows;
  },

  // Sources possibles pour un composant : recettes de base + ingrédients,
  // avec leur coût unitaire (pour le recalcul en direct côté client).
  async listSources() {
    const recipes = await db.query(
      `SELECT r.id, r.name, r.yield_unit, r.yield_quantity,
              CASE WHEN COALESCE(r.yield_quantity, 0) > 0
                   THEN vtc.total_cost / (r.yield_quantity * (1 - COALESCE(r.perte_standard_pct, 0) / 100))
                   ELSE 0 END AS cout_unitaire
       FROM recipes r
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
       WHERE r.is_base = true
       ORDER BY r.name`
    );
    const ingredients = await db.query(
      // densite_kg_l : necessaire cote client pour re-valider en direct la
      // conversion d'unite d'un composant (badge « conversion douteuse » mig 260)
      // sans attendre la sauvegarde.
      `SELECT id, name, unit, unit_cost, densite_kg_l FROM ingredients ORDER BY name`
    );
    return { recipes: recipes.rows, ingredients: ingredients.rows };
  },

  // Nomenclature d'un format + finance PAR FORMAT (rendement = nb_par_defaut du format).
  async findByFormat(recipeId: string, formatId: string) {
    const fmt = await db.query(
      `SELECT f.id, f.recipe_id, f.contenant_id, f.nb_par_defaut, f.nb_parts,
              f.poids_cru_g, f.poids_cuit_g, f.cout_emballage_unitaire, f.is_default,
              f.densite_kg_l,
              pc.nom AS contenant_nom,
              r.name AS recipe_name, r.mode_cout, r.compo_par_piece,
              r.margin_multiplier, r.taux_main_oeuvre_dh_h, r.main_oeuvre_min,
              r.cout_energie_fournee, r.taux_frais_structure_pct, r.perte_standard_pct,
              r.yield_quantity, pdef.image_url AS product_image,
              COALESCE((SELECT SUM((s->>'duree_estimee_min')::numeric)
                        FROM jsonb_array_elements(COALESCE(r.etapes, '[]'::jsonb)) s), 0) AS duree_etapes_min,
              -- Mig 263 (audit A1) : produit vendu au POS pour ce format + prix pratique.
              -- Voir listFormats() pour la meme regle de resolution (pos_price_source).
              COALESCE(f.product_id, CASE WHEN f.is_default THEN r.product_id END) AS pos_product_id,
              CASE
                WHEN f.product_id IS NOT NULL THEN 'format'
                WHEN f.is_default AND r.product_id IS NOT NULL THEN 'recipe'
                ELSE 'none'
              END AS pos_price_source,
              ppos.name  AS pos_product_name,
              ppos.price AS pos_price
       FROM recipe_formats f
       JOIN recipes r ON r.id = f.recipe_id
       LEFT JOIN products pdef ON pdef.id = r.product_id
       LEFT JOIN products ppos ON ppos.id = COALESCE(f.product_id, CASE WHEN f.is_default THEN r.product_id END)
       LEFT JOIN production_contenants pc ON pc.id = f.contenant_id
       WHERE f.id = $1 AND f.recipe_id = $2`,
      [formatId, recipeId]
    );
    if (fmt.rows.length === 0) return null;

    const components = await db.query(
      `SELECT c.id, c.role, c.source_recipe_id, c.source_ingredient_id,
              COALESCE(br.name, ing.name) AS source_name,
              CASE WHEN c.source_recipe_id IS NOT NULL THEN 'recipe' ELSE 'ingredient' END AS source_type,
              c.quantite, c.unite, c.ordre,
              cc.cout_dh,
              -- Mig 260 : false = conversion d'unite repliee sur 1 (unites incompatibles
              -- ou densite manquante) -> cout_dh probablement faux, l'UI doit signaler.
              cc.conversion_ok,
              COALESCE(ing.unit::text, br.yield_unit) AS target_unit,
              -- Mig 265 (audit A5) : perte % ligne, majoration matiere consommee.
              c.perte_pct
       FROM recipe_format_components c
       LEFT JOIN recipes br ON br.id = c.source_recipe_id
       LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
       LEFT JOIN v_recipe_component_cost cc ON cc.component_id = c.id
       WHERE c.format_id = $1
       ORDER BY c.ordre, source_name`,
      [formatId]
    );

    const f = fmt.rows[0];

    // FALLBACK legacy : si le format par défaut n'a aucun composant mais que la recette
    // a une composition legacy (recipe_ingredients / recipe_sub_recipes), on l'affiche
    // (lecture). À la 1re sauvegarde, elle devient une vraie BOM (cf replaceForFormat).
    let componentRows = components.rows;
    if (componentRows.length === 0 && f.mode_cout !== 'compose') {
      const subs = await db.query(
        `SELECT NULL::uuid AS id, NULL AS role, rsr.sub_recipe_id AS source_recipe_id, NULL::uuid AS source_ingredient_id,
                sr.name AS source_name, 'recipe' AS source_type, rsr.quantity AS quantite, sr.yield_unit AS unite,
                CASE WHEN COALESCE(sr.yield_quantity, 0) > 0
                     THEN rsr.quantity / sr.yield_quantity * COALESCE(vtc.total_cost, 0) ELSE 0 END AS cout_dh,
                -- Legacy : unite composant = yield_unit sous-recette, conversion toujours OK.
                true AS conversion_ok,
                sr.yield_unit AS target_unit,
                0::numeric AS perte_pct
         FROM recipe_sub_recipes rsr
         JOIN recipes sr ON sr.id = rsr.sub_recipe_id
         LEFT JOIN v_recipe_total_cost vtc ON vtc.id = rsr.sub_recipe_id
         WHERE rsr.recipe_id = $1 ORDER BY sr.name`,
        [recipeId]
      );
      const ings = await db.query(
        `SELECT NULL::uuid AS id, NULL AS role, NULL::uuid AS source_recipe_id, ri.ingredient_id AS source_ingredient_id,
                ing.name AS source_name, 'ingredient' AS source_type, ri.quantity AS quantite, COALESCE(ri.unit, ing.unit) AS unite,
                ri.quantity * fn_unit_conv(COALESCE(ri.unit, ing.unit), ing.unit::text) * COALESCE(ing.unit_cost, 0) AS cout_dh,
                -- Legacy : idem, applique fn_unit_conv_ok sur le meme couple, incluant
                -- la validation par densite si un croisement poids↔volume est en jeu.
                (fn_unit_conv_ok(COALESCE(ri.unit, ing.unit), ing.unit::text)
                 OR (((lower(COALESCE(ri.unit, ing.unit)) IN ('g','kg','mg') AND lower(ing.unit::text) IN ('ml','cl','dl','l'))
                      OR (lower(COALESCE(ri.unit, ing.unit)) IN ('ml','cl','dl','l') AND lower(ing.unit::text) IN ('g','kg','mg')))
                     AND ing.densite_kg_l IS NOT NULL))
                  AS conversion_ok,
                ing.unit::text AS target_unit,
                0::numeric AS perte_pct
         FROM recipe_ingredients ri
         JOIN ingredients ing ON ing.id = ri.ingredient_id
         WHERE ri.recipe_id = $1 ORDER BY ing.name`,
        [recipeId]
      );
      componentRows = [...subs.rows, ...ings.rows].map((c, i) => ({ ...c, ordre: i }));
    }

    // Matière = somme des composants DE CE FORMAT (pas v_recipe_total_cost).
    const matiere = componentRows.reduce((s: number, c: { cout_dh: string | null }) => s + (c.cout_dh ? parseFloat(c.cout_dh) : 0), 0);
    // Finance par format : rendement = nb_par_defaut du format ; frais indirects niveau recette.
    const finance = computeFinance({ ...f, total_cost: matiere, pieces_par_fournee: f.nb_par_defaut, format_nb_par_defaut: f.nb_par_defaut });
    const nbParts = num(f.nb_parts);
    const parts = nbParts > 1
      ? { nb_parts: nbParts, cout_part: finance.cout_production_piece / nbParts, prix_part: finance.prix_piece / nbParts }
      : { nb_parts: nbParts || 1, cout_part: null, prix_part: null };

    return { format: f, components: componentRows, finance, parts };
  },

  // Remplace toute la nomenclature d'un format (transactionnel).
  // userId (mig 264, audit A6a) alimente recipe_format_components.updated_by,
  // que le trigger recopie dans recipe_bom_audit.changed_by.
  async replaceForFormat(recipeId: string, formatId: string, data: ReplacePayload, userId?: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const owns = await client.query(
        `SELECT is_default FROM recipe_formats WHERE id = $1 AND recipe_id = $2`,
        [formatId, recipeId]
      );
      if (owns.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const isDefault = owns.rows[0].is_default === true;

      // Anti-cycle : refuse si un composant (sous-)recette boucle vers cette recette.
      const childIds = data.components.filter((c) => c.sourceRecipeId).map((c) => c.sourceRecipeId as string);
      const cyclic = await this.detectComponentCycle(recipeId, childIds, client);
      if (cyclic.length > 0) {
        const err = new Error(`Cycle détecté : « ${cyclic.join(' », « ')} » contient (directement ou indirectement) cette recette. Composition refusée.`);
        (err as { code?: string }).code = 'RECIPE_CYCLE';
        throw err;
      }

      await client.query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [formatId]);

      for (const c of data.components) {
        await client.query(
          `INSERT INTO recipe_format_components
             (format_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [formatId, c.role ?? null, c.sourceRecipeId ?? null, c.sourceIngredientId ?? null,
           c.quantite, c.unite, c.ordre, c.pertePct ?? 0, userId ?? null]
        );
      }

      // Champs format : rendement (nb_par_defaut), parts, poids cru/cuit.
      await client.query(
        `UPDATE recipe_formats
         SET nb_par_defaut = COALESCE($2, nb_par_defaut),
             nb_parts      = COALESCE($3, nb_parts),
             poids_cru_g   = COALESCE($4, poids_cru_g),
             poids_cuit_g  = COALESCE($5, poids_cuit_g),
             updated_by    = COALESCE($6, updated_by),
             updated_at    = NOW()
         WHERE id = $1`,
        [formatId, data.nbParDefaut ?? null, data.nbParts ?? null, data.poidsCruG ?? null, data.poidsCuitG ?? null, userId ?? null]
      );

      // Le format par défaut pilote le coût recette (v_recipe_total_cost) :
      // recipe_components reste son MIROIR. On le resynchronise ici.
      if (isDefault) {
        await client.query(`DELETE FROM recipe_components WHERE recipe_id = $1`, [recipeId]);
        for (const c of data.components) {
          await client.query(
            `INSERT INTO recipe_components
               (recipe_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [recipeId, c.role ?? null, c.sourceRecipeId ?? null, c.sourceIngredientId ?? null,
             c.quantite, c.unite, c.ordre, c.pertePct ?? 0]
          );
        }
        // Finalise la bascule legacy → composé : la compo vit dans la nomenclature,
        // on purge recipe_ingredients/recipe_sub_recipes (sinon double comptage du coût).
        if (data.components.length > 0) {
          await client.query(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, [recipeId]);
          await client.query(`DELETE FROM recipe_sub_recipes WHERE recipe_id = $1`, [recipeId]);
        }
      }

      // Dès qu'une nomenclature existe, la recette passe en mode composé.
      if (data.components.length > 0) {
        await client.query(
          `UPDATE recipes SET mode_cout = 'compose', updated_at = NOW()
           WHERE id = $1 AND mode_cout <> 'compose'`,
          [recipeId]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.findByFormat(recipeId, formatId);
  },

  // --- Composition au NIVEAU RECETTE (indépendante du format/contenant) ---
  async findComposition(recipeId: string) {
    const rec = await db.query(
      `SELECT r.id, r.name, r.yield_quantity, r.yield_unit, r.mode_cout, r.margin_multiplier,
              r.pieces_par_fournee, r.perte_standard_pct, r.compo_par_piece,
              r.taux_main_oeuvre_dh_h, r.main_oeuvre_min,
              r.cout_energie_fournee, r.taux_frais_structure_pct,
              p.image_url AS product_image,
              round(vtc.total_cost::numeric, 4) AS total_cost,
              (SELECT rf.nb_par_defaut FROM recipe_formats rf
               WHERE rf.recipe_id = r.id AND rf.is_active = true
               ORDER BY rf.is_default DESC, rf.ordre LIMIT 1) AS format_nb_par_defaut,
              COALESCE((SELECT SUM((s->>'duree_estimee_min')::numeric)
                        FROM jsonb_array_elements(COALESCE(r.etapes, '[]'::jsonb)) s), 0) AS duree_etapes_min
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
       WHERE r.id = $1`,
      [recipeId]
    );
    if (rec.rows.length === 0) return null;
    const components = await db.query(
      `SELECT c.id, c.role, c.source_recipe_id, c.source_ingredient_id,
              COALESCE(br.name, ing.name) AS source_name,
              CASE WHEN c.source_recipe_id IS NOT NULL THEN 'recipe' ELSE 'ingredient' END AS source_type,
              c.quantite, c.unite, c.ordre, cc.cout_dh
       FROM recipe_components c
       LEFT JOIN recipes br ON br.id = c.source_recipe_id
       LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
       LEFT JOIN v_rcomp_cost cc ON cc.component_id = c.id
       WHERE c.recipe_id = $1
       ORDER BY c.ordre, source_name`,
      [recipeId]
    );
    return { recipe: rec.rows[0], components: components.rows, finance: computeFinance(rec.rows[0]) };
  },

  // Met à jour les leviers financiers saisissables (frais indirects + multiplicateur).
  // Renvoie la composition recalculée (coûts/prix/marge à jour).
  async updateFinance(recipeId: string, data: FinanceInput) {
    const r = await db.query(
      `UPDATE recipes SET
         margin_multiplier        = COALESCE($2, margin_multiplier),
         taux_main_oeuvre_dh_h    = COALESCE($3, taux_main_oeuvre_dh_h),
         main_oeuvre_min          = $4,
         cout_energie_fournee     = COALESCE($5, cout_energie_fournee),
         taux_frais_structure_pct = COALESCE($6, taux_frais_structure_pct),
         perte_standard_pct       = COALESCE($7, perte_standard_pct),
         compo_par_piece          = COALESCE($8, compo_par_piece),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [recipeId, data.marginMultiplier ?? null, data.tauxMainOeuvreDhH ?? null,
       data.mainOeuvreMin ?? null, data.coutEnergieFournee ?? null, data.tauxFraisStructurePct ?? null,
       data.perteStandardPct ?? null, data.compoParPiece ?? null]
    );
    if (r.rows.length === 0) return null;
    return this.findComposition(recipeId);
  },

  // Enfants directs d'une recette, pour le dépliage en arbre (lecture seule).
  // Privilégie la nomenclature (recipe_components) ; sinon retombe sur le legacy
  // (recipe_ingredients + recipe_sub_recipes) afin que les recettes de base se déplient.
  async findChildren(recipeId: string) {
    const comps = await db.query(
      `SELECT c.role, c.source_recipe_id, c.source_ingredient_id,
              COALESCE(br.name, ing.name) AS source_name,
              CASE WHEN c.source_recipe_id IS NOT NULL THEN 'recipe' ELSE 'ingredient' END AS source_type,
              c.quantite, c.unite, c.ordre, cc.cout_dh
       FROM recipe_components c
       LEFT JOIN recipes br ON br.id = c.source_recipe_id
       LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
       LEFT JOIN v_rcomp_cost cc ON cc.component_id = c.id
       WHERE c.recipe_id = $1
       ORDER BY c.ordre, source_name`,
      [recipeId]
    );
    if (comps.rows.length > 0) return comps.rows.map(toChild);

    const subs = await db.query(
      `SELECT sr.name AS source_name, rsr.sub_recipe_id AS source_recipe_id,
              NULL::uuid AS source_ingredient_id, 'recipe' AS source_type,
              rsr.quantity AS quantite, sr.yield_unit AS unite, NULL AS role,
              CASE WHEN COALESCE(sr.yield_quantity, 0) > 0
                   THEN rsr.quantity / sr.yield_quantity * COALESCE(vtc.total_cost, 0) ELSE 0 END AS cout_dh
       FROM recipe_sub_recipes rsr
       JOIN recipes sr ON sr.id = rsr.sub_recipe_id
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = rsr.sub_recipe_id
       WHERE rsr.recipe_id = $1
       ORDER BY sr.name`,
      [recipeId]
    );
    const ings = await db.query(
      `SELECT ing.name AS source_name, NULL::uuid AS source_recipe_id,
              ri.ingredient_id AS source_ingredient_id, 'ingredient' AS source_type,
              ri.quantity AS quantite, COALESCE(ri.unit, ing.unit) AS unite, NULL AS role,
              ri.quantity * fn_unit_conv(COALESCE(ri.unit, ing.unit), ing.unit::text) * COALESCE(ing.unit_cost, 0) AS cout_dh
       FROM recipe_ingredients ri
       JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1
       ORDER BY ing.name`,
      [recipeId]
    );
    return [...subs.rows, ...ings.rows].map(toChild);
  },

  // Détection de cycle pour la composition (recipe_components) AVANT insertion.
  // Pour chaque (sous-)recette candidate, vérifie si elle atteint déjà recipeId
  // dans le graphe de dépendances (mode-aware, comme v_recipe_total_cost) — auquel
  // cas l'ajouter comme composant de recipeId fermerait une boucle.
  // Renvoie les NOMS des recettes fautives (vide = pas de cycle).
  async detectComponentCycle(recipeId: string, childRecipeIds: string[], client?: { query: typeof db.query }): Promise<string[]> {
    const ids = [...new Set(childRecipeIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const runner = client ?? db;
    const res = await runner.query(
      `WITH RECURSIVE edges AS (
         SELECT r.id AS parent, rsr.sub_recipe_id AS child
         FROM recipes r JOIN recipe_sub_recipes rsr ON rsr.recipe_id = r.id
         WHERE r.mode_cout <> 'compose'
         UNION ALL
         SELECT r.id, rc.source_recipe_id
         FROM recipes r JOIN recipe_components rc ON rc.recipe_id = r.id AND rc.source_recipe_id IS NOT NULL
         WHERE r.mode_cout = 'compose'
       ),
       walk AS (
         SELECT c AS root, c AS node, 0 AS depth FROM unnest($2::uuid[]) AS c
         UNION ALL
         SELECT w.root, e.child, w.depth + 1
         FROM walk w JOIN edges e ON e.parent = w.node
         WHERE w.depth < 20
       )
       SELECT DISTINCT br.name
       FROM walk w JOIN recipes br ON br.id = w.root
       WHERE w.node = $1`,
      [recipeId, ids]
    );
    return res.rows.map((r: { name: string }) => r.name);
  },


  // --- CRUD des formats d'une recette ---
  async listFormats(recipeId: string) {
    const r = await db.query(
      `SELECT f.id, f.contenant_id, f.nb_par_defaut, f.nb_parts, f.is_default, f.ordre,
              f.cout_emballage_unitaire,
              pc.nom AS contenant_nom,
              (SELECT count(*) FROM recipe_format_components c WHERE c.format_id = f.id) AS nb_composants,
              round(cpc.cout_compose_dh::numeric, 2) AS cout_compose_dh,
              round(vfc.prix_vente_unitaire::numeric, 2) AS prix_vente_unitaire,
              -- Mig 260 : nb de composants dont la conversion d'unite est retombee sur
              -- le fallback 1 (unites incompatibles ou densite manquante). > 0 -> le
              -- cout est probablement faux, l'UI doit signaler.
              COALESCE(cpc.bad_conversions_count, 0) AS bad_conversions_count,
              -- Mig 263 (audit A1) : produit vendu au POS pour ce format + son prix.
              -- pos_price_source dit d'ou vient le prix affiche :
              --   'format' = format.product_id renseigne (attribution explicite) ;
              --   'recipe' = format par defaut sans lien propre, herite du produit
              --              historique de la recette (recipes.product_id) ;
              --   'none'   = aucun lien connu.
              COALESCE(f.product_id, CASE WHEN f.is_default THEN r.product_id END) AS pos_product_id,
              CASE
                WHEN f.product_id IS NOT NULL THEN 'format'
                WHEN f.is_default AND r.product_id IS NOT NULL THEN 'recipe'
                ELSE 'none'
              END AS pos_price_source,
              p.name  AS pos_product_name,
              p.price AS pos_price
       FROM recipe_formats f
       LEFT JOIN production_contenants pc ON pc.id = f.contenant_id
       LEFT JOIN v_recipe_compose_cost cpc ON cpc.format_id = f.id
       LEFT JOIN v_recipe_format_cost vfc ON vfc.id = f.id
       JOIN recipes r ON r.id = f.recipe_id
       LEFT JOIN products p ON p.id = COALESCE(f.product_id, CASE WHEN f.is_default THEN r.product_id END)
       WHERE f.recipe_id = $1 AND f.is_active = true
       ORDER BY f.is_default DESC, f.ordre, pc.nom`,
      [recipeId]
    );
    return r.rows;
  },

  async createFormat(recipeId: string, data: { contenantId: string; nbParDefaut?: number; coutEmballageUnitaire?: number; nbParts?: number | null }, userId?: string | null) {
    const existing = await db.query(
      `SELECT count(*)::int AS n FROM recipe_formats WHERE recipe_id = $1 AND is_active = true`,
      [recipeId]
    );
    const isDefault = existing.rows[0].n === 0;
    const r = await db.query(
      `INSERT INTO recipe_formats
         (recipe_id, contenant_id, quantite_par_format_g, quantite_par_format_unite,
          nb_par_defaut, cout_emballage_unitaire, nb_parts, is_default, ordre, is_active, updated_by)
       VALUES ($1, $2, 1, 'g', $3, $4, $5, $6,
               COALESCE((SELECT MAX(ordre)+1 FROM recipe_formats WHERE recipe_id=$1), 0), true, $7)
       ON CONFLICT (recipe_id, contenant_id) DO UPDATE SET
         is_active = true, updated_by = COALESCE(EXCLUDED.updated_by, recipe_formats.updated_by), updated_at = NOW()
       RETURNING id`,
      [recipeId, data.contenantId, data.nbParDefaut ?? 1, data.coutEmballageUnitaire ?? 0, data.nbParts ?? null, isDefault, userId ?? null]
    );
    return this.findByFormat(recipeId, r.rows[0].id);
  },

  // Duplique un format vers un contenant : copie rendement/parts/emballage + toute la
  // BOM. Si un format existe déjà pour ce contenant (même inactif), il est RÉACTIVÉ et
  // sa composition remplacée (pas d'erreur « contenant déjà utilisé »).
  async duplicateFormat(recipeId: string, fromFormatId: string, contenantId: string, userId?: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const src = await client.query(
        `SELECT nb_par_defaut, nb_parts, cout_emballage_unitaire
         FROM recipe_formats WHERE id = $1 AND recipe_id = $2`,
        [fromFormatId, recipeId]
      );
      if (src.rows.length === 0) { await client.query('ROLLBACK'); return null; }
      const s = src.rows[0];
      // Upsert : réactive un format existant (inactif) pour ce contenant, sinon en crée un.
      const ins = await client.query(
        `INSERT INTO recipe_formats
           (recipe_id, contenant_id, quantite_par_format_g, quantite_par_format_unite,
            nb_par_defaut, cout_emballage_unitaire, nb_parts, is_default, ordre, is_active, updated_by)
         VALUES ($1, $2, 1, 'g', $3, $4, $5, false,
                 COALESCE((SELECT MAX(ordre)+1 FROM recipe_formats WHERE recipe_id=$1), 0), true, $6)
         ON CONFLICT (recipe_id, contenant_id) DO UPDATE SET
           is_active = true,
           nb_par_defaut = EXCLUDED.nb_par_defaut,
           nb_parts = EXCLUDED.nb_parts,
           cout_emballage_unitaire = EXCLUDED.cout_emballage_unitaire,
           updated_by = COALESCE(EXCLUDED.updated_by, recipe_formats.updated_by),
           updated_at = NOW()
         RETURNING id`,
        [recipeId, contenantId, s.nb_par_defaut, s.cout_emballage_unitaire, s.nb_parts, userId ?? null]
      );
      const newId = ins.rows[0].id;
      // Remplace la BOM cible par celle de la source.
      await client.query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [newId]);
      await client.query(
        `INSERT INTO recipe_format_components
           (format_id, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct, updated_by)
         SELECT $1, role, source_recipe_id, source_ingredient_id, quantite, unite, ordre, perte_pct, $3
         FROM recipe_format_components WHERE format_id = $2`,
        [newId, fromFormatId, userId ?? null]
      );
      await client.query('COMMIT');
      return this.findByFormat(recipeId, newId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateFormat(
    recipeId: string,
    formatId: string,
    data: { contenantId?: string; nbParDefaut?: number; coutEmballageUnitaire?: number; nbParts?: number | null; productId?: string | null; densiteKgL?: number | null },
    userId?: string | null
  ) {
    // productId (mig 263, audit A1) : attribution nullable au POS. La sentinelle
    // '__CLEAR__' passee par le repo signifie "explicitement mettre a NULL" (le
    // COALESCE ne peut pas distinguer "non fourni" de "efface"). Sinon la
    // valeur passe telle quelle et est castee cote SQL en uuid.
    const clearProduct = data.productId === null;
    // Mig 266 (audit A4) : densite meme sentinelle que productId — `null`
    // explicite efface la valeur (retour au defaut 1 dans les vues), absent
    // = conserve.
    const clearDensite = data.densiteKgL === null;
    const r = await db.query(
      `UPDATE recipe_formats
       SET contenant_id            = COALESCE($3, contenant_id),
           nb_par_defaut           = COALESCE($4, nb_par_defaut),
           cout_emballage_unitaire = COALESCE($5, cout_emballage_unitaire),
           nb_parts                = COALESCE($6, nb_parts),
           product_id              = CASE
                                       WHEN $7::boolean THEN NULL
                                       WHEN $8::uuid IS NOT NULL THEN $8::uuid
                                       ELSE product_id
                                     END,
           densite_kg_l            = CASE
                                       WHEN $10::boolean THEN NULL
                                       WHEN $11::numeric IS NOT NULL THEN $11::numeric
                                       ELSE densite_kg_l
                                     END,
           updated_by              = COALESCE($9::uuid, updated_by),
           updated_at              = NOW()
       WHERE id = $1 AND recipe_id = $2
       RETURNING id`,
      [
        formatId, recipeId,
        data.contenantId ?? null, data.nbParDefaut ?? null,
        data.coutEmballageUnitaire ?? null, data.nbParts ?? null,
        clearProduct, clearProduct ? null : (data.productId ?? null),
        userId ?? null,
        clearDensite, clearDensite ? null : (data.densiteKgL ?? null),
      ]
    );
    if (r.rows.length === 0) return null;
    return this.findByFormat(recipeId, formatId);
  },

  async deleteFormat(recipeId: string, formatId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const del = await client.query(
        `DELETE FROM recipe_formats WHERE id = $1 AND recipe_id = $2 RETURNING is_default`,
        [formatId, recipeId]
      );
      if (del.rows.length === 0) { await client.query('ROLLBACK'); return false; }
      if (del.rows[0].is_default) {
        await client.query(
          `UPDATE recipe_formats SET is_default = true, updated_at = NOW()
           WHERE id = (SELECT id FROM recipe_formats WHERE recipe_id = $1 AND is_active = true
                       ORDER BY ordre, created_at LIMIT 1)`,
          [recipeId]
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
