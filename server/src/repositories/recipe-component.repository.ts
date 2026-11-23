import { db } from '../config/database.js';
import { snapshotRecipeVersion } from './recipe-version.helper.js';
import { pickQtyUnit, unitCodeSql, unitIdSql, type WeightUnit } from '../utils/qty-unit.js';

export interface ComponentInput {
  role?: string | null;
  sourceRecipeId?: string | null;
  sourceIngredientId?: string | null;
  /** Mig 634 : ligne d'emballage (quantité par unité produite), sortie du stock à la déclaration. */
  sourcePackagingId?: string | null;
  quantite: number;
  unite: string;
  ordre: number;
  /** Mig 265 (audit A5) : perte % par ligne (0-99.99), defaut 0. */
  pertePct?: number | null;
  /** Mig 634/635 : part en % de la formule (fiche en mode « pourcentage »). */
  pct?: number | null;
}

export interface ReplacePayload {
  components: ComponentInput[];
  /** Version du format chargée par l'écran (constat 114) : refus 409 si le format a changé depuis. */
  expectedVersion?: string | null;
  nbParDefaut?: number | null;
  nbParts?: number | null;
  poidsCruG?: number | null;
  poidsCuitG?: number | null;
  /** M3-04 : poids dans l'unité saisie, prioritaires sur poidsCruG / poidsCuitG. */
  poidsCruQty?: number | null; poidsCruUnit?: WeightUnit;
  poidsCuitQty?: number | null; poidsCuitUnit?: WeightUnit;
  /** Mig 613 : unité du rendement (absent = inchangée) et rendement en kilos. */
  rendementUnite?: 'unit' | 'kg';
  rendementKg?: number | null;
  /** Perte à la cuisson (recipes.perte_standard_pct), donnée technique saisie par le chef. */
  perteStandardPct?: number | null;
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
  // Mig 613 : format au kilo → l'unité de rendement est le kilo (décimal, peut être < 1),
  // tous les montants « par pièce » ci-dessous deviennent des montants au kilo.
  const rendementKg = num(row.rendement_kg);
  const pieces = row.rendement_unite === 'kg' && rendementKg > 0
    ? rendementKg
    : Math.max(1, num(row.pieces_par_fournee) || num(row.format_nb_par_defaut) || num(row.yield_quantity) || 1);
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
    // Audit A7 : voir findChildren.
    costed_on_default_format: r.costed_on_default_format === true,
  };
}

