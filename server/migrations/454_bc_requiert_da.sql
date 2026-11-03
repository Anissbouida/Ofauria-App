-- ═══════════════════════════════════════════════════════════════════════
-- 454 — Demande d'achat obligatoire pour un BC, sauf urgence (lot L4 P2P, 4/5)
--
--   À l'envoi, un BC doit référencer une demande d'achat (le lien est calculé
--   par la couverture, mig 305 : purchase_requests.purchase_order_id pointe vers
--   le BC qui couvre la DA). À défaut, l'envoyeur doit justifier une urgence : le
--   motif est alors persisté sur le BC (dispense tracée), ce qui le dispense de
--   DA pour cet envoi.
--
--   Gate paramétrable, dormant par défaut (même patron que purchasing.sod_mode) :
--     purchasing.po_requires_request
--       mode = 'warn'  : journalise seulement, n'empêche rien (DÉFAUT) ;
--       mode = 'block' : refuse l'envoi d'un BC sans DA ni motif d'urgence.
--   Aujourd'hui 75 % des BC sont des régularisations sans DA : le mode reste
--   'warn' jusqu'à ce que le flux DA → BC soit généralisé, puis passez à 'block'.
--
-- INVERSION
--   DELETE FROM module_parameters WHERE key='purchasing.po_requires_request';
--   ALTER TABLE purchase_orders
--     DROP COLUMN request_exempt_reason, DROP COLUMN request_exempt_by, DROP COLUMN request_exempt_at;
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS request_exempt_reason TEXT,
  ADD COLUMN IF NOT EXISTS request_exempt_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_exempt_at     TIMESTAMPTZ;

COMMENT ON COLUMN purchase_orders.request_exempt_reason IS
  'Dispense de DA à l''envoi (mig 454) : motif d''urgence quand le BC ne référence aucune demande d''achat.';

INSERT INTO module_parameters (key, value)
VALUES ('purchasing.po_requires_request', '{"mode":"warn"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
