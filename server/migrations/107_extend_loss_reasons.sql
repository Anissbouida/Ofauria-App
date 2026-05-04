-- Phase 3 + 5 : nouvelles valeurs de reason pour product_losses
--   - 'dlc_expiree'    : DLC depassee (Phase 3 destruction bloquante)
--   - 'dlv_expiree'    : DLV vitrine cumulee atteinte (Phase 3)
--   - 'ecart_inventaire': comptage physique inferieur au theorique (Phase 5)
ALTER TABLE product_losses DROP CONSTRAINT IF EXISTS product_losses_reason_check;
ALTER TABLE product_losses ADD CONSTRAINT product_losses_reason_check
  CHECK (reason::text = ANY (ARRAY[
    'brule', 'rate', 'machine', 'matiere_defectueuse', 'erreur_humaine',
    'chute', 'casse', 'qualite_non_conforme', 'retour_client', 'perime',
    'invendu_fin_journee', 'invendu_vitrine', 'recycle', 'autre',
    'dlc_expiree', 'dlv_expiree', 'ecart_inventaire'
  ]::varchar[]));
