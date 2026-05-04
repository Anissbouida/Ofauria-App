-- Migration 091: Contenants pour cremes et appareils de base (semi-finis)
-- Produits de base mesures en kg : creme patissiere, creme diplomate,
-- ganache, creme d'amande, creme mousseline, appareil a flan, etc.
-- Type 4 (Petrissage / Cuisson) en mode poids (kg_pate)

INSERT INTO production_contenants (nom, type_production, unite_lancement, quantite_theorique, pertes_fixes, seuil_rendement_defaut, etapes_defaut, categories_pertes) VALUES

-- Creme patissiere et cremes cuites
('Kg creme patissiere', 4, 'kg_pate', 5, 0.15, 95.00,
 '[
   {"ordre": 1, "nom": "Preparation ingredients", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Pesee ingredients conforme", "Lait frais verifie"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Chauffer le lait", "duree_estimee_min": 8, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Blanchir jaunes et sucre", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Cuisson creme", "duree_estimee_min": 10, "est_bloquante": true, "timer_auto": true, "controle_qualite": true, "checklist_items": ["Texture nappante", "Pas de grumeaux", "Bouillonnement atteint"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 5, "nom": "Refroidissement", "duree_estimee_min": 30, "est_bloquante": true, "timer_auto": true, "controle_qualite": true, "checklist_items": ["Film au contact pose", "Temperature < 10C"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_fond_casserole", "pertes_transfert", "pertes_qualite"]'),

-- Ganache (chocolat + creme)
('Kg ganache', 4, 'kg_pate', 3, 0.10, 95.00,
 '[
   {"ordre": 1, "nom": "Preparation ingredients", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Pesee ingredients conforme", "Chocolat hache finement"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Chauffer la creme", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Emulsionner", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Emulsion lisse et brillante", "Pas de grumeaux"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Refroidissement et cristallisation", "duree_estimee_min": 60, "est_bloquante": true, "timer_auto": true, "controle_qualite": true, "checklist_items": ["Film au contact pose", "Temperature cible atteinte"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_fond_casserole", "pertes_transfert", "pertes_qualite"]'),

-- Creme d'amande (tartes, galettes)
('Kg creme d amande', 4, 'kg_pate', 4, 0.05, 97.00,
 '[
   {"ordre": 1, "nom": "Preparation ingredients", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Pesee conforme", "Beurre pommade"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Cremage beurre et sucre", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Incorporation oeufs et poudre amande", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Texture homogene", "Pas de grumeaux"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Repos frigo", "duree_estimee_min": 30, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_transfert", "pertes_qualite"]'),

-- Appareil a flan / creme prise
('Kg appareil a flan', 4, 'kg_pate', 5, 0.10, 96.00,
 '[
   {"ordre": 1, "nom": "Preparation ingredients", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Pesee conforme", "Lait et creme frais"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Chauffer lait et creme", "duree_estimee_min": 8, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Melanger oeufs et sucre", "duree_estimee_min": 3, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Assembler et chinoiser", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Appareil lisse", "Pas de grumeaux"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_chinois", "pertes_transfert", "pertes_qualite"]'),

-- Creme mousseline (creme pat + beurre)
('Kg creme mousseline', 4, 'kg_pate', 4, 0.10, 95.00,
 '[
   {"ordre": 1, "nom": "Preparer la creme patissiere", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Creme pat a temperature ambiante"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Cremer le beurre", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Beurre pommade", "Texture souple"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Incorporer beurre dans creme pat", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Texture lisse et aerienne", "Pas de granule de beurre"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Repos frigo", "duree_estimee_min": 30, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_transfert", "pertes_qualite"]'),

-- Sirop d'imbibage
('Kg sirop imbibage', 4, 'kg_pate', 3, 0.05, 98.00,
 '[
   {"ordre": 1, "nom": "Chauffer eau et sucre", "duree_estimee_min": 5, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Aromatiser", "duree_estimee_min": 2, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Dosage arome conforme"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Refroidissement", "duree_estimee_min": 30, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_evaporation", "pertes_transfert"]')

ON CONFLICT DO NOTHING;
