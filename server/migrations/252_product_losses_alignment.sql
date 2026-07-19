-- Migration 252 : aligner les CHECK product_losses avec les valeurs reellement
-- utilisees par le code, et empecher le hard-delete d'une perte sans miroir
-- transactionnel (traitement complet cote controller — cf. N9 de l'audit).
--
-- Constats corriges :
--   * 'ecart_ouverture' etait introduit par la mig 251 (validateOpeningCheck
--     approve avec manquants) mais pas present dans le CHECK -> INSERT
--     casserait avec 23514. On l'ajoute.
--   * Divergence validator (Zod accepte 'casse'/'non_vendu') vs CHECK DB
--     (refuses) etait deja partiellement corrigee (mig 068), on realigne le
--     validator cote code TS dans un commit separe.

BEGIN;

ALTER TABLE product_losses DROP CONSTRAINT IF EXISTS product_losses_reason_check;
ALTER TABLE product_losses ADD CONSTRAINT product_losses_reason_check
  CHECK (reason::text = ANY (ARRAY[
    'brule', 'rate', 'machine', 'matiere_defectueuse', 'erreur_humaine',
    'chute', 'casse', 'qualite_non_conforme', 'retour_client', 'perime',
    'invendu_fin_journee', 'invendu_vitrine', 'recycle', 'autre',
    'dlc_expiree', 'dlv_expiree', 'ecart_inventaire', 'ecart_ouverture'
  ]::varchar[]));

COMMIT;
