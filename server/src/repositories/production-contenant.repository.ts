import { db } from '../config/database.js';

export const productionContenantRepository = {
  // ───────── CONTENANTS CRUD ─────────

  async findAllContenants(includeInactive = false) {
    const where = includeInactive ? '' : 'WHERE is_active = true';
    const result = await db.query(
      `SELECT *, quantite_nette_cible FROM production_contenants ${where} ORDER BY type_production, nom`
    );
    return result.rows;
  },

  async findContenantById(id: string) {
    const result = await db.query(
      `SELECT *, quantite_nette_cible FROM production_contenants WHERE id = $1`,
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
    seuil_rendement_defaut: number;
    etapes_defaut: unknown[];
    categories_pertes: string[];
  }) {
    const result = await db.query(
      `INSERT INTO production_contenants
        (nom, type_production, unite_lancement, quantite_theorique, pertes_fixes, poids_kg, seuil_rendement_defaut, etapes_defaut, categories_pertes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *, quantite_nette_cible`,
      [data.nom, data.type_production, data.unite_lancement, data.quantite_theorique,
       data.pertes_fixes, data.poids_kg ?? null, data.seuil_rendement_defaut,
       JSON.stringify(data.etapes_defaut), JSON.stringify(data.categories_pertes)]
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
      poids_kg: 'poids_kg',
      seuil_rendement_defaut: 'seuil_rendement_defaut',
      etapes_defaut: 'etapes_defaut',
      categories_pertes: 'categories_pertes',
      is_active: 'is_active',
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

    if (fields.length === 0) return this.findContenantById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await db.query(
      `UPDATE production_contenants SET ${fields.join(', ')} WHERE id = $${i} RETURNING *, quantite_nette_cible`,
      values
    );
    return result.rows[0];
  },

  async deactivateContenant(id: string) {
    // Check no active profiles reference this contenant
    const check = await db.query(
      `SELECT COUNT(*) as cnt FROM produit_profil_production WHERE contenant_id = $1`,
      [id]
    );
    if (parseInt(check.rows[0].cnt) > 0) {
      throw new Error(`Ce contenant est utilise par ${check.rows[0].cnt} produit(s). Detachez-les avant de desactiver.`);
    }
    return this.updateContenant(id, { is_active: false });
  },

  // ───────── PROFILS PRODUIT ─────────

  async findProfileByProductId(productId: string) {
    const result = await db.query(
      `SELECT pp.*,
              c.nom as contenant_nom, c.type_production, c.unite_lancement,
              c.quantite_theorique as contenant_quantite_theorique,
              c.pertes_fixes as contenant_pertes_fixes,
              c.quantite_nette_cible as contenant_quantite_nette_cible,
              c.poids_kg as contenant_poids_kg,
              c.seuil_rendement_defaut as contenant_seuil_rendement,
              c.etapes_defaut as contenant_etapes_defaut,
              c.categories_pertes as contenant_categories_pertes
       FROM produit_profil_production pp
       JOIN production_contenants c ON c.id = pp.contenant_id
       WHERE pp.produit_id = $1`,
      [productId]
    );
    if (!result.rows[0]) return null;

    const row = result.rows[0];

    // Fusionner surcharges avec valeurs par defaut du contenant
    return {
      id: row.id,
      produit_id: row.produit_id,
      contenant_id: row.contenant_id,
      contenant_nom: row.contenant_nom,
      type_production: row.type_production,
      unite_lancement: row.unite_lancement,
      poids_kg: row.contenant_poids_kg,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      // Valeurs effectives (surcharge ou defaut contenant)
      quantite_theorique: row.surcharge_quantite_theorique ?? row.contenant_quantite_theorique,
      pertes_fixes: row.surcharge_pertes_fixes ?? row.contenant_pertes_fixes,
      quantite_nette_cible:
        (row.surcharge_quantite_theorique ?? row.contenant_quantite_theorique) -
        (row.surcharge_pertes_fixes ?? row.contenant_pertes_fixes),
      seuil_rendement: row.surcharge_seuil_rendement ?? row.contenant_seuil_rendement,
      categories_pertes: row.contenant_categories_pertes,
      // Etapes fusionnees
      etapes: this.mergeEtapes(row.contenant_etapes_defaut, row.etapes_surcharges),
      // Surcharges brutes (pour l'edition)
      surcharges: {
        quantite_theorique: row.surcharge_quantite_theorique,
        pertes_fixes: row.surcharge_pertes_fixes,
        seuil_rendement: row.surcharge_seuil_rendement,
        etapes: row.etapes_surcharges,
      },
    };
  },

  mergeEtapes(contenantEtapes: unknown[], surcharges: unknown[]): unknown[] {
    if (!surcharges || !Array.isArray(surcharges) || surcharges.length === 0) {
      return contenantEtapes || [];
    }
    const base = Array.isArray(contenantEtapes) ? [...contenantEtapes] : [];
    const surchargeMap = new Map<number, Record<string, unknown>>();
    for (const s of surcharges as Record<string, unknown>[]) {
      if (s.ordre !== undefined) surchargeMap.set(s.ordre as number, s);
    }

    // Override matching steps, append new ones
    const merged = base.map((step: unknown) => {
      const s = step as Record<string, unknown>;
      const override = surchargeMap.get(s.ordre as number);
      if (override) {
        surchargeMap.delete(s.ordre as number);
        return { ...s, ...override, _surcharge: true };
      }
      return { ...s, _surcharge: false };
    });

    // Append extra steps from surcharges
    for (const extra of surchargeMap.values()) {
      merged.push({ ...extra, _surcharge: true });
    }

    return merged.sort((a: unknown, b: unknown) =>
      ((a as Record<string, number>).ordre || 0) - ((b as Record<string, number>).ordre || 0)
    );
  },

  async upsertProfile(productId: string, data: {
    contenant_id: string;
    surcharge_quantite_theorique?: number | null;
    surcharge_pertes_fixes?: number | null;
    surcharge_seuil_rendement?: number | null;
    etapes_surcharges?: unknown[];
    notes?: string | null;
  }) {
    const result = await db.query(
      `INSERT INTO produit_profil_production
        (produit_id, contenant_id, surcharge_quantite_theorique, surcharge_pertes_fixes, surcharge_seuil_rendement, etapes_surcharges, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (produit_id) DO UPDATE SET
        contenant_id = EXCLUDED.contenant_id,
        surcharge_quantite_theorique = EXCLUDED.surcharge_quantite_theorique,
        surcharge_pertes_fixes = EXCLUDED.surcharge_pertes_fixes,
        surcharge_seuil_rendement = EXCLUDED.surcharge_seuil_rendement,
        etapes_surcharges = EXCLUDED.etapes_surcharges,
        notes = EXCLUDED.notes,
        updated_at = NOW()
       RETURNING *`,
      [productId, data.contenant_id,
       data.surcharge_quantite_theorique ?? null,
       data.surcharge_pertes_fixes ?? null,
       data.surcharge_seuil_rendement ?? null,
       JSON.stringify(data.etapes_surcharges || []),
       data.notes ?? null]
    );
    return this.findProfileByProductId(productId);
  },

  async deleteProfile(productId: string) {
    await db.query(
      `DELETE FROM produit_profil_production WHERE produit_id = $1`,
      [productId]
    );
  },

  async findProductsByContenantId(contenantId: string) {
    const result = await db.query(
      `SELECT pp.produit_id, p.name as product_name, p.price, pp.created_at
       FROM produit_profil_production pp
       JOIN products p ON p.id = pp.produit_id
       WHERE pp.contenant_id = $1
       ORDER BY p.name`,
      [contenantId]
    );
    return result.rows;
  },

  // ───────── LABELS ─────────

  getTypeProductionLabel(type: number): string {
    const labels: Record<number, string> = {
      1: 'Moule / Decoupe',
      2: 'Entremets monte',
      3: 'Pieces individuelles',
      4: 'Petrissage / Cuisson',
      5: 'Laminage / Cuisson',
    };
    return labels[type] || 'Inconnu';
  },
};
