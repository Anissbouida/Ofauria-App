-- 724 — Types de mouvement de stock (refonte Stock, maquettes « Refonte Stock »).
--
-- Référentiel à comportements (architecture des mig 698 et 701) : chaque type de mouvement
-- porte dans metadata ce que l'écran exige. Deux comportements ont un effet :
--   control      (réception)      : lot reçu en quarantaine jusqu'au contrôle conforme ;
--   segregation  (bon de sortie)  : qui a préparé ou remis le bon ne réceptionne pas.
-- Ils s'ajoutent aux politiques existantes (purchasing.reception_quarantine,
-- production.segregation_of_duties) : l'une OU l'autre suffit. Valeurs livrées = règles
-- d'aujourd'hui (tout à « non ») : aucun changement pour une société existante.
-- La liste des mouvements (Stock › Mouvements) regroupe le journal par type.
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order, module) VALUES
  ('stock_movement_types', 'Types de mouvement', 'Mouvements du stock (bon de sortie, réception, ouverture de contenant, perte…) et ce que chacun exige.', 'ArrowLeftRight', 'ref_entries', true, 30, 'stock')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, icon, color, display_order, metadata, sectors, excluded_sectors, origin, is_active, activation, system_label)
SELECT 'stock_movement_types', v.c, v.l, v.d, v.i, v.col, v.o, v.m::jsonb, '{}', '{}', 'system', true, 'auto', v.l
FROM (VALUES
  ('bon_sortie', 'Bon de sortie', 'Matières préparées et pesées pour un ordre de fabrication, remises à l''atelier.', 'Scale', '#2563eb', 10, '{"direction":"sort","control":false,"segregation":false}'),
  ('reception', 'Réception', 'Entrée de marchandise d''un fournisseur.', 'Truck', '#059669', 20, '{"direction":"entre","control":false,"segregation":false}'),
  ('ouverture', 'Ouverture de contenant', 'Un contenant fermé de la réserve passe au poste de pesée.', 'PackageOpen', '#7c3aed', 30, '{"direction":"deplace","control":false,"segregation":false}'),
  ('transfert', 'Transfert', 'Déplacement entre emplacements.', 'ArrowLeftRight', '#0891b2', 40, '{"direction":"deplace","control":false,"segregation":false}'),
  ('perte', 'Perte', 'Matière jetée : périmée, abîmée, non conforme.', 'Trash2', '#dc2626', 50, '{"direction":"sort","control":false,"segregation":false}'),
  ('ajustement', 'Ajustement', 'Correction d''inventaire ou de saisie.', 'SlidersHorizontal', '#64748b', 60, '{"direction":"corrige","control":false,"segregation":false}'),
  ('retour', 'Retour', 'Matière rendue par l''atelier.', 'Undo2', '#ca8a04', 70, '{"direction":"entre","control":false,"segregation":false}'),
  ('consommation', 'Consommation directe', 'Sortie sans bon de sortie.', 'ArrowDownRight', '#475569', 80, '{"direction":"sort","control":false,"segregation":false}')
) AS v(c, l, d, i, col, o, m)
ON CONFLICT (table_id, code) DO NOTHING;
