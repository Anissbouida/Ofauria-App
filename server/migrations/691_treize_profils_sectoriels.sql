-- Assistant multisectoriel : les 13 profils de la maquette validée.
-- Additif : aucun module ni aucune capacité de la société active n'est modifié ;
-- seuls les libellés et descriptions de 4 profils existants sont alignés.

ALTER TABLE sector_packs DROP CONSTRAINT IF EXISTS chk_sector_packs_status;
ALTER TABLE sector_packs ADD CONSTRAINT chk_sector_packs_status
  CHECK (status = ANY (ARRAY['disponible', 'a_valider', 'sur_demande', 'nouveau']));
-- Profils proposés en carte dans l'assistant (les variantes restent sélectionnables ailleurs).
ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS in_wizard boolean NOT NULL DEFAULT false;

-- 1. Profils existants : libellés de la maquette, ordre d'affichage.
UPDATE sector_packs SET label = 'Boulangerie, pâtisserie et métiers de bouche', description = 'Fabrication quotidienne, vente en boutique et à la commande.', in_wizard = true, sort_order = 10 WHERE code = 'boulangerie';
UPDATE sector_packs SET description = 'Transformation par lots, traçabilité et dates de péremption.', in_wizard = true, sort_order = 20 WHERE code = 'agroalimentaire';
UPDATE sector_packs SET label = 'Industrie manufacturière', description = 'Fabrication en série ou à la commande, nomenclatures et gammes.', in_wizard = true, sort_order = 30 WHERE code = 'fabrication';
UPDATE sector_packs SET label = 'Commerce de gros et distribution', description = 'Achat, stockage et revente, tournées de livraison.', in_wizard = true, sort_order = 50 WHERE code = 'negoce';
UPDATE sector_packs SET sort_order = sort_order + 200 WHERE code IN ('agro_conditionne', 'process', 'discret', 'atelier', 'generique') AND sort_order < 200;

-- 2. Les 9 profils manquants (racines, sans héritage).
INSERT INTO sector_packs (code, label, description, enabled_modules, features, home_route, status, family, in_wizard, sort_order, is_default, inherits)
SELECT v.code, v.label, v.description, v.modules, v.features, v.home, 'nouveau', v.family, true, v.sort, false, false
FROM (VALUES
  ('commerce_detail', 'Commerce de détail', 'Magasins, caisse, réassort.',
   '{dashboard,users,settings,pos,sales,orders,products,customers,stock,purchasing,employees,accounting,reports,crm,packaging}'::text[], '{}'::text[], '/pos', 'sans_fabrication', 40),
  ('restauration', 'Restauration et hôtellerie', 'Service à table, cuisine, réservations.',
   '{dashboard,users,settings,pos,sales,orders,products,customers,stock,recipes,production,purchasing,employees,accounting,reports,controle}', '{haccp,ccp_cuisson}', '/pos', 'agroalimentaire', 60),
  ('btp', 'Bâtiment et travaux publics', 'Chantiers, situations de travaux, sous-traitants.',
   '{dashboard,users,settings,projects,purchasing,stock,sales,orders,customers,products,employees,accounting,reports,maintenance}', '{}', '/projects', 'sans_fabrication', 70),
  ('agriculture', 'Agriculture', 'Parcelles, campagnes, récoltes.',
   '{dashboard,users,settings,production,recipes,stock,purchasing,sales,orders,customers,products,employees,accounting,reports,maintenance,controle}', '{}', '/production', 'agroalimentaire', 80),
  ('textile', 'Textile et habillement', 'Tailles et coloris, façonniers, collections.',
   '{dashboard,users,settings,production,recipes,stock,purchasing,sales,orders,customers,products,employees,accounting,reports,controle}', '{sous_traitance}', '/production', 'industrie', 90),
  ('transport', 'Transport et logistique', 'Flotte, tournées, entreposage pour compte de tiers.',
   '{dashboard,users,settings,sales,orders,customers,products,stock,purchasing,employees,accounting,reports,maintenance,projects}', '{}', '/sales', 'sans_fabrication', 100),
  ('services', 'Services professionnels', 'Missions, temps passés, facturation à l''avancement.',
   '{dashboard,users,settings,sales,customers,crm,projects,purchasing,employees,accounting,reports}', '{}', '/projects', 'sans_fabrication', 110),
  ('sante', 'Santé et pharmacie', 'Lots, péremption, ordonnances.',
   '{dashboard,users,settings,pos,sales,orders,products,customers,stock,purchasing,employees,accounting,reports,controle}', '{quarantaine,rappel}', '/pos', 'sans_fabrication', 120),
  ('ecommerce', 'Commerce électronique', 'Boutique en ligne, expéditions, retours.',
   '{dashboard,users,settings,sales,orders,products,customers,stock,purchasing,crm,employees,accounting,reports,packaging}', '{}', '/sales', 'sans_fabrication', 130)
) AS v(code, label, description, modules, features, home, family, sort)
ON CONFLICT (code) DO NOTHING;

