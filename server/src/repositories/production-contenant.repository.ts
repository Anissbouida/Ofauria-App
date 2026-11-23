import { policyNumber } from '../services/policies.js';
import { db } from '../config/database.js';
import { pickQtyUnit, unitCodeSql, unitIdSql, type WeightUnit } from '../utils/qty-unit.js';

// M3-04 : code de l'unité saisie du poids, à côté de poids_qty.
const POIDS_UNIT = `${unitCodeSql('poids_unit_id')} AS poids_unit`;

export const productionContenantRepository = {
  // ───────── CONTENANTS CRUD ─────────

  async findAllContenants(includeInactive = false) {
    const where = includeInactive ? '' : 'WHERE is_active = true';
    const result = await db.query(
      `SELECT *, quantite_nette_cible, ${POIDS_UNIT} FROM production_contenants ${where} ORDER BY type_production, nom`
    );
    return result.rows;
  },

  async findContenantById(id: string) {
    const result = await db.query(
      `SELECT *, quantite_nette_cible, ${POIDS_UNIT} FROM production_contenants WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async createContenant(data: {
    nom: string;
    type_production: number;
    unite_lancement: string;
    quantite_theorique: number;
    pertes_fixes: number;
    poids_kg?: number | null;
    poids_qty?: number | null;
    poids_unit?: WeightUnit;
    seuil_rendement_defaut?: number;
    etapes_defaut: unknown[];
    categories_pertes: string[];
    longueur_cm?: number | null;
    largeur_cm?: number | null;
    profondeur_cm?: number | null;
    diametre_cm?: number | null;
    type_decoupe?: string | null;
    nb_pieces_decoupe?: number | null;
  }) {
    // Quantité + unité saisie ; poids_kg est tenu par le déclencheur (mig 557).
    const poids = pickQtyUnit(data.poids_qty, data.poids_unit, data.poids_kg, 'kg') ?? { qty: null, unit: 'kg' as WeightUnit };
    const result = await db.query(
      `INSERT INTO production_contenants
        (nom, type_production, unite_lancement, quantite_theorique, pertes_fixes, poids_qty, seuil_rendement_defaut, etapes_defaut, categories_pertes,
         longueur_cm, largeur_cm, profondeur_cm, diametre_cm, type_decoupe, nb_pieces_decoupe, poids_unit_id)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $12, $13, $14, $15, CASE WHEN $6::numeric IS NULL THEN NULL ELSE ${unitIdSql('$16')} END)
       RETURNING *, quantite_nette_cible, ${POIDS_UNIT}`,
      [data.nom, data.type_production, data.unite_lancement, data.quantite_theorique,
       data.pertes_fixes, poids.qty,
       data.seuil_rendement_defaut ?? await policyNumber('production.yield_target', 'pct'),
       JSON.stringify(data.etapes_defaut), JSON.stringify(data.categories_pertes),
       data.longueur_cm ?? null, data.largeur_cm ?? null, data.profondeur_cm ?? null,
       data.diametre_cm ?? null, data.type_decoupe ?? null, data.nb_pieces_decoupe ?? null, poids.unit]
    );
    return result.rows[0];
  },

  async updateContenant(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      nom: 'nom',
      type_production: 'type_production',
      unite_lancement: 'unite_lancement',
      quantite_theorique: 'quantite_theorique',
      pertes_fixes: 'pertes_fixes',
      seuil_rendement_defaut: 'seuil_rendement_defaut',
      etapes_defaut: 'etapes_defaut',
      categories_pertes: 'categories_pertes',
      is_active: 'is_active',
      longueur_cm: 'longueur_cm',
      largeur_cm: 'largeur_cm',
      profondeur_cm: 'profondeur_cm',
      diametre_cm: 'diametre_cm',
      type_decoupe: 'type_decoupe',
      nb_pieces_decoupe: 'nb_pieces_decoupe',
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${i++}`);
        const val = data[key];
        values.push(
          (key === 'etapes_defaut' || key === 'categories_pertes') && Array.isArray(val)
            ? JSON.stringify(val) : val
        );
      }
    }

    // M3-04 : poids écrit en quantité + unité saisie (poids_kg suit par déclencheur).
    const poids = pickQtyUnit(data.poids_qty as number | null | undefined, data.poids_unit as WeightUnit | undefined,
      data.poids_kg as number | null | undefined, 'kg');
    if (poids) {
      const qtyParam = i++;
      const unitParam = i++;
      fields.push(`poids_qty = $${qtyParam}::numeric`);
      fields.push(`poids_unit_id = CASE WHEN $${qtyParam}::numeric IS NULL THEN NULL ELSE ${unitIdSql(`$${unitParam}`)} END`);
      values.push(poids.qty, poids.unit);
    }

    if (fields.length === 0) return this.findContenantById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await db.query(
      `UPDATE production_contenants SET ${fields.join(', ')} WHERE id = $${i} RETURNING *, quantite_nette_cible, ${POIDS_UNIT}`,
      values
    );
    return result.rows[0];
  },

  async deactivateContenant(id: string) {
    // 2b-1 : plus de profil produit à vérifier (produit_profil_production retirée).
    return this.updateContenant(id, { is_active: false });
  },

  /**
   * Ce qui empeche la suppression definitive d'un contenant. Liste vide =
   * supprimable.
   *
   * Toutes les FK qui pointent production_contenants sont en RESTRICT /
   * NO ACTION : un DELETE sur un contenant utilise echouerait de toute facon.
   * Ce controle en amont sert a (a) rendre un message exploitable (« utilise
   * par 3 format(s) ») au lieu d'une violation de contrainte brute, et (b)
   * decider du repli sur la desactivation sans avoir a parser une erreur PG.
   *
   * Le referentiel pointe le contenant depuis les formats de recette et les
   * recettes (le profil produit a ete retire en 2b-1), plus les plans de
   * production et le stock semi-fini qui l'historisent.
   */
  async findContenantBlockers(id: string): Promise<string[]> {
    const usage = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM recipe_formats            WHERE contenant_id = $1)        AS formats,
         (SELECT COUNT(*) FROM recipes                   WHERE contenant_id = $1)        AS recettes,
         (SELECT COUNT(*) FROM production_plan_items     WHERE contenant_id = $1)        AS plans,
         (SELECT COUNT(*) FROM stock_semifini_frigo      WHERE source_contenant_id = $1) AS stock`,
      [id]
    );
    const u = usage.rows[0];
    const blockers: string[] = [];
    if (Number(u.formats) > 0) blockers.push(`${u.formats} format(s) de recette`);
    if (Number(u.recettes) > 0) blockers.push(`${u.recettes} recette(s)`);
    if (Number(u.plans) > 0) blockers.push(`${u.plans} ligne(s) de plan`);
    if (Number(u.stock) > 0) blockers.push(`${u.stock} lot(s) de stock semi-fini`);
    return blockers;
  },

  /** Suppression definitive. Echoue si le contenant est reference quelque part. */
  async deleteContenant(id: string) {
    const contenant = await this.findContenantById(id);
    if (!contenant) throw new Error('Format introuvable');

    const blockers = await this.findContenantBlockers(id);
    if (blockers.length > 0) {
      throw new Error(`Utilise par ${blockers.join(', ')} — desactivez-le plutot`);
    }

    await db.query(`DELETE FROM production_contenants WHERE id = $1`, [id]);
    return contenant;
  },

  // ───────── PROFILS PRODUIT ─────────
  // 2b-1 : le profil de production par produit (produit_profil_production, surcharges du
  // contenant) appartient à l'ancien modèle de fiche ; la table n'a jamais été remplie
  // (vide en développement comme en production). Le contenant et ses valeurs se règlent sur
  // le format de la fiche. Les routes restent pour les écrans existants : lecture = aucun
  // profil, écriture refusée avec un message, suppression sans effet.

  async findProfileByProductId(_productId: string): Promise<null> {
    return null;
  },

  async upsertProfile(_productId: string, _data: {
    contenant_id: string;
    surcharge_quantite_theorique?: number | null;
    surcharge_pertes_fixes?: number | null;
    surcharge_seuil_rendement?: number | null;
    etapes_surcharges?: unknown[];
    notes?: string | null;
  }): Promise<never> {
    const err = new Error('Le profil de production par produit n\'existe plus : réglez le contenant et ses quantités sur le format de la fiche technique.') as Error & { statusCode?: number };
    err.statusCode = 410;
    throw err;
  },

  async deleteProfile(_productId: string): Promise<void> {
    // Rien à supprimer (voir plus haut).
  },

  async findProductsByContenantId(_contenantId: string): Promise<{ produit_id: string; product_name: string; price: string; created_at: string }[]> {
    return [];
  },

  // ───────── LABELS ─────────

};
