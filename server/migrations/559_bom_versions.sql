-- M4-01 (plan d'action 2026-11) — versions de nomenclature avec statut et validité.
--
-- recipe_versions (mig 041/346) reste l'historique des instantanés pris AVANT chaque
-- modification. On ajoute le cycle de vie industriel :
--   bom_versions : version numérotée d'une fiche, statut brouillon | active | obsolete,
--     validité (valid_from, valid_to), motif, contenu figé (snapshot) ; une seule version
--     active par fiche ; une version active ou obsolète n'est jamais modifiée.
--   fn_recipe_bom_snapshot(fiche) : le contenu complet de la nomenclature (en-tête,
--     ingrédients, sous-recettes, composants, formats et leurs composants, emballages),
--     ordonné, sans identifiants de lignes ni horodatages — deux contenus identiques
--     donnent le même JSON. Sert au rattrapage, à l'activation et à la détection des
--     modifications non activées.
-- La fiche courante est la copie de travail : « activer » fige son contenu en version
-- N+1 active et rend la version précédente obsolète (valid_to = veille de la date d'effet).
-- ÉCART AU PLAN : les lignes de composition ne portent pas de version_id ; la version est
-- un instantané immuable.
-- Rattrapage : chaque fiche non archivée reçoit une version 1 active, valide depuis sa
-- date de création, au contenu actuel.
--
-- INVERSION : DROP TABLE bom_versions; DROP FUNCTION trg_fn_bom_version_frozen(), fn_recipe_bom_snapshot(uuid);

CREATE OR REPLACE FUNCTION fn_recipe_bom_snapshot(p_recipe uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'header', (SELECT jsonb_build_object(
        'name', r.name, 'is_base', r.is_base, 'yield_quantity', r.yield_quantity, 'yield_unit', r.yield_unit,
        'mode_cout', r.mode_cout, 'perte_standard_pct', r.perte_standard_pct, 'piece_weight_kg', r.piece_weight_kg,
        'pieces_par_fournee', r.pieces_par_fournee, 'compo_par_piece', r.compo_par_piece, 'contenant_id', r.contenant_id,
        'etapes', r.etapes, 'instructions', r.instructions)
      FROM recipes r WHERE r.id = p_recipe),
    'ingredients', COALESCE((SELECT jsonb_agg(jsonb_build_object('ingredient_id', ri.ingredient_id, 'name', g.name,
        'quantity', ri.quantity, 'unit', ri.unit) ORDER BY g.name, ri.ingredient_id, ri.quantity)
      FROM recipe_ingredients ri JOIN ingredients g ON g.id = ri.ingredient_id WHERE ri.recipe_id = p_recipe), '[]'::jsonb),
    'sub_recipes', COALESCE((SELECT jsonb_agg(jsonb_build_object('sub_recipe_id', s.sub_recipe_id, 'name', r2.name, 'quantity', s.quantity)
        ORDER BY r2.name, s.sub_recipe_id)
      FROM recipe_sub_recipes s JOIN recipes r2 ON r2.id = s.sub_recipe_id WHERE s.recipe_id = p_recipe), '[]'::jsonb),
    'components', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', c.role, 'source_recipe_id', c.source_recipe_id,
        'source_ingredient_id', c.source_ingredient_id, 'name', COALESCE(br.name, g.name), 'quantite', c.quantite, 'unite', c.unite,
        'perte_pct', c.perte_pct, 'ordre', c.ordre) ORDER BY c.ordre, COALESCE(br.name, g.name))
      FROM recipe_components c LEFT JOIN recipes br ON br.id = c.source_recipe_id LEFT JOIN ingredients g ON g.id = c.source_ingredient_id
      WHERE c.recipe_id = p_recipe), '[]'::jsonb),
    'formats', COALESCE((SELECT jsonb_agg(jsonb_build_object('format_id', f.id, 'contenant_id', f.contenant_id,
        'quantite_par_format', f.quantite_par_format, 'quantite_par_format_unite', f.quantite_par_format_unite,
        'nb_par_defaut', f.nb_par_defaut, 'nb_parts', f.nb_parts, 'is_default', f.is_default, 'is_active', f.is_active,
        'poids_cru_g', f.poids_cru_g, 'poids_cuit_g', f.poids_cuit_g, 'product_id', f.product_id,
        'components', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', fc.role, 'source_recipe_id', fc.source_recipe_id,
            'source_ingredient_id', fc.source_ingredient_id, 'name', COALESCE(br.name, g.name), 'quantite', fc.quantite,
            'unite', fc.unite, 'perte_pct', fc.perte_pct, 'ordre', fc.ordre) ORDER BY fc.ordre, COALESCE(br.name, g.name))
          FROM recipe_format_components fc LEFT JOIN recipes br ON br.id = fc.source_recipe_id LEFT JOIN ingredients g ON g.id = fc.source_ingredient_id
          WHERE fc.format_id = f.id), '[]'::jsonb)) ORDER BY f.ordre, f.id)
      FROM recipe_formats f WHERE f.recipe_id = p_recipe), '[]'::jsonb),
    'packaging', COALESCE((SELECT jsonb_agg(jsonb_build_object('packaging_id', rp.packaging_id, 'quantity', rp.quantity, 'unit', rp.unit)
        ORDER BY rp.packaging_id, rp.quantity)
      FROM recipe_packaging rp WHERE rp.recipe_id = p_recipe), '[]'::jsonb)
  )
$$;

CREATE TABLE IF NOT EXISTS bom_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version_no    integer NOT NULL CHECK (version_no > 0),
  status        varchar(10) NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'active', 'obsolete')),
  valid_from    date,
  valid_to      date,
  reason        text,
  snapshot      jsonb NOT NULL,
  unit_cost     numeric(14,4),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, version_no),
  CONSTRAINT chk_bom_version_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from - 1),
  CONSTRAINT chk_bom_version_active_dates CHECK (status <> 'active' OR (valid_from IS NOT NULL AND valid_to IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bom_versions_one_active ON bom_versions (recipe_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bom_versions_recipe ON bom_versions (recipe_id, version_no DESC);

-- Une version active ou obsolète est figée : contenu, numéro et fiche ne changent plus,
-- et une version obsolète ne redevient pas active.
CREATE OR REPLACE FUNCTION trg_fn_bom_version_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('active', 'obsolete')
     AND (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.version_no <> OLD.version_no OR NEW.recipe_id <> OLD.recipe_id
          OR (OLD.status = 'obsolete' AND NEW.status <> 'obsolete')) THEN
    RAISE EXCEPTION 'VERSION_FIGEE: la version % de la fiche est figée (statut %)', OLD.version_no, OLD.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bom_version_frozen ON bom_versions;
CREATE TRIGGER trg_bom_version_frozen BEFORE UPDATE ON bom_versions FOR EACH ROW EXECUTE FUNCTION trg_fn_bom_version_frozen();

INSERT INTO bom_versions (recipe_id, version_no, status, valid_from, reason, snapshot, unit_cost, activated_at)
SELECT r.id, 1, 'active', (r.created_at AT TIME ZONE 'Africa/Casablanca')::date, 'Reprise : contenu de la fiche au passage aux versions',
       fn_recipe_bom_snapshot(r.id),
       (SELECT v.total_cost / NULLIF(r.yield_quantity, 0) FROM v_recipe_total_cost_v2 v WHERE v.id = r.id), now()
  FROM recipes r
 WHERE r.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM bom_versions b WHERE b.recipe_id = r.id);
