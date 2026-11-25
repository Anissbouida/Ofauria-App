-- Modèle opérationnel et règles de gestion (assistant multisectoriel).
-- Valeurs initiales = comportement d'avant : aucune règle métier ne change à la migration.
INSERT INTO module_parameters (key, value, description) VALUES
  ('production.demand_source', '{"mode": "both"}',
   'Déclenchement de la production : prévision (sur stock), commandes, ou les deux (plan directeur, besoins nets).'),
  ('production.flow', '{"recipe_required": false, "material_issue_required": true, "quality_before_transfer": true, "transfer_reception": true}',
   'Parcours d''une production : fiche technique, bon de sortie, contrôle qualité avant transfert, validation du transfert.'),
  ('stock.low_stock_alerts', '{"enabled": true}',
   'Alertes de stock bas : listes d''alerte, tableau de bord, propositions d''achat.')
ON CONFLICT (key) DO NOTHING;
