-- 642 — Magasin générique, tâche 1 : emplacements typés par rôle (plan d'exécution
-- multi-industries, étape 8).
--
-- POURQUOI
--   Le code désignait les emplacements par des codes figés (ECONOMAT, PESAGE, MAGASIN, FRIGO) :
--   un métier sans « pesage » ni « économat » ne pouvait pas décrire son magasin.
--
-- CE QUI CHANGE
--   - stock_locations.role : rôle métier de l'emplacement (réserve, en-cours ouvert, atelier,
--     froid positif, froid négatif, vente, quarantaine, expédition). Déduit du type quand il
--     n'est pas donné (déclencheur), repris pour l'existant depuis le code puis le type.
--   - stock_locations.role_default : l'emplacement qui sert par défaut pour ce rôle dans
--     l'établissement (un seul par établissement et par rôle). Reprise : ECONOMAT (réserve),
--     PESAGE (en-cours ouvert), MAGASIN (vente), FRIGO (froid positif), ENCOURS (atelier),
--     EXPEDITION (expédition) ; à défaut, le plus ancien du rôle.
--   - fn_store_location(store, role) : l'emplacement par défaut d'un rôle.
--   Aucune quantité ne bouge : le jeu de référence stock-lots reste identique.
--
-- RETOUR ARRIÈRE
--   DROP FUNCTION fn_store_location(uuid, text) ; DROP TRIGGER trg_stock_location_role ON stock_locations ;
--   DROP FUNCTION fn_stock_location_role() ; DROP FUNCTION fn_location_role_of(text, text) ;
--   ALTER TABLE stock_locations DROP COLUMN role_default, DROP COLUMN role.

ALTER TABLE stock_locations ADD COLUMN IF NOT EXISTS role VARCHAR(20);
ALTER TABLE stock_locations ADD COLUMN IF NOT EXISTS role_default BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION fn_location_role_of(p_code TEXT, p_type TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_code IN ('ECONOMAT', 'MAGASIN_MP') THEN 'reserve'
    WHEN p_code = 'PESAGE' THEN 'en_cours_ouvert'
    WHEN p_code = 'ENCOURS' THEN 'atelier'
    WHEN p_code = 'EXPEDITION' THEN 'expedition'
    WHEN p_code = 'MAGASIN' THEN 'vente'
    WHEN p_code = 'FRIGO' THEN 'froid_positif'
    WHEN p_code = 'QUARANTAINE' THEN 'quarantaine'
    ELSE CASE p_type
      WHEN 'sec' THEN 'reserve' WHEN 'pesage' THEN 'en_cours_ouvert' WHEN 'labo' THEN 'atelier'
      WHEN 'positif' THEN 'froid_positif' WHEN 'negatif' THEN 'froid_negatif' WHEN 'vitrine' THEN 'vente'
      ELSE 'reserve' END
  END
$$;

UPDATE stock_locations SET role = fn_location_role_of(code, type) WHERE role IS NULL;
ALTER TABLE stock_locations ALTER COLUMN role SET NOT NULL;
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_role_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_role_check
  CHECK (role IN ('reserve', 'en_cours_ouvert', 'atelier', 'froid_positif', 'froid_negatif', 'vente', 'quarantaine', 'expedition'));

-- Rôle déduit du type quand l'appelant ne le donne pas (écrans et migrations existants).
CREATE OR REPLACE FUNCTION fn_stock_location_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS NULL THEN NEW.role := fn_location_role_of(NEW.code, NEW.type); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stock_location_role ON stock_locations;
CREATE TRIGGER trg_stock_location_role BEFORE INSERT ON stock_locations FOR EACH ROW EXECUTE FUNCTION fn_stock_location_role();

-- Emplacement par défaut de chaque rôle, par établissement : le code historique, sinon le plus ancien.
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY store_id, role
           ORDER BY (code IN ('ECONOMAT', 'PESAGE', 'MAGASIN', 'FRIGO', 'ENCOURS', 'EXPEDITION', 'QUARANTAINE')) DESC, created_at, id) AS rk
    FROM stock_locations WHERE is_active AND parent_id IS NULL AND store_id IS NOT NULL
)
UPDATE stock_locations l SET role_default = true FROM ranked WHERE ranked.id = l.id AND ranked.rk = 1 AND NOT l.role_default;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_locations_role_default ON stock_locations (store_id, role) WHERE role_default;

CREATE OR REPLACE FUNCTION fn_store_location(p_store UUID, p_role TEXT) RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM stock_locations
   WHERE store_id = p_store AND role = p_role AND is_active
   ORDER BY role_default DESC, created_at, id
   LIMIT 1
$$;
