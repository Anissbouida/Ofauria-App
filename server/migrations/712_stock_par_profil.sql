-- 712 — Stock selon le profil (feuille de route « Kalum piloté par le profil », phase 2).
--
-- Audit court (étape 2.1) : la quarantaine à la réception (requires_qc, mig 461), la libération
-- des lots, les emplacements à rôles (mig 642) et les réservations (mig 389, réservation de
-- matière) existent déjà. Restaient trois manques, comblés ici :
--
--   1. Quarantaine imposée par le profil : politique purchasing.reception_quarantine. Activée
--      dans le profil Santé et pharmacie, tout lot reçu entre en quarantaine jusqu'au contrôle
--      conforme, même si l'article ne l'exige pas.
--   2. Lieux typés : rôles « chantier » (stock sur un chantier, rattaché à un projet) et « quai »
--      (réception et expédition d'un entrepôt). stock_locations.project_id facultatif.
--      Profils BTP et transport : emplacements de départ.
--   3. Stock pour le compte d'un client (capacité stock_deposant, éteinte par défaut, active
--      dans le profil transport) : ingredient_lots.owner_customer_id. Un lot qui appartient à un
--      client n'entre pas dans la valeur du stock de la société.

-- 1. Politique de quarantaine (catalogue : server/src/services/parameters-catalog.ts).
UPDATE sector_packs
   SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{policies}',
         COALESCE(profile->'policies', '[]'::jsonb)
         || '[{"key": "purchasing.reception_quarantine", "value": {"enabled": true}}]'::jsonb)
 WHERE code = 'sante'
   AND NOT (COALESCE(profile->'policies', '[]'::jsonb) @> '[{"key": "purchasing.reception_quarantine"}]'::jsonb);

-- 2. Rôles chantier et quai.
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_role_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_role_check CHECK (role IN (
  'reserve', 'en_cours_ouvert', 'atelier', 'froid_positif', 'froid_negatif', 'vente',
  'quarantaine', 'expedition', 'chantier', 'quai'));
ALTER TABLE stock_locations ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_locations_project ON stock_locations(project_id) WHERE project_id IS NOT NULL;

UPDATE sector_packs
   SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{locations}', '[
     {"code": "DEPOT", "name": "Dépôt central", "type": "sec", "temp_min": null, "temp_max": null, "role": "reserve"},
     {"code": "CHANTIER", "name": "Stock de chantier (à rattacher à un projet)", "type": "sec", "temp_min": null, "temp_max": null, "role": "chantier"}
   ]'::jsonb)
 WHERE code = 'btp' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'locations');
UPDATE sector_packs
   SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{locations}', '[
     {"code": "QUAI", "name": "Quai de réception et d''expédition", "type": "sec", "temp_min": null, "temp_max": null, "role": "quai"},
     {"code": "ENTREPOT", "name": "Entrepôt", "type": "sec", "temp_min": null, "temp_max": null, "role": "reserve"}
   ]'::jsonb)
 WHERE code = 'transport' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'locations');

-- 3. Stock pour le compte d'un client.
ALTER TABLE ingredient_lots ADD COLUMN IF NOT EXISTS owner_customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_ingredient_lots_owner ON ingredient_lots(owner_customer_id) WHERE owner_customer_id IS NOT NULL;
COMMENT ON COLUMN ingredient_lots.owner_customer_id IS
  'Client propriétaire (entrepôt pour compte de tiers, capacité stock_deposant). NULL = stock de la société. Exclu de la valorisation.';

INSERT INTO app_features (key, module_key, label, description, sort_order, kind, requires, default_on) VALUES
  ('stock_deposant', 'stock', 'Stock pour le compte de clients',
   'Lots détenus pour un client (entrepôt logistique) : suivis par propriétaire, hors valeur du stock de la société.', 190, 'fonction', '{lots}', false)
ON CONFLICT (key) DO NOTHING;
UPDATE sector_packs SET features = array_append(features, 'stock_deposant')
 WHERE code = 'transport' AND NOT ('stock_deposant' = ANY(features));
