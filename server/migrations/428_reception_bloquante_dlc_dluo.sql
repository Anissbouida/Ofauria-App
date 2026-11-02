-- 428 — Réception bloquante + DLC vs DLUO (épic labo L5, partie 1)
--
-- POURQUOI
--   Le contrôle à réception (reception_quality_checks, mig 056) enregistre une
--   conformité mais n'EMPÊCHE rien : un lot non conforme reste utilisable. Et la
--   date limite d'un lot est traitée uniformément, alors qu'un périssable porte
--   une DLC (date limite de consommation, stricte) et un produit sec une DLUO
--   (durabilité minimale, indicative). Écarts E1/E8.
--
-- QUOI
--   - ingredient_lots.status : nouvel état 'blocked' — lot verrouillé par un
--     contrôle réception non conforme, exclu de la consommation (toutes les files
--     FEFO/BSI filtrent status = 'active'). Levé quand le contrôle repasse conforme.
--   - ingredient_lots.date_kind : 'dlc' (périssable, défaut) | 'dluo' (sec).
--
-- INVERSION :
--   UPDATE ingredient_lots SET status='active' WHERE status='blocked';
--   puis restaurer le CHECK sans 'blocked' ; ALTER TABLE ... DROP COLUMN date_kind.

ALTER TABLE ingredient_lots
  DROP CONSTRAINT IF EXISTS ingredient_lots_status_check;
ALTER TABLE ingredient_lots
  ADD CONSTRAINT ingredient_lots_status_check
  CHECK (status IN ('active', 'depleted', 'expired', 'quarantine', 'waste', 'reversed', 'blocked'));

ALTER TABLE ingredient_lots
  ADD COLUMN IF NOT EXISTS date_kind VARCHAR(4) NOT NULL DEFAULT 'dlc'
    CHECK (date_kind IN ('dlc', 'dluo'));

COMMENT ON COLUMN ingredient_lots.date_kind IS
  'Nature de la date limite (mig 428) : dlc (date limite de consommation, périssable) | dluo (durabilité minimale, sec).';
COMMENT ON COLUMN ingredient_lots.status IS
  'active | depleted | expired | quarantine (hold manuel) | waste | reversed | blocked (contrôle réception non conforme, mig 428).';
