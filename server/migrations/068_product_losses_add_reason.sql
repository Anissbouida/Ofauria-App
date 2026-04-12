-- Fix loss_type constraint: add 'vitrine' (invendus fin de journee)
ALTER TABLE product_losses DROP CONSTRAINT IF EXISTS product_losses_loss_type_check;
ALTER TABLE product_losses ADD CONSTRAINT product_losses_loss_type_check CHECK (loss_type IN (
  'production', 'vitrine', 'perime', 'recyclage'
));

-- Fix reason constraint: add 'invendu_vitrine'
ALTER TABLE product_losses DROP CONSTRAINT IF EXISTS product_losses_reason_check;
ALTER TABLE product_losses ADD CONSTRAINT product_losses_reason_check CHECK (reason IN (
  'brule', 'rate', 'machine', 'matiere_defectueuse', 'erreur_humaine',
  'chute', 'casse', 'qualite_non_conforme', 'retour_client',
  'perime', 'invendu_fin_journee', 'invendu_vitrine',
  'recycle', 'autre'
));
