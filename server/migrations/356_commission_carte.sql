-- Migration 356 : commission sur les paiements par carte
--
-- POURQUOI
--   Le prestataire du terminal de paiement retient une commission sur chaque
--   transaction carte : une vente carte de 100 DH ne crédite que 98 DH sur le
--   compte bancaire (commission 2 %). Le solde carte de la Caisse et l'écriture
--   de vente portaient le montant brut, la banque réelle était donc surestimée.
--
-- PORTEE
--   Paramètre métier accounting.card_commission (taux en %), modifiable dans
--   Paramètres › Paramètres métier. Utilisé par :
--     - l'écriture de vente POS / saisie de shift : 5141 D net + 6147 Services
--       bancaires D commission (au lieu de 5141 D brut) ;
--     - l'écran Comptabilité › Caisse : solde carte = ventes carte − commission.
--   Taux initial 0 : rien ne change tant qu'il n'est pas saisi. Les écritures déjà
--   passées ne sont pas modifiées.
--
-- INVERSION
--   DELETE FROM module_parameters WHERE key = 'accounting.card_commission';

INSERT INTO module_parameters (key, value, description) VALUES
  ('accounting.card_commission', '{"pct": 0}'::jsonb,
   'Commission retenue par le prestataire de paiement sur chaque transaction carte, en % du montant encaissé.')
ON CONFLICT (key) DO NOTHING;