-- 3. Vocabulaire propre aux nouveaux profils (les autres termes gardent la valeur du socle).
INSERT INTO sector_labels (sector_pack, label_key, label_value)
SELECT v.p, v.k, v.l FROM (VALUES
  ('commerce_detail','product','Article'), ('commerce_detail','products','Articles'), ('commerce_detail','reserve_zone','Réserve magasin'),
  ('restauration','production','Cuisine'), ('restauration','product','Plat'), ('restauration','products','Plats'),
  ('restauration','recipe','Fiche recette'), ('restauration','recipes','Fiches recettes'),
  ('restauration','production_plan','Plan de production cuisine'), ('restauration','production_plans','Plans de production cuisine'), ('restauration','new_plan','Nouveau plan cuisine'),
  ('restauration','ingredient','Denrée'), ('restauration','ingredients','Denrées'), ('restauration','reserve_zone','Économat'),
  ('btp','product','Ouvrage'), ('btp','products','Ouvrages'), ('btp','ingredient','Matériau'), ('btp','ingredients','Matériaux'), ('btp','reserve_zone','Dépôt de chantier'),
  ('agriculture','production','Production agricole'), ('agriculture','production_plan','Campagne'), ('agriculture','production_plans','Campagnes'), ('agriculture','new_plan','Nouvelle campagne'),
  ('agriculture','recipe','Itinéraire technique'), ('agriculture','recipes','Itinéraires techniques'), ('agriculture','ingredient','Intrant'), ('agriculture','ingredients','Intrants'),
  ('agriculture','batch','Récolte'), ('agriculture','reserve_zone','Magasin d''intrants'),
  ('textile','production','Confection'), ('textile','production_plan','Ordre de confection'), ('textile','production_plans','Ordres de confection'), ('textile','new_plan','Nouvel ordre de confection'),
  ('textile','recipe','Fiche technique article'), ('textile','recipes','Fiches techniques articles'), ('textile','ingredient','Fourniture'), ('textile','ingredients','Fournitures'), ('textile','batch','Série'),
  ('transport','product','Prestation'), ('transport','products','Prestations'), ('transport','reserve_zone','Entrepôt'),
  ('services','product','Prestation'), ('services','products','Prestations'),
  ('sante','product','Produit de santé'), ('sante','products','Produits de santé'), ('sante','reserve_zone','Réserve'), ('sante','batch','Lot'),
  ('ecommerce','product','Article'), ('ecommerce','products','Articles'), ('ecommerce','reserve_zone','Entrepôt d''expédition')
) AS v(p, k, l)
WHERE EXISTS (SELECT 1 FROM sector_packs s WHERE s.code = v.p)
ON CONFLICT (sector_pack, label_key) DO NOTHING;

