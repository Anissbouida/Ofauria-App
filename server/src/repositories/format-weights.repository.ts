import { db } from '../config/database.js';

/**
 * Poids cru et poids cuit des formats, en grille (G2-05).
 *
 * Le poids cuit d'un format n'était renseigné nulle part : sans lui, ni la perte à la
 * cuisson (freinte standard) ni le poids net de l'étiquette ne se calculent.
 *
 * `list()` rend une ligne par format actif d'une fiche active, avec une proposition tirée
 * des pesées réelles des trois derniers mois quand il y en a (saisies au rendement :
 * poids unitaire des pâtons, masse cuite / pièces sorties).
 * `save()` enregistre les deux poids d'un format.
 */
export type FormatWeightRow = {
  formatId: string; recipeId: string; recipeName: string; formatLabel: string; isDefault: boolean;
  poidsCruG: number | null; poidsCuitG: number | null;
  /** Perte à la cuisson calculée, en % ; null s'il manque un poids. */
  pertePct: number | null;
  proposal: { cruG: number | null; cuitG: number | null; samples: number } | null;
};

const lossPct = (cru: number | null, cuit: number | null) =>
  cru !== null && cuit !== null && cru > 0 ? Math.round(((cru - cuit) / cru) * 1000) / 10 : null;
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const formatWeightsRepository = {
  async list(): Promise<FormatWeightRow[]> {
    const rows = (await db.query(
      `SELECT rf.id AS "formatId", r.id AS "recipeId", r.name AS "recipeName",
              COALESCE(pc.nom, 'Sans contenant') AS "formatLabel", rf.is_default AS "isDefault",
              rf.poids_cru_g, rf.poids_cuit_g,
              w.cru_g, w.cuit_g, COALESCE(w.samples, 0)::int AS samples
         FROM recipe_formats rf
         JOIN recipes r ON r.id = rf.recipe_id AND r.archived_at IS NULL
         LEFT JOIN production_contenants pc ON pc.id = rf.contenant_id
         -- Pesées réelles des 90 derniers jours pour l'article ou la fiche de ce format.
         LEFT JOIN LATERAL (
           SELECT ROUND(AVG(pr.patons_poids_unitaire_g) FILTER (WHERE pr.patons_poids_unitaire_g > 0), 1) AS cru_g,
                  ROUND(AVG(pr.masse_cuite_kg * 1000 / NULLIF(pr.quantite_nette_reelle, 0))
                        FILTER (WHERE pr.masse_cuite_kg > 0 AND pr.quantite_nette_reelle > 0), 1) AS cuit_g,
                  COUNT(*) FILTER (WHERE pr.masse_cuite_kg > 0 OR pr.patons_poids_unitaire_g > 0) AS samples
             FROM production_rendement pr
             JOIN production_plan_items ppi ON ppi.id = pr.plan_item_id
            WHERE pr.recorded_at >= now() - INTERVAL '90 days'
              AND (ppi.base_recipe_id = r.id
                   OR (COALESCE(rf.product_id, r.product_id) IS NOT NULL AND ppi.product_id = COALESCE(rf.product_id, r.product_id)))
              AND (ppi.contenant_id IS NULL OR rf.contenant_id IS NULL OR ppi.contenant_id = rf.contenant_id)
         ) w ON true
        WHERE rf.is_active
        ORDER BY (rf.poids_cuit_g IS NOT NULL), r.name, rf.ordre`)).rows;
    return rows.map(r => {
      const cru = numOrNull(r.poids_cru_g), cuit = numOrNull(r.poids_cuit_g);
      const pCru = numOrNull(r.cru_g), pCuit = numOrNull(r.cuit_g);
      return {
        formatId: r.formatId, recipeId: r.recipeId, recipeName: r.recipeName, formatLabel: r.formatLabel, isDefault: r.isDefault,
        poidsCruG: cru, poidsCuitG: cuit, pertePct: lossPct(cru, cuit),
        proposal: r.samples > 0 && (pCru !== null || pCuit !== null) ? { cruG: pCru, cuitG: pCuit, samples: r.samples } : null,
      };
    });
  },

  /**
   * Enregistre les poids d'un format. `null` efface une valeur. Le poids cuit ne peut pas
   * dépasser le poids cru : une cuisson retire de l'eau, elle n'en ajoute pas.
   */
  async save(formatId: string, data: { poidsCruG: number | null; poidsCuitG: number | null }, userId: string): Promise<{ error: string } | FormatWeightRow> {
    const { poidsCruG: cru, poidsCuitG: cuit } = data;
    for (const [label, v] of [['Poids cru', cru], ['Poids cuit', cuit]] as const) {
      if (v !== null && (!Number.isFinite(v) || v <= 0)) return { error: `${label} : une valeur supérieure à 0 est attendue` };
    }
    if (cru !== null && cuit !== null && cuit > cru) return { error: 'Le poids cuit ne peut pas dépasser le poids cru' };
    const r = await db.query(
      `UPDATE recipe_formats SET poids_cru_g = $2::numeric, poids_cuit_g = $3::numeric, updated_by = $4, updated_at = now()
        WHERE id = $1 RETURNING id`, [formatId, cru, cuit, userId]);
    if (!r.rows.length) return { error: 'Format introuvable' };
    const row = (await this.list()).find(x => x.formatId === formatId);
    // Format inactif ou fiche archivée : hors de la grille, la valeur est enregistrée quand même.
    return row ?? { formatId, recipeId: '', recipeName: '', formatLabel: '', isDefault: false, poidsCruG: cru, poidsCuitG: cuit, pertePct: lossPct(cru, cuit), proposal: null };
  },
};
