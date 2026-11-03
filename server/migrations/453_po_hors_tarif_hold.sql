-- ═══════════════════════════════════════════════════════════════════════
-- 453 — Contrôle hors tarif à l'envoi du BC → hold OFF_CONTRACT (lot L4 P2P, 3/5)
--
--   À l'envoi, le prix unitaire de chaque ligne est confronté au tarif
--   CONTRACTUEL du fournisseur (supplier_item_prices, source <> 'reception' :
--   un tarif saisi ou négocié, pas un prix simplement appris d'une réception
--   passée). Au-delà de la tolérance — ou sans tarif connu quand un tarif est
--   exigé —, le BC est bloqué (motif « Prix hors tarif contractuel »), ce qui
--   suspend réception ET facturation (triggers rv_guard_po_hold /
--   invoices_guard_po_hold, mig 306) jusqu'à décision d'un responsable, qui
--   lève le blocage (release) après revue du prix.
--
--   Gate paramétrable, dormant par défaut (même patron que purchasing.sod_mode,
--   purchasing.lot_dlc_enforcement) :
--     purchasing.off_contract_enforcement
--       mode = 'warn'  : journalise seulement, aucun hold (DÉFAUT) ;
--       mode = 'block' : pose le hold OFF_CONTRACT ;
--       mode = 'off'   : aucun contrôle ;
--       price_tol_pct          : tolérance sur le dépassement du tarif (défaut 5 %) ;
--       require_contract_price : si true, une ligne d'un article référencé chez le
--                                fournisseur mais SANS tarif contractuel est aussi
--                                considérée hors tarif.
--
--   Aujourd'hui aucun tarif n'est contractuel (toutes les lignes de
--   supplier_item_prices ont source='reception') et require_contract_price=false :
--   le contrôle ne bloque donc rien tant que des tarifs contractuels ne sont pas
--   saisis, puis passez le mode à 'block' pour l'activer.
--
-- INVERSION
--   DELETE FROM module_parameters WHERE key='purchasing.off_contract_enforcement';
--   DELETE FROM ref_entries WHERE table_id='purchase_reason_codes' AND code='off_contract_price';
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;

-- Motif du blocage hors tarif : réutilise le hold existant (mig 306), dont la
-- contrainte chk_po_hold_reason exige un motif. Scope 'release_hold' pour lever.
INSERT INTO ref_entries (table_id, code, label, display_order, metadata)
VALUES ('purchase_reason_codes', 'off_contract_price', 'Prix hors tarif contractuel', 12,
        '{"scope":["hold","release_hold","reject"]}'::jsonb)
ON CONFLICT (table_id, code) DO NOTHING;

-- Gate dormant par défaut (warn). Passer mode='block' pour poser le hold.
INSERT INTO module_parameters (key, value)
VALUES ('purchasing.off_contract_enforcement',
        '{"mode":"warn","price_tol_pct":5,"require_contract_price":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
