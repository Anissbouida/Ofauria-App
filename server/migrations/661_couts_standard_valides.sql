-- ═══════════════════════════════════════════════════════════════════════
-- 661 — Coûts standard validés (le coût sort de la fiche technique)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   La fiche technique portait le coût, la marge, le prix conseillé, des frais indirects et un
--   multiplicateur. Les ERP du marché séparent les deux objets : la nomenclature et la gamme
--   disent quoi et comment (quantités, temps), le calcul du coût standard dit combien, à partir
--   de la nomenclature, des prix et des taux des centres. Le calcul validé devient le coût de
--   référence de l'article ; un nouveau calcul validé le remplace et l'ancien reste consultable.
--
-- QUOI
--   standard_costs : un calcul du coût standard figé (fiche × format × établissement).
--     status validated = coût de référence en vigueur (un seul par fiche, format, établissement) ;
--     status replaced  = ancien coût de référence, remplacé par une validation plus récente.
--   Les montants sont par pièce (ou par kg pour un format au poids). snapshot = le calcul complet
--   (postes, inducteurs, taux, avertissements) tel qu'il a été validé. recipe_version = numéro de
--   la dernière version de la fiche à la validation : une fiche modifiée depuis rend le coût
--   « à recalculer ».
--
-- INVERSION
--   DROP TABLE standard_costs ; DROP TRIGGER standard_costs_config_audit ON standard_costs.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS standard_costs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid REFERENCES stores(id),
  recipe_id       uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  format_id       uuid REFERENCES recipe_formats(id) ON DELETE SET NULL,
  product_id      uuid REFERENCES products(id) ON DELETE SET NULL,
  month           char(7) NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status          varchar(10) NOT NULL DEFAULT 'validated' CHECK (status IN ('validated', 'replaced')),
  pieces          integer,
  matiere         numeric(14, 4) NOT NULL DEFAULT 0,
  emballage       numeric(14, 4) NOT NULL DEFAULT 0,
  main_oeuvre     numeric(14, 4) NOT NULL DEFAULT 0,
  appro           numeric(14, 4) NOT NULL DEFAULT 0,
  production      numeric(14, 4) NOT NULL DEFAULT 0,
  structure       numeric(14, 4) NOT NULL DEFAULT 0,
  cout_production numeric(14, 4) NOT NULL,
  cout_revient    numeric(14, 4) NOT NULL,
  price_ht        numeric(14, 4),
  taux_marque     numeric(7, 2),
  recipe_version  integer,
  snapshot        jsonb NOT NULL,
  note            text,
  validated_by    uuid REFERENCES users(id),
  validated_at    timestamptz NOT NULL DEFAULT now(),
  replaced_at     timestamptz,
  replaced_by     uuid REFERENCES users(id),
  CHECK (status = 'validated' OR replaced_at IS NOT NULL)
);

-- Un seul coût de référence en vigueur par fiche, format et établissement.
CREATE UNIQUE INDEX IF NOT EXISTS ux_standard_costs_current
  ON standard_costs (recipe_id,
                     COALESCE(format_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'validated';
CREATE INDEX IF NOT EXISTS ix_standard_costs_recipe ON standard_costs (recipe_id, validated_at DESC);

COMMENT ON TABLE standard_costs IS
  'Mig 661 : coût standard validé d''un article (fiche × format × établissement). validated = coût de référence en vigueur ; replaced = remplacé par une validation plus récente. Montants par pièce ; snapshot = calcul complet au moment de la validation.';

-- Journal d'audit (mig 328), comme le paramétrage analytique (mig 658).
DROP TRIGGER IF EXISTS standard_costs_config_audit ON standard_costs;
CREATE TRIGGER standard_costs_config_audit AFTER INSERT OR UPDATE OR DELETE ON standard_costs
  FOR EACH ROW EXECUTE FUNCTION log_config_change('id', 'store_id');
