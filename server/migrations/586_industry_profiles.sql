-- ═══════════════════════════════════════════════════════════════════════
-- 586 — Profils d'industrie (C-01, C-05)
--
--   sector_packs.profile : couches « production » d'un secteur, appliquées par « Charger les
--   données de départ » sans rien écraser (services/industry-profile.ts) :
--     { "order_types": [...], "policies": [{key, value}], "print_templates": [...] }
--
--   Trois profils de référence (matrice 2 ter.5 du plan, valeurs PROPOSÉES, à relire avec
--   une personne du métier avant de les proposer à un client), bâtis sur « Fabrication »
--   (modules, options et vocabulaire neutre hérités) :
--     process  — cosmétique, agroalimentaire : ordre de lot, bon de sortie pesé, contrôle,
--                libération manuelle des lots, coût au poids ; « lot, formule, semi-fini » ;
--     discret  — meuble en série : ordre de série sans bon de sortie (consommation à la
--                déclaration), coût à la quantité, opérations de gamme ; « série » ;
--     atelier  — métallerie, sur-mesure : ordre d'affaire, consommation manuelle par affaire,
--                coût par parts saisies, sous-traitance ; « affaire ».
--
-- INVERSION
--   DELETE FROM sector_labels WHERE sector_pack IN ('process', 'discret', 'atelier') ;
--   DELETE FROM sector_packs WHERE code IN ('process', 'discret', 'atelier') AND NOT EXISTS
--     (SELECT 1 FROM company_settings WHERE sector_pack IN ('process', 'discret', 'atelier')) ;
--   ALTER TABLE sector_packs DROP COLUMN profile.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE sector_packs ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN sector_packs.profile IS 'Couches production du profil (types d''ordre, politiques, impressions), appliquées sans écraser (mig 586).';

INSERT INTO sector_packs (code, label, enabled_modules, features, home_route, report_keys, is_default, is_custom, base_sector, starter, profile)
SELECT v.code, v.label, f.enabled_modules, f.features, f.home_route, f.report_keys, false, false, 'fabrication', '{}'::jsonb, v.profile::jsonb
  FROM sector_packs f
 CROSS JOIN (VALUES
  ('process', 'Industrie — process (cosmétique, agroalimentaire)', $p$
   {"order_types": [
      {"code": "ORDRE_LOT", "label": "Ordre de lot", "requires_bon_sortie": true, "requires_weighing": true, "requires_quality_check": true,
       "consumption_mode": "au_bon_de_sortie", "is_subcontracting": false, "is_default": true}],
    "policies": [
      {"key": "production.cost_allocation_key", "value": {"key": "poids"}},
      {"key": "quality.auto_release", "value": {"enabled": false}}],
    "print_templates": [
      {"doc_type": "production_bon_sortie", "title": "Bon de sortie matières", "layout": {"signatures": ["Responsable de fabrication", "Magasinier", "Contrôle qualité"]}, "footer_note": null},
      {"doc_type": "production_fiche", "title": "Dossier de lot", "layout": {"signatures": ["Responsable de fabrication", "Responsable qualité (libération)"]}, "footer_note": null}]}
  $p$),
  ('discret', 'Industrie — discret sur stock (série)', $p$
   {"order_types": [
      {"code": "ORDRE_SERIE", "label": "Ordre de série", "requires_bon_sortie": false, "requires_weighing": false, "requires_quality_check": false,
       "consumption_mode": "a_la_declaration", "is_subcontracting": false, "is_default": true},
      {"code": "SOUS_TRAITANCE", "label": "Sous-traitance", "requires_bon_sortie": false, "requires_weighing": false, "requires_quality_check": false,
       "consumption_mode": "a_la_declaration", "is_subcontracting": true, "is_default": false}],
    "policies": [
      {"key": "production.cost_allocation_key", "value": {"key": "quantite"}},
      {"key": "production.steps_source", "value": {"source": "gamme"}}],
    "print_templates": [
      {"doc_type": "production_fiche", "title": "Fiche de série", "layout": {"signatures": ["Chef d'atelier", "Contrôle final"]}, "footer_note": null}]}
  $p$),
  ('atelier', 'Atelier à la commande (métallerie, sur-mesure)', $p$
   {"order_types": [
      {"code": "ORDRE_AFFAIRE", "label": "Ordre d'affaire", "requires_bon_sortie": false, "requires_weighing": false, "requires_quality_check": false,
       "consumption_mode": "manuel", "is_subcontracting": false, "is_default": true},
      {"code": "SOUS_TRAITANCE", "label": "Sous-traitance", "requires_bon_sortie": false, "requires_weighing": false, "requires_quality_check": false,
       "consumption_mode": "a_la_declaration", "is_subcontracting": true, "is_default": false}],
    "policies": [
      {"key": "production.cost_allocation_key", "value": {"key": "manuelle"}},
      {"key": "production.steps_source", "value": {"source": "gamme"}}],
    "print_templates": [
      {"doc_type": "production_fiche", "title": "Fiche d'affaire", "layout": {"signatures": ["Chef d'atelier", "Client (réception)"]}, "footer_note": null},
      {"doc_type": "production_bon_sortie", "title": "Bon de sortie atelier", "layout": {}, "footer_note": null}]}
  $p$)
 ) AS v(code, label, profile)
 WHERE f.code = 'fabrication'
ON CONFLICT (code) DO NOTHING;

-- Vocabulaire propre (le reste hérite de « Fabrication », mig 580).
INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES
  ('process', 'production_plan', 'Ordre de lot'), ('process', 'production_plans', 'Ordres de lot'),
  ('process', 'new_plan', 'Nouvel ordre de lot'), ('process', 'batch', 'Lot'), ('process', 'batch_cost', 'Coût du lot'),
  ('process', 'recipe', 'Formule'), ('process', 'recipes', 'Formules'),
  ('process', 'finished_products_tab', 'Formules produits finis'),
  ('process', 'base_prep', 'Semi-fini'), ('process', 'base_preps', 'Semi-finis'),
  ('process', 'search_recipes', 'Rechercher une formule ou un article…'),
  ('process', 'search_base_preps', 'Rechercher un semi-fini…'),
  ('discret', 'production_plan', 'Ordre de série'), ('discret', 'production_plans', 'Ordres de série'),
  ('discret', 'new_plan', 'Nouvel ordre de série'), ('discret', 'batch', 'Série'), ('discret', 'batch_cost', 'Coût de la série'),
  ('atelier', 'production_plan', 'Ordre d''affaire'), ('atelier', 'production_plans', 'Ordres d''affaire'),
  ('atelier', 'new_plan', 'Nouvelle affaire'), ('atelier', 'batch', 'Affaire'), ('atelier', 'batch_cost', 'Coût de l''affaire')
ON CONFLICT DO NOTHING;
