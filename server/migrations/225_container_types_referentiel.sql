-- Migration 225: Referentiel "types de contenant" + tracabilite sur les transferts de zone
-- Le magasinier declare le type de contenant ouvert (sac, carton, poche, bloc, boite...)
-- et le nombre de contenants au moment du transfert Economat -> Pesage.
-- Le referentiel est editable via Parametres -> Referentiel (systeme generique ref_entries).

-- 1. Enregistrer la table de lookup dans le registre des referentiels
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('container_types', 'Types de contenant', 'Sac, carton, poche, bloc, boite... ouverts au transfert vers le pesage', 'Package', 'ref_entries', true, 7)
ON CONFLICT (id) DO NOTHING;

-- 2. Seeder les valeurs initiales (modifiables ensuite depuis le referentiel)
INSERT INTO ref_entries (table_id, code, label, display_order) VALUES
  ('container_types', 'sac', 'Sac', 1),
  ('container_types', 'carton', 'Carton', 2),
  ('container_types', 'poche', 'Poche', 3),
  ('container_types', 'bloc', 'Bloc', 4),
  ('container_types', 'boite', 'Boite', 5),
  ('container_types', 'seau', 'Seau', 6),
  ('container_types', 'bidon', 'Bidon', 7),
  ('container_types', 'brique', 'Brique', 8),
  ('container_types', 'caisse', 'Caisse', 9),
  ('container_types', 'autre', 'Autre', 10)
ON CONFLICT (table_id, code) DO NOTHING;

-- 3. Colonne de tracabilite sur les transferts de zone : type de contenant ouvert.
--    Le nombre de contenants est deja porte par container_count (migration 113).
ALTER TABLE ingredient_stock_zone_transfers
  ADD COLUMN IF NOT EXISTS container_type_id uuid REFERENCES ref_entries(id);

COMMENT ON COLUMN ingredient_stock_zone_transfers.container_type_id IS
  'Type de contenant ouvert (ref_entries, table_id=container_types). Saisi au transfert Economat -> Pesage, a cote de container_count.';