-- 4. Spécialités de chaque secteur. Celles qui fabriquent ouvrent un atelier ;
--    les autres n'apportent que leur intitulé (rôles et écrans viendront des profils).
INSERT INTO sector_specializations (code, label, sector_pack, description, content)
SELECT v.code, v.label, v.p, v.d, v.c::jsonb FROM (VALUES
  ('glacerie', 'Glacerie', 'boulangerie', 'Chaîne du froid, turbinage.', '{"workshop":{"code":"glacerie","label":"Glacerie"},"features":["lot_thermal"]}'),
  ('cafe_salon_the', 'Café et salon de thé', 'boulangerie', 'Service en salle.', '{}'),
  ('restauration_rapide', 'Restauration rapide', 'boulangerie', 'Vente sur place et à emporter.', '{"workshop":{"code":"snacking","label":"Snacking"}}'),
  ('production_artisanale', 'Production artisanale', 'boulangerie', 'Petites séries, plan du jour.', '{}'),
  ('production_industrielle', 'Production industrielle', 'boulangerie', 'Lignes, ordonnancement.', '{"features":["conditionnement"]}'),
  ('produits_conditionnes', 'Produits conditionnés', 'agroalimentaire', 'Lignes de conditionnement, étiquetage.', '{"workshop":{"code":"conditionnement","label":"Conditionnement"},"features":["conditionnement"]}'),
  ('produits_frais', 'Produits frais', 'agroalimentaire', 'Chaîne du froid, péremption courte.', '{"features":["lot_thermal"]}'),
  ('conserves_secs', 'Conserves et produits secs', 'agroalimentaire', 'Longue conservation.', '{}'),
  ('boissons', 'Boissons', 'agroalimentaire', 'Cuves, embouteillage.', '{"workshop":{"code":"embouteillage","label":"Embouteillage"}}'),
  ('fabrication_serie', 'Fabrication en série', 'fabrication', 'Ordres de série, déclaration en fin de poste.', '{}'),
  ('fabrication_commande', 'Fabrication à la commande', 'fabrication', 'Ordre par affaire, devis technique.', '{}'),
  ('assemblage', 'Assemblage', 'fabrication', 'Sous-ensembles, numéros de série.', '{"workshop":{"code":"assemblage","label":"Assemblage"}}'),
  ('alimentation_generale', 'Alimentation générale', 'commerce_detail', 'Caisse rapide, péremption.', '{}'),
  ('habillement_detail', 'Habillement', 'commerce_detail', 'Tailles et coloris.', '{}'),
  ('equipement_maison', 'Équipement de la maison', 'commerce_detail', 'Livraison, garanties.', '{}'),
  ('gros_alimentaire', 'Alimentaire', 'negoce', 'Lots et péremption.', '{}'),
  ('materiaux_quincaillerie', 'Matériaux et quincaillerie', 'negoce', 'Vente au mètre, au poids.', '{}'),
  ('importation', 'Importation', 'negoce', 'Frais d''approche, devises.', '{}'),
  ('tournees_livraison', 'Tournées de livraison', 'negoce', 'Vendeurs-livreurs.', '{}'),
  ('restaurant', 'Restaurant', 'restauration', 'Service à table, carte et menus.', '{"workshop":{"code":"cuisine","label":"Cuisine"}}'),
  ('hotel', 'Hôtel', 'restauration', 'Chambres, petit-déjeuner, room service.', '{}'),
  ('traiteur_evenementiel', 'Traiteur événementiel', 'restauration', 'Banquets, devis, livraison.', '{}'),
  ('gros_oeuvre', 'Gros œuvre', 'btp', 'Maçonnerie, structure, béton.', '{}'),
  ('second_oeuvre', 'Second œuvre', 'btp', 'Plomberie, électricité, finitions.', '{}'),
  ('travaux_publics', 'Travaux publics', 'btp', 'Voirie, réseaux, terrassement.', '{}'),
  ('maraichage', 'Maraîchage', 'agriculture', 'Cultures légumières, rotations.', '{}'),
  ('arboriculture', 'Arboriculture', 'agriculture', 'Vergers, oliviers, agrumes.', '{}'),
  ('elevage', 'Élevage', 'agriculture', 'Cheptel, alimentation, production animale.', '{}'),
  ('confection', 'Confection', 'textile', 'Coupe, montage, finition.', '{"workshop":{"code":"confection","label":"Confection"}}'),
  ('broderie_impression', 'Broderie et impression', 'textile', 'Personnalisation, marquage.', '{}'),
  ('negoce_textile', 'Négoce textile', 'textile', 'Collections, façonniers.', '{}'),
  ('transport_marchandises', 'Transport de marchandises', 'transport', 'Lots complets, groupage.', '{}'),
  ('messagerie', 'Messagerie et livraison', 'transport', 'Colis, tournées urbaines.', '{}'),
  ('entreposage', 'Entreposage pour tiers', 'transport', 'Stockage, préparation, facturation à l''emplacement.', '{}'),
  ('conseil_etudes', 'Conseil et études', 'services', 'Missions au forfait ou au temps passé.', '{}'),
  ('formation', 'Formation', 'services', 'Sessions, participants.', '{}'),
  ('maintenance_interventions', 'Maintenance et interventions', 'services', 'Contrats, bons d''intervention.', '{}'),
  ('agence_creation', 'Agence et création', 'services', 'Projets, jalons.', '{}'),
  ('pharmacie', 'Pharmacie', 'sante', 'Ordonnances, tiers payant.', '{}'),
  ('parapharmacie', 'Parapharmacie', 'sante', 'Cosmétique, hygiène, conseil.', '{}'),
  ('materiel_medical', 'Matériel médical', 'sante', 'Location, numéros de série.', '{"features":["series"]}'),
  ('boutique_en_ligne', 'Boutique en ligne', 'ecommerce', 'Catalogue, paiement, expédition.', '{}'),
  ('marketplace', 'Places de marché', 'ecommerce', 'Ventes sur plateformes tierces.', '{}'),
  ('retours_sav', 'Retours et service client', 'ecommerce', 'Retours, échanges, remboursements.', '{}')
) AS v(code, label, p, d, c)
WHERE EXISTS (SELECT 1 FROM sector_packs s WHERE s.code = v.p)
ON CONFLICT (code) DO NOTHING;
