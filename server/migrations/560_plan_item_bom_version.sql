-- M4-02 (plan d'action 2026-11) — version de nomenclature figée sur l'ordre.
--
-- production_plan_items.bom_version_id : version de la fiche (bom_versions, M4-01) en
-- vigueur à la date du plan, posée à la confirmation. Les besoins et le bon de sortie sont
-- calculés et enregistrés à la confirmation (production_ingredient_needs) : un ordre
-- confirmé garde ses quantités même si la fiche change ensuite. Les plans confirmés avant
-- cette migration restent sans version (leur coût reste l'instantané theo_*, mig 261).
--
-- INVERSION : ALTER TABLE production_plan_items DROP COLUMN bom_version_id;
ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS bom_version_id uuid REFERENCES bom_versions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_production_plan_items_bom_version ON production_plan_items (bom_version_id) WHERE bom_version_id IS NOT NULL;