export const recipeComponentRepository = {
  // Rôles configurables (ref_entries table_id='component_roles')
  async listRoles() {
    const r = await db.query(
      // M8-06 : rôles du secteur actif (ou de son secteur de base) ; sans metadata.sectors = tous.
      `WITH s AS (
         SELECT cs.sector_pack AS code, sp.base_sector FROM company_settings cs
           LEFT JOIN sector_packs sp ON sp.code = cs.sector_pack WHERE cs.id = 1
       )
       SELECT code, label, description, display_order
       FROM ref_entries e
       WHERE table_id = 'component_roles' AND is_active = true
         AND (NOT (COALESCE(e.metadata, '{}'::jsonb) ? 'sectors')
              OR NOT EXISTS (SELECT 1 FROM s)
              OR EXISTS (SELECT 1 FROM s WHERE e.metadata->'sectors' ? s.code OR (s.base_sector IS NOT NULL AND e.metadata->'sectors' ? s.base_sector)))
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
       LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id
       WHERE r.is_base = true AND r.archived_at IS NULL
       ORDER BY r.name`
    );
    const ingredients = await db.query(
      // densite_kg_l : necessaire cote client pour re-valider en direct la
      // conversion d'unite d'un composant (badge « conversion douteuse » mig 260)
      // sans attendre la sauvegarde.
      `SELECT id, name, unit, unit_cost, densite_kg_l FROM ingredients ORDER BY name`
    );
    // Étape 10c : emballages, lignes de nomenclature « emballage » (quantité par unité produite, mig 634).
    const packaging = await db.query(
      `SELECT id, name, unit, unit_cost FROM packaging_items WHERE is_active IS NOT FALSE ORDER BY name`);
    return { recipes: recipes.rows, ingredients: ingredients.rows, packaging: packaging.rows };
  },

  // Nomenclature d'un format + finance PAR FORMAT (rendement = nb_par_defaut du format).
  async findByFormat(recipeId: string, formatId: string) {
    const fmt = await db.query(
      `SELECT f.id, f.recipe_id, f.contenant_id, f.nb_par_defaut, f.nb_parts,
              f.rendement_unite, f.rendement_kg,
              -- Jeton de version (microsecondes, en texte : un Date JS perdrait la précision) :
              -- deux sessions sur la même fiche ne s'écrasent plus en silence (constat 114).
              (extract(epoch FROM f.updated_at) * 1000000)::bigint::text AS version,
              f.poids_cru_g, f.poids_cuit_g, f.cout_emballage_unitaire, f.is_default,
              f.densite_kg_l,
              -- M3-04 : poids dans l'unité saisie.
              f.poids_cru_qty, ${unitCodeSql('f.poids_cru_unit_id')} AS poids_cru_unit,
              f.poids_cuit_qty, ${unitCodeSql('f.poids_cuit_unit_id')} AS poids_cuit_unit,
              pc.nom AS contenant_nom,
              r.name AS recipe_name, r.mode_cout, r.compo_par_piece,
              r.reference_mode, r.reference_batch_qty, r.reference_batch_unit,
              r.margin_multiplier, r.taux_main_oeuvre_dh_h, r.main_oeuvre_min,
              r.cout_energie_fournee, r.taux_frais_structure_pct, r.perte_standard_pct,
              r.yield_quantity, pdef.image_url AS product_image,
              fn_etapes_duree_active(r.etapes) AS duree_etapes_min /* temps actif, hors attente (constat 110, mig 622) */,
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
      `SELECT c.id, c.role, c.source_recipe_id, c.source_ingredient_id, c.source_packaging_id,
              COALESCE(br.name, ing.name, pk.name) AS source_name,
              CASE WHEN c.source_recipe_id IS NOT NULL THEN 'recipe' WHEN c.source_packaging_id IS NOT NULL THEN 'packaging' ELSE 'ingredient' END AS source_type,
              c.quantite, c.unite, c.ordre,
              cc.cout_dh,
              -- Étape 10c : coût d'une ligne d'emballage, pour l'affichage seulement (il est déjà
              -- compté dans le coût d'emballage du format, mig 634 : pas dans la matière).
              CASE WHEN c.source_packaging_id IS NOT NULL THEN ROUND(c.quantite * COALESCE(pk.unit_cost, 0), 4) END AS cout_emballage,
              -- Mig 260 : false = conversion d'unite repliee sur 1 (unites incompatibles
              -- ou densite manquante) -> cout_dh probablement faux, l'UI doit signaler.
              COALESCE(cc.conversion_ok, true) AS conversion_ok,
              COALESCE(ing.unit::text, br.yield_unit, pk.unit) AS target_unit,
              -- Mig 265 (audit A5) : perte % ligne, majoration matiere consommee.
              c.perte_pct, c.pct
       FROM recipe_format_components c
       LEFT JOIN recipes br ON br.id = c.source_recipe_id
       LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
       LEFT JOIN packaging_items pk ON pk.id = c.source_packaging_id
       LEFT JOIN v_recipe_component_cost_v2 cc ON cc.component_id = c.id
       WHERE c.format_id = $1
       ORDER BY c.ordre, source_name`,
      [formatId]
    );

    const f = fmt.rows[0];

    // Pas 2b-1 : plus de repli sur l'ancien modèle — la composition d'un format est sa
    // nomenclature, et rien d'autre.
    const componentRows = components.rows;

    // Matière = somme des composants DE CE FORMAT (pas v_recipe_total_cost_v2).
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

      // Contrôle de version (scénario 1, constat 114) : si l'écran a chargé une autre version
      // du format, quelqu'un l'a modifié entre-temps — refus plutôt qu'écrasement silencieux.
      if (data.expectedVersion) {
        const cur = (await client.query(
          `SELECT (extract(epoch FROM f.updated_at) * 1000000)::bigint::text AS version, f.updated_at,
                  NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS who
             FROM recipe_formats f LEFT JOIN users u ON u.id = f.updated_by
            WHERE f.id = $1 FOR UPDATE OF f`, [formatId])).rows[0];
        if (cur && cur.version !== data.expectedVersion) {
          const at = new Date(cur.updated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' });
          const err = new Error(`Cette composition a été modifiée${cur.who ? ` par ${cur.who}` : ''} à ${at} depuis que vous l'avez ouverte. Rechargez la fiche pour voir ses changements, puis refaites les vôtres.`);
          (err as { code?: string }).code = 'STALE_FORMAT';
          throw err;
        }
      }

      // Version complete AVANT modification (mig 346) : la nomenclature par format
      // n'etait jamais versionnee, seul le formulaire recette le faisait.
      await snapshotRecipeVersion(client, recipeId, userId ?? null, 'Nomenclature du format modifiee');

      // Anti-cycle : refuse si un composant (sous-)recette boucle vers cette recette.
      const childIds = data.components.filter((c) => c.sourceRecipeId).map((c) => c.sourceRecipeId as string);
      const cyclic = await this.detectComponentCycle(recipeId, childIds, client);
      if (cyclic.length > 0) {
        const err = new Error(`Cycle détecté : « ${cyclic.join(' », « ')} » contient (directement ou indirectement) cette recette. Composition refusée.`);
        (err as { code?: string }).code = 'RECIPE_CYCLE';
        throw err;
      }

      await client.query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [formatId]);

      // Étape 2 bis : fiche en mode « pourcentage » — la quantité d'une ligne matière ou
      // semi-fini se déduit de sa part et de la taille du lot de référence. Les besoins,
      // les coûts et le miroir lisent toujours la quantité : ils n'ont pas à changer.
      const ref = (await client.query(
        `SELECT reference_mode, reference_batch_qty::float8 AS qty, reference_batch_unit AS unit FROM recipes WHERE id = $1`, [recipeId])).rows[0];
      const pctMode = ref?.reference_mode === 'pourcentage' && Number(ref.qty) > 0;

      for (const c of data.components) {
        const fromPct = pctMode && !c.sourcePackagingId && c.pct != null && c.pct > 0;
        const quantite = fromPct ? Math.round((Number(ref.qty) * Number(c.pct) / 100) * 1e6) / 1e6 : c.quantite;
        const unite = fromPct ? (ref.unit || c.unite) : c.unite;
        await client.query(
          `INSERT INTO recipe_format_components
             (format_id, role, source_recipe_id, source_ingredient_id, source_packaging_id, quantite, unite, ordre, perte_pct, pct, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [formatId, c.role ?? null, c.sourceRecipeId ?? null, c.sourceIngredientId ?? null, c.sourcePackagingId ?? null,
           quantite, unite, c.ordre, c.pertePct ?? 0, fromPct ? c.pct : null, userId ?? null]
        );
      }

      // Champs format : rendement (nb_par_defaut), parts, poids cru/cuit. M3-04 : les poids
      // s'écrivent en quantité + unité saisie (absent = inchangé) ; les colonnes _g suivent
      // par déclencheur (mig 557).
      const cru = pickQtyUnit(data.poidsCruQty, data.poidsCruUnit, data.poidsCruG, 'g');
      const cuit = pickQtyUnit(data.poidsCuitQty, data.poidsCuitUnit, data.poidsCuitG, 'g');
      await client.query(
        `UPDATE recipe_formats
         SET nb_par_defaut = COALESCE($2, nb_par_defaut),
             nb_parts      = COALESCE($3, nb_parts),
             -- Mig 613 : unité absente = inchangée ; en kg, le rendement kilo suit.
             rendement_unite = COALESCE($9, rendement_unite),
             rendement_kg    = CASE WHEN COALESCE($9, rendement_unite) = 'kg'
                                    THEN COALESCE($10::numeric, rendement_kg)
                                    ELSE rendement_kg END,
             poids_cru_unit_id  = CASE WHEN $4::numeric IS NULL THEN poids_cru_unit_id ELSE ${unitIdSql('$7')} END,
             poids_cru_qty      = COALESCE($4::numeric, poids_cru_qty),
             poids_cuit_unit_id = CASE WHEN $5::numeric IS NULL THEN poids_cuit_unit_id ELSE ${unitIdSql('$8')} END,
             poids_cuit_qty     = COALESCE($5::numeric, poids_cuit_qty),
             updated_by    = COALESCE($6, updated_by),
             updated_at    = NOW()
         WHERE id = $1`,
        [formatId, data.nbParDefaut ?? null, data.nbParts ?? null, cru?.qty ?? null, cuit?.qty ?? null, userId ?? null,
         cru?.unit ?? 'g', cuit?.unit ?? 'g', data.rendementUnite ?? null, data.rendementKg ?? null]
      );

      // Perte à la cuisson : niveau recette, enregistrée avec la composition (absente =
      // inchangée ; null ou 0 = aucune perte).
      if (data.perteStandardPct !== undefined) {
        await client.query(
          `UPDATE recipes SET perte_standard_pct = $2, updated_at = NOW() WHERE id = $1`,
          [recipeId, data.perteStandardPct ?? 0]
        );
      }

      // Préparation de base au kilo (mig 613) : son rendement (recipes.yield_quantity, lu par
      // listSources et v_recipe_component_cost pour coûter son emploi dans une autre fiche)
      // suit le rendement kilo du format par défaut. Sans ça il restait à 1 kg (valeur de
      // création) : 60 g de pâte coûtaient 6 % de la fournée entière (scénario 1).
      // Le mode pièces garde le rendement saisi au niveau recette (fiches existantes).
      if (isDefault) {
        await client.query(
          `UPDATE recipes r
           SET yield_quantity = f.rendement_kg, yield_unit = 'kg', updated_at = NOW()
           FROM recipe_formats f
           WHERE r.id = $1 AND f.id = $2 AND r.is_base
             AND f.rendement_unite = 'kg' AND f.rendement_kg > 0
             AND (r.yield_quantity IS DISTINCT FROM f.rendement_kg OR r.yield_unit IS DISTINCT FROM 'kg')`,
          [recipeId, formatId]
        );
      }

      // Le miroir recipe_components (lu par v_recipe_total_cost_v2) est désormais
      // reconstruit automatiquement par trigger (mig 412) depuis les composants du
      // format par défaut — plus de resynchronisation à la main ici. L'ancien modèle
      // n'est plus écrit (2b-1) : plus de purge à faire.

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
      // Le trigger anti-cycle (mig 410) lève une erreur « ... circulaire ... » sur un
      // cycle via les composants de format, que detectComponentCycle ne couvre pas.
      // On l'uniformise en code RECIPE_CYCLE pour que le contrôleur réponde 409.
      const msg = (err as Error)?.message ?? '';
      if (!(err as { code?: string }).code && /circulaire/i.test(msg)) {
        (err as { code?: string }).code = 'RECIPE_CYCLE';
      }
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
              fn_etapes_duree_active(r.etapes) AS duree_etapes_min /* temps actif, hors attente (constat 110, mig 622) */
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN v_recipe_total_cost_v2 vtc ON vtc.id = r.id
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
       LEFT JOIN v_rcomp_cost_v2 cc ON cc.component_id = c.id
       WHERE c.recipe_id = $1
       ORDER BY c.ordre, source_name`,
      [recipeId]
    );
    return { recipe: rec.rows[0], components: components.rows, finance: computeFinance(rec.rows[0]) };
  },

  async updateIdentity(recipeId: string, data: { name: string; categoryId?: string | null; compoParPiece?: boolean; temperaturePateCibleC?: number | null; hydratationPct?: number | null; isPhantom?: boolean }) {
    // compo_par_piece (mode de saisie fournee/piece) et les parametres de pate
    // (mig 342) sont editables ici, au niveau fiche, hors du flux de composition.
    // COALESCE : non fourni => on ne touche pas a la valeur existante.
    const r = await db.query(
      `UPDATE recipes SET name = $2, category_id = $3,
              compo_par_piece = COALESCE($4, compo_par_piece),
              temperature_pate_cible_c = COALESCE($5, temperature_pate_cible_c),
              hydratation_pct = COALESCE($6, hydratation_pct),
              -- M9 (mig 588) : fantôme réservé aux préparations de base.
              is_phantom = CASE WHEN $7::boolean IS NULL THEN is_phantom ELSE ($7::boolean AND is_base) END,
              updated_at = NOW() WHERE id = $1
       RETURNING id, name, category_id, compo_par_piece, temperature_pate_cible_c, hydratation_pct, is_phantom`,
      [recipeId, data.name.trim(), data.categoryId ?? null, data.compoParPiece ?? null, data.temperaturePateCibleC ?? null, data.hydratationPct ?? null, data.isPhantom ?? null]
    );
    return r.rows[0] ?? null;
  },

  // Remplace le mode opératoire seul, sans toucher à la composition : le PUT
  // complet de la recette exigerait de renvoyer ingrédients, formats, etc.
  async updateEtapes(recipeId: string, etapes: unknown[]) {
    const r = await db.query(
      `UPDATE recipes SET etapes = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING etapes`,
      [recipeId, JSON.stringify(etapes)]
    );
    return r.rows[0]?.etapes ?? null;
  },

  // Met à jour les leviers financiers saisissables (frais indirects + multiplicateur).
  // Renvoie la composition recalculée (coûts/prix/marge à jour).
  async updateFinance(recipeId: string, data: FinanceInput, userId: string | null = null) {
    // Version complete AVANT modification (mig 346) : les frais indirects et le
    // multiplicateur n'etaient jamais versionnes.
    await snapshotRecipeVersion(db, recipeId, userId, 'Parametres financiers modifies');
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

  // Enfants directs d'une recette, pour le dépliage en arbre (lecture seule) :
  // la nomenclature (miroir recipe_components du format par défaut). Pas 2b-1 : plus de
  // repli sur l'ancien modèle.
  async findChildren(recipeId: string) {
    // Audit A7 : costed_on_default_format = true quand le composant est
    // une sous-recette qui a plusieurs formats actifs. v_recipe_total_cost_v2 ne
    // developpe que la BOM du format is_default (mig 204) : le cout affiche est
    // donc une approximation si les formats divergent sur les composants. L'UI
    // ajoute un badge.
    const comps = await db.query(
      `SELECT c.role, c.source_recipe_id, c.source_ingredient_id,
              COALESCE(br.name, ing.name) AS source_name,
              CASE WHEN c.source_recipe_id IS NOT NULL THEN 'recipe' ELSE 'ingredient' END AS source_type,
              c.quantite, c.unite, c.ordre, cc.cout_dh,
              (c.source_recipe_id IS NOT NULL AND
               (SELECT COUNT(*) FROM recipe_formats f WHERE f.recipe_id = c.source_recipe_id AND f.is_active) > 1
              ) AS costed_on_default_format
       FROM recipe_components c
       LEFT JOIN recipes br ON br.id = c.source_recipe_id
       LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
       LEFT JOIN v_rcomp_cost_v2 cc ON cc.component_id = c.id
       WHERE c.recipe_id = $1
       ORDER BY c.ordre, source_name`,
      [recipeId]
    );
    return comps.rows.map(toChild);
  },

  // Détection de cycle pour la composition (recipe_components) AVANT insertion.
  // Pour chaque (sous-)recette candidate, vérifie si elle atteint déjà recipeId
  // dans le graphe de dépendances (mode-aware, comme v_recipe_total_cost_v2) — auquel
  // cas l'ajouter comme composant de recipeId fermerait une boucle.
  // Renvoie les NOMS des recettes fautives (vide = pas de cycle).
  async detectComponentCycle(recipeId: string, childRecipeIds: string[], client?: { query: typeof db.query }): Promise<string[]> {
    const ids = [...new Set(childRecipeIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const runner = client ?? db;
    const res = await runner.query(
      `WITH RECURSIVE edges AS (
         -- Pas 2b-1 : arêtes de la nomenclature (formats actifs + miroir), plus l'ancien modèle.
         SELECT f.recipe_id AS parent, rfc.source_recipe_id AS child
         FROM recipe_format_components rfc JOIN recipe_formats f ON f.id = rfc.format_id AND f.is_active
         WHERE rfc.source_recipe_id IS NOT NULL
         UNION
         SELECT rc.recipe_id, rc.source_recipe_id
         FROM recipe_components rc WHERE rc.source_recipe_id IS NOT NULL
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
              f.rendement_unite, f.rendement_kg,
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

  async createFormat(recipeId: string, data: { contenantId?: string | null; nbParDefaut?: number; coutEmballageUnitaire?: number; nbParts?: number | null }, userId?: string | null) {
    const existing = await db.query(
      `SELECT count(*)::int AS n FROM recipe_formats WHERE recipe_id = $1 AND is_active = true`,
      [recipeId]
    );
    const isDefault = existing.rows[0].n === 0;
    const r = await db.query(
      `INSERT INTO recipe_formats
         (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite,
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
  async duplicateFormat(recipeId: string, fromFormatId: string, contenantId: string | null, userId?: string | null) {
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
           (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite,
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
