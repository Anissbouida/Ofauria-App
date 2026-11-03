-- Correctif du statut « closed » des demandes d'achat (analyse d'écart P2P,
-- 2026-11-01 — docs/AUDIT_P2P_GAP_ANALYSIS.md).
--
-- Les migrations 271 et 305 redéfinissent toutes deux la contrainte
-- purchase_requests_status_check. La 271 (antérieure) n'autorise pas « closed » ;
-- la 305 l'ajoute, en même temps que chk_purchase_requests_close_trace qui, lui,
-- EXIGE closed_at + close_reason dès que status = 'closed'. Rejouée après la 305
-- (reprise de migration locale cassée sur la 266), la 271 réécrase la contrainte
-- de la 305 : « closed » redevient interdit alors qu'une contrainte sœur le
-- réclame. Le schéma se contredit et la clôture d'un reliquat de demande
-- (statut « closed ») devient impossible — « SET status = 'closed' » est rejeté.
--
-- On réaffirme ici la liste canonique de la 305, de façon idempotente, pour
-- réparer local comme prod quel que soit l'ordre d'application réellement
-- observé. Aucune donnée à migrer : les lignes existantes n'ont jamais pu
-- prendre un statut hors de cette liste.
ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('pending', 'assigned', 'ordered', 'received', 'closed', 'cancelled'));

COMMENT ON COLUMN purchase_requests.status IS
  'pending = en attente d''affectation à un BC ; assigned/ordered = BC émis, marchandise attendue ; received = marchandise réceptionnée ; closed = reliquat clôturé (closed_at + close_reason, mig 305) ; cancelled = abandonnée. Liste réaffirmée mig 434.';
