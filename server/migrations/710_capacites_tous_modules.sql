-- 710 — Capacités pour tous les modules (feuille de route « Kalum piloté par le profil », étape 1.3).
--
-- POURQUOI
--   Le catalogue app_features ne couvrait que Production, Stock, Contrôle et Articles. Un écran
--   de Ventes, d'Achats, de Comptabilité ou de Personnel ne pouvait être ni éteint ni réglé par
--   profil : une entreprise de BTP voyait les abonnements, les tournées de livraison, etc.
--
-- CE QUI CHANGE
--   - 18 capacités inscrites, une par écran existant (registre partagé
--     shared/src/constants/capability-screens.ts, qui porte aussi les routes d'API fermées).
--     Toutes default_on = true : AUCUN changement pour une société existante.
--   - sector_packs.off_features : capacités du socle qu'un profil éteint par défaut. La société
--     peut toujours les rallumer (Paramètres › Secteur et modules). Hérité par les profils enfants.
--   - Profils nouveaux sans usage de certains écrans : BTP, transport, services.

ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS off_features TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO app_features (key, module_key, label, description, sort_order, kind, requires, default_on) VALUES
  ('devis', 'sales', 'Devis et proformas', 'Devis clients, proformas et conversion en commande.', 300, 'fonction', '{}', true),
  ('contrats_cadres', 'sales', 'Contrats-cadres', 'Accords de prix et de volumes sur une période, appelés par les commandes.', 310, 'fonction', '{}', true),
  ('ristournes', 'sales', 'Ristournes', 'Remises de fin de période calculées sur le chiffre d''affaires d''un client.', 320, 'fonction', '{}', true),
  ('abonnements', 'sales', 'Abonnements', 'Facturation récurrente d''un client à échéances fixes.', 330, 'fonction', '{}', true),
  ('relances', 'sales', 'Relances clients', 'Niveaux de relance des impayés, lettres et blocage du crédit.', 340, 'fonction', '{}', true),
  ('objectifs_vente', 'sales', 'Objectifs de vente', 'Objectifs par vendeur, par période, comparés au réalisé.', 350, 'fonction', '{}', true),
  ('retours_transferts', 'sales', 'Retours et transferts', 'Retours des clients professionnels et transferts de produits entre points de vente.', 360, 'fonction', '{}', true),
  ('tournees_livraison', 'sales', 'Tournées de livraison', 'Tournées, arrêts et ordre de passage des livraisons aux clients.', 370, 'fonction', '{}', true),
  ('promotions_fidelite', 'pos', 'Promotions et fidélité', 'Promotions, codes de réduction et points de fidélité à la caisse.', 380, 'fonction', '{}', true),
  ('appels_offres', 'purchasing', 'Demandes de prix', 'Consultation de plusieurs fournisseurs et comparaison des offres.', 400, 'fonction', '{}', true),
  ('frais_approche', 'purchasing', 'Frais d''approche', 'Transport, douane et transit répartis sur le coût des articles reçus.', 410, 'fonction', '{}', true),
  ('evaluation_fournisseurs', 'purchasing', 'Évaluation des fournisseurs', 'Notes de délai, de qualité et de prix par fournisseur.', 420, 'fonction', '{}', true),
  ('immobilisations', 'accounting', 'Immobilisations', 'Registre des immobilisations, amortissements et cessions.', 500, 'fonction', '{}', true),
  ('charges_avance', 'accounting', 'Charges payées d''avance', 'Charges constatées d''avance étalées sur leur période.', 510, 'fonction', '{}', true),
  ('retenue_source', 'accounting', 'Retenues à la source', 'Retenues sur les factures fournisseurs et leur déclaration.', 520, 'fonction', '{}', true),
  ('analytique', 'accounting', 'Comptabilité analytique', 'Centres de coût et répartition analytique des écritures.', 530, 'fonction', '{}', true),
  ('avances_salaire', 'employees', 'Avances sur salaire', 'Avances versées aux employés et retenues sur la paie.', 600, 'fonction', '{}', true),
  ('commissions', 'employees', 'Commissions commerciales', 'Barèmes de commission par vendeur et relevés par période.', 610, 'fonction', '{}', true)
ON CONFLICT (key) DO NOTHING;

UPDATE sector_packs SET off_features = '{abonnements,tournees_livraison,retours_transferts}'
 WHERE code = 'btp' AND off_features = '{}';
UPDATE sector_packs SET off_features = '{retours_transferts}'
 WHERE code = 'transport' AND off_features = '{}';
UPDATE sector_packs SET off_features = '{frais_approche,retours_transferts,tournees_livraison}'
 WHERE code = 'services' AND off_features = '{}';
