-- 720 — Modèles d'écritures livrés par profil (feuille de route, étape 7.2).
--
-- Le moteur des modèles d'écritures existe (mig 391) ; aucun profil n'en livrait. Couche
-- « entry_templates » du contenu de profil (industry-profile.ts) : comptes repérés par leur
-- code, journal des opérations diverses, montants à zéro saisis à l'utilisation. À
-- l'activation, un modèle n'est créé que si tous ses comptes existent dans le plan de la
-- société (sinon signalé). Plan comptable marocain (CGNC) : 6125 achats non stockés (dont
-- carburant), 6131 locations, 6133 entretien et réparations, 6142 transports, 4411
-- fournisseurs, 5141 banques. Contenu à faire valider par l'expert-comptable de la société.

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{entry_templates}', '[
  {"name": "Carburant du mois", "journal_code": "OD", "description": "Bons de carburant des véhicules, facture mensuelle du fournisseur.",
   "lines": [{"account_code": "6125", "side": "debit", "amount": 0, "label": "Carburant"}, {"account_code": "4411", "side": "credit", "amount": 0, "label": "Fournisseur de carburant"}]},
  {"name": "Péages et autoroutes", "journal_code": "OD", "description": "Péages payés par carte ou abonnement.",
   "lines": [{"account_code": "6142", "side": "debit", "amount": 0, "label": "Péages"}, {"account_code": "5141", "side": "credit", "amount": 0, "label": "Banque"}]},
  {"name": "Entretien des véhicules", "journal_code": "OD", "description": "Facture de garage (vidange, pneus, réparations).",
   "lines": [{"account_code": "6133", "side": "debit", "amount": 0, "label": "Entretien véhicules"}, {"account_code": "4411", "side": "credit", "amount": 0, "label": "Garage"}]}
]'::jsonb)
 WHERE code = 'transport' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'entry_templates');

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{entry_templates}', '[
  {"name": "Location d''engins de chantier", "journal_code": "OD", "description": "Facture de location (grue, pelle, échafaudage).",
   "lines": [{"account_code": "6131", "side": "debit", "amount": 0, "label": "Location d''engins"}, {"account_code": "4411", "side": "credit", "amount": 0, "label": "Loueur"}]},
  {"name": "Entretien du matériel de chantier", "journal_code": "OD", "description": "Réparations et entretien du matériel.",
   "lines": [{"account_code": "6133", "side": "debit", "amount": 0, "label": "Entretien matériel"}, {"account_code": "4411", "side": "credit", "amount": 0, "label": "Fournisseur"}]}
]'::jsonb)
 WHERE code = 'btp' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'entry_templates');

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{entry_templates}', '[
  {"name": "Loyer des bureaux", "journal_code": "OD", "description": "Loyer mensuel des locaux.",
   "lines": [{"account_code": "6131", "side": "debit", "amount": 0, "label": "Loyer"}, {"account_code": "4411", "side": "credit", "amount": 0, "label": "Bailleur"}]}
]'::jsonb)
 WHERE code = 'services' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'entry_templates');
