-- L5 Réception qualité (analyse d'écart P2P) — incrément 1 : quarantaine à l'entrée.
--
-- POURQUOI
--   Aujourd'hui un lot reçu naît 'active' : il est consommable immédiatement, le
--   contrôle qualité (reception_quality_checks, mig 056/428) ne fait que VERROUILLER
--   a posteriori un lot déjà consommable. Pour les familles sensibles (froid, cru,
--   allergènes), il faut l'inverse : le lot entre en QUARANTAINE et n'est libéré
--   qu'après un contrôle conforme.
--
-- QUOI
--   - Nouveau drapeau requires_qc (catégorie + surcharge article), comme requires_dlc.
--   - fn_lot_requirements renvoie aussi requires_qc.
--   Le reste est applicatif : à la réception, un article requires_qc crée son lot en
--   'quarantine' (statut déjà au CHECK, mig 428) ; le contrôle réception conforme le
--   passe 'active', non conforme le passe 'blocked' (ingredient-lot.repository).
--
--   La quarantaine ne touche NI le coût NI l'inventaire disponible : le CMUP vaut
--   pour ce qu'on possède (le lot est reçu), et toutes les files (inventaire dispo,
--   FEFO, BSI) filtrent déjà status = 'active' — un lot en quarantaine est donc
--   invisible à la consommation tant qu'il n'est pas libéré. Rien n'est débloqué
--   d'office : requires_qc est opt-in par catégorie (Paramètres → catégories).
--
-- INVERSION :
--   UPDATE ingredient_lots SET status='active' WHERE status='quarantine';
--   ALTER TABLE expense_categories DROP COLUMN requires_qc;
--   ALTER TABLE ingredients        DROP COLUMN requires_qc;
--   puis restaurer fn_lot_requirements sans requires_qc (cf. mig 308).

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS requires_qc BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS requires_qc BOOLEAN;   -- NULL = hériter de la catégorie

COMMENT ON COLUMN expense_categories.requires_qc IS
  'Contrôle qualité obligatoire à la réception (L5 P2P) : les lots de cette catégorie entrent en quarantaine et ne sont libérés qu''après un contrôle conforme.';
COMMENT ON COLUMN ingredients.requires_qc IS
  'Surcharge article du contrôle qualité obligatoire (NULL = hérite de la catégorie).';

-- RETURNS TABLE change : on doit DROP puis recréer (CREATE OR REPLACE refuse une
-- nouvelle colonne OUT). Appelée en SELECT * (reception-voucher.repository) : la
-- colonne supplémentaire est captée automatiquement.
DROP FUNCTION IF EXISTS fn_lot_requirements(UUID);
CREATE FUNCTION fn_lot_requirements(p_ingredient UUID)
RETURNS TABLE (requires_lot BOOLEAN, requires_dlc BOOLEAN, requires_qc BOOLEAN, default_shelf_life_days INTEGER, min_shelf_life_days INTEGER)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(i.requires_lot, c.requires_lot, false),
         COALESCE(i.requires_dlc, c.requires_dlc, false),
         COALESCE(i.requires_qc,  c.requires_qc,  false),
         COALESCE(i.default_shelf_life_days, c.default_shelf_life_days),
         COALESCE(i.min_shelf_life_days, c.min_shelf_life_days)
    FROM ingredients i
    LEFT JOIN expense_categories c ON c.id = i.category_id
   WHERE i.id = p_ingredient
$$;

-- Amorce prudente : seules les familles à vrai risque sanitaire (cru protéiné)
-- entrent en contrôle obligatoire ; faible fréquence en boulangerie-pâtisserie, pas
-- de blocage des réceptions courantes (farine, beurre…). À ajuster par catégorie.
UPDATE expense_categories SET requires_qc = true
 WHERE id IN ('30000000-0000-0000-0000-000000000041',  -- Viandes & Volailles
              '30000000-0000-0000-0000-000000000042'); -- Poissons & Fruits de mer
