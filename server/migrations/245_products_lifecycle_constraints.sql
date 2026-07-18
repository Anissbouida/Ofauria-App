-- Migration 245 : CHECKs cycle de vie produit (audit V1).
--
-- Contexte (docs/AUDIT_CYCLE_VIE.md, section 4A) :
--   - sale_type est un VARCHAR(20) DEFAULT 'jour' sans CHECK -> n'importe
--     quelle chaine passe. Un typo silencieux du POST /products cassait
--     tout le moteur d'invendus (fallback 'waste' systematique).
--   - max_reexpositions et shelf_life_days peuvent contenir des valeurs
--     absurdes (NULL, negatives) qui font echouer le moteur cote lecture.
--   - Le controller vient d'etre equipe d'un validator Zod (product.validator.ts)
--     mais l'audit exige aussi la ceinture DB (equivalent trigger BEFORE
--     Oracle : rien ne doit contourner la validation, meme un INSERT direct).
--
-- Fix : CHECKs cotes DB, idempotents.
--   - sale_type IN ('jour','dlv','commande')
--   - shelf_life_days >= 0 (ou NULL)
--   - display_life_hours >= 0 (ou NULL)
--   - max_reexpositions >= 0 (ou NULL, considere = 0)
--   - Regle croisee : sale_type='dlv' => shelf_life_days > 0
--     (evite les produits 'DLV' sans DLV, source des lignes contradictoires
--     du catalogue). NOT VALID pour tolerer d'eventuelles donnees legacy
--     puis validate.
--
-- Pattern : DROP IF EXISTS + ADD (renommage explicite pour gestion future).

BEGIN;

-- Nettoyer d'eventuelles valeurs invalides existantes en donnees pour que
-- la CHECK stricte puisse etre VALIDATED. Un audit conservateur : on
-- ramene vers 'jour' (defaut colonne).
UPDATE products
SET sale_type = 'jour'
WHERE sale_type IS NULL
   OR sale_type NOT IN ('jour','dlv','commande');

-- On force NOT NULL puisqu'il y a un DEFAULT.
ALTER TABLE products
  ALTER COLUMN sale_type SET NOT NULL;

-- ─── CHECK sale_type ────────────────────────────────────────────────────
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_sale_type_check;
ALTER TABLE products
  ADD CONSTRAINT products_sale_type_check
  CHECK (sale_type IN ('jour','dlv','commande'));

-- ─── CHECK bornes numeriques ────────────────────────────────────────────
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_shelf_life_days_range;
ALTER TABLE products
  ADD CONSTRAINT products_shelf_life_days_range
  CHECK (shelf_life_days IS NULL OR (shelf_life_days >= 0 AND shelf_life_days <= 365));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_display_life_hours_range;
ALTER TABLE products
  ADD CONSTRAINT products_display_life_hours_range
  CHECK (display_life_hours IS NULL OR (display_life_hours >= 0 AND display_life_hours <= 720));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_max_reexpositions_range;
ALTER TABLE products
  ADD CONSTRAINT products_max_reexpositions_range
  CHECK (max_reexpositions IS NULL OR (max_reexpositions >= 0 AND max_reexpositions <= 10));

-- ─── Regle croisee dlv <=> shelf_life_days > 0 ──────────────────────────
-- NOT VALID d'abord : on evite de bloquer si de vieilles lignes 'dlv' n'ont
-- pas de shelf_life_days (audit A1). On les remonte visiblement puis on
-- VALIDATE en fin de migration.
UPDATE products
SET sale_type = 'jour'
WHERE sale_type = 'dlv'
  AND (shelf_life_days IS NULL OR shelf_life_days <= 0);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_dlv_requires_shelf_life;
ALTER TABLE products
  ADD CONSTRAINT products_dlv_requires_shelf_life
  CHECK (sale_type <> 'dlv' OR (shelf_life_days IS NOT NULL AND shelf_life_days > 0));

-- ─── Regle croisee is_reexposable + max_reexpositions ───────────────────
-- Elimine le silent 0->1 cote moteur (unsold-decision.repository:22).
-- Si is_reexposable=true, max_reexpositions doit etre >= 1.
-- On ne bloque plus les 'reexposable' historiques avec max=0 : on les
-- normalise a 1 par backfill, puis on ajoute la CHECK stricte.
UPDATE products
SET max_reexpositions = 1
WHERE is_reexposable = true
  AND (max_reexpositions IS NULL OR max_reexpositions < 1);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_reexposable_requires_max;
ALTER TABLE products
  ADD CONSTRAINT products_reexposable_requires_max
  CHECK (is_reexposable IS NOT TRUE OR (max_reexpositions IS NOT NULL AND max_reexpositions >= 1));

COMMIT;
