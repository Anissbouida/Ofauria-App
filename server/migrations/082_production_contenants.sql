-- Migration 082: Production containers (contenants) and product profiles
-- ADDITIVE ONLY — no existing tables or columns are modified

-- 1. Referentiel des contenants de production
CREATE TABLE IF NOT EXISTS production_contenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom VARCHAR(200) NOT NULL,
  type_production SMALLINT NOT NULL CHECK (type_production BETWEEN 1 AND 5),
  unite_lancement VARCHAR(30) NOT NULL DEFAULT 'unit',
  quantite_theorique DECIMAL(10,2) NOT NULL DEFAULT 1,
  pertes_fixes DECIMAL(10,2) NOT NULL DEFAULT 0,
  quantite_nette_cible DECIMAL(10,2) GENERATED ALWAYS AS (quantite_theorique - pertes_fixes) STORED,
  seuil_rendement_defaut DECIMAL(5,2) NOT NULL DEFAULT 90.00,
  etapes_defaut JSONB NOT NULL DEFAULT '[]',
  categories_pertes JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contenants_type ON production_contenants(type_production);
CREATE INDEX IF NOT EXISTS idx_contenants_active ON production_contenants(is_active) WHERE is_active = true;

-- 2. Profil de production par produit (lien produit → contenant + surcharges)
CREATE TABLE IF NOT EXISTS produit_profil_production (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  contenant_id UUID NOT NULL REFERENCES production_contenants(id) ON DELETE RESTRICT,
  surcharge_quantite_theorique DECIMAL(10,2),
  surcharge_pertes_fixes DECIMAL(10,2),
  surcharge_seuil_rendement DECIMAL(5,2),
  etapes_surcharges JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profil_prod_produit ON produit_profil_production(produit_id);
CREATE INDEX IF NOT EXISTS idx_profil_prod_contenant ON produit_profil_production(contenant_id);

-- 3. Seed des 9 contenants Ofauria
INSERT INTO production_contenants (nom, type_production, unite_lancement, quantite_theorique, pertes_fixes, seuil_rendement_defaut, etapes_defaut, categories_pertes) VALUES

-- Type 1 : Moule -> Decoupe
('Cadre 40x60cm', 1, 'cadre', 22, 2, 88.00,
 '[
   {"ordre": 1, "nom": "Preparation des bases", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Montage", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Uniformite du montage", "Epaisseur reguliere", "Pas de bulles d air"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Repos frigo", "duree_estimee_min": 120, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Finition et decoupe", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Decoupe nette", "Glacage uniforme", "Decoration conforme"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_bords", "pertes_accidents_decoupe", "pertes_qualite_visuelle"]'),

('Moule rond O20cm', 1, 'moule', 8, 0, 90.00,
 '[
   {"ordre": 1, "nom": "Preparation des bases", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Montage", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Uniformite du montage", "Epaisseur reguliere"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Repos frigo", "duree_estimee_min": 120, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Finition et decoupe", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Decoupe nette", "Decoration conforme"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_decoupe", "pertes_qualite_visuelle"]'),

-- Type 2 : Entremets monte
('Cercle entremets O18cm', 2, 'cercle', 8, 0, 90.00,
 '[
   {"ordre": 1, "nom": "Preparation des bases", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Montage en cercle", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Couches bien centrees", "Pas de debordement"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Congelation", "duree_estimee_min": 240, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Demoulage et glacage", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Glacage uniforme", "Pas de fissure", "Decoration conforme"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_montage", "pertes_demoulage", "pertes_qualite"]'),

('Cercle entremets O22cm', 2, 'cercle', 10, 0, 90.00,
 '[
   {"ordre": 1, "nom": "Preparation des bases", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Montage en cercle", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Couches bien centrees", "Pas de debordement"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Congelation", "duree_estimee_min": 240, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Demoulage et glacage", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Glacage uniforme", "Pas de fissure", "Decoration conforme"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_montage", "pertes_demoulage", "pertes_qualite"]'),

-- Type 3 : Pieces individuelles
('Fournee pieces seches', 3, 'fournee', 60, 5, 90.00,
 '[
   {"ordre": 1, "nom": "Preparation pate ou appareil", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Dressage ou moulage", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Cuisson", "duree_estimee_min": 15, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Refroidissement et finition", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Aspect uniforme", "Pas de casse"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_cuisson", "pertes_finition", "pertes_casse"]'),

('Fournee pieces garnies', 3, 'fournee', 48, 4, 88.00,
 '[
   {"ordre": 1, "nom": "Preparation pate ou fond", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Cuisson a blanc ou fonds", "duree_estimee_min": 12, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Garnissage", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Garnissage regulier", "Quantite conforme"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Finition et decoration", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Aspect conforme", "Pas de casse"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_cuisson", "pertes_finition", "pertes_casse"]'),

-- Type 4 : Petrissage -> Cuisson
('Kg pate boulangerie', 4, 'kg_pate', 4, 0, 90.00,
 '[
   {"ordre": 1, "nom": "Petrissage", "duree_estimee_min": 15, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Pate lisse et elastique", "Temperature pate OK"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Pointage", "duree_estimee_min": 60, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Division et facon", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Appret", "duree_estimee_min": 90, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 5, "nom": "Cuisson", "duree_estimee_min": 25, "est_bloquante": true, "timer_auto": true, "controle_qualite": true, "checklist_items": ["Coloration uniforme", "Son creux au tap"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["perte_poids_cuisson", "pertes_facade", "pieces_non_conformes"]'),

-- Type 5 : Laminage -> Cuisson
('Kg detrempe feuilletee', 5, 'kg_pate', 8, 0, 88.00,
 '[
   {"ordre": 1, "nom": "Petrissage detrempe", "duree_estimee_min": 10, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Poids cible verifie", "Temperature OK"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Repos frigo", "duree_estimee_min": 120, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Laminage", "duree_estimee_min": 10, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": true, "nb_repetitions": 3, "responsable_role": null},
   {"ordre": 4, "nom": "Repos entre tours", "duree_estimee_min": 30, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 5, "nom": "Faconnage", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 6, "nom": "Appret final", "duree_estimee_min": 120, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 7, "nom": "Cuisson", "duree_estimee_min": 18, "est_bloquante": true, "timer_auto": true, "controle_qualite": true, "checklist_items": ["Coloration doree", "Feuilletage developpe"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["pertes_laminage", "pertes_cuisson", "pieces_non_developpees"]'),

('Kg pate briochee', 4, 'kg_pate', 6, 0, 90.00,
 '[
   {"ordre": 1, "nom": "Petrissage", "duree_estimee_min": 20, "est_bloquante": true, "timer_auto": false, "controle_qualite": true, "checklist_items": ["Pate lisse", "Voile de gluten OK", "Temperature 24-26C"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 2, "nom": "Pointage", "duree_estimee_min": 60, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 3, "nom": "Division et facon", "duree_estimee_min": null, "est_bloquante": true, "timer_auto": false, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 4, "nom": "Appret", "duree_estimee_min": 90, "est_bloquante": true, "timer_auto": true, "controle_qualite": false, "checklist_items": [], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null},
   {"ordre": 5, "nom": "Dorage et cuisson", "duree_estimee_min": 20, "est_bloquante": true, "timer_auto": true, "controle_qualite": true, "checklist_items": ["Coloration uniforme", "Pas de dessechement"], "est_repetable": false, "nb_repetitions": 1, "responsable_role": null}
 ]',
 '["perte_poids_cuisson", "pertes_facade", "pieces_non_conformes"]')

ON CONFLICT DO NOTHING;
