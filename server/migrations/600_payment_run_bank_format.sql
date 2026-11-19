-- G4-01 (plan d'action 2026-11) — paiements fournisseurs en lot : les deux points restants.
--
-- 1. Format du fichier de virement PAR COMPTE BANCAIRE.
--    Jusqu'ici la campagne produisait le CSV générique des salaires (N° ; Bénéficiaire ;
--    RIB ; Banque ; Montant ; Motif). Aucun format n'est imposé par les banques marocaines :
--    chaque portail importe un fichier tabulaire ou à positions fixes qu'il faut ADAPTER à
--    la banque du client. treasury_accounts.transfer_format décrit ce fichier :
--      {
--        "separator": ";" | "," | "tab" | "|" | "fixed",   -- "fixed" = positions fixes
--        "decimal": "." | ",",          "amountInCents": bool,
--        "header": bool,                "dateFormat": "DD/MM/YYYY" | "YYYY-MM-DD" | "YYYYMMDD" | "DDMMYYYY",
--        "columns": ["seq","name","rib","bank","amount","motif","date","debit_rib","currency","reference"],
--        "widths": { "<colonne>": n },  -- obligatoire pour "fixed"
--        "uppercase": bool,             "lineEnding": "crlf" | "lf",   "extension": "csv" | "txt"
--      }
--    NULL = format générique Kalum (identique au fichier des salaires). Le contrôle de la
--    structure est fait par le serveur (services/bank-transfer-format.ts) à l'enregistrement.
--
-- 2. Circuit d'approbation par défaut des campagnes (doc_type 'payment_run').
--    Aucune règle n'existait : toute campagne était approuvée à la soumission. Règle livrée :
--    toute campagne (total > 0) → administrateur. Comme pour les autres circuits, une
--    campagne soumise par un administrateur vaut approbation (sauf séparation des tâches en
--    mode « block »). Le seuil se règle dans Paramètres › Circuits d'approbation.
--
-- INVERSION :
--   DELETE FROM approval_rules WHERE code = 'payment_run_default';   -- (étapes en cascade)
--   ALTER TABLE treasury_accounts DROP CONSTRAINT IF EXISTS chk_treasury_transfer_format;
--   ALTER TABLE treasury_accounts DROP COLUMN IF EXISTS transfer_format;
ALTER TABLE treasury_accounts ADD COLUMN IF NOT EXISTS transfer_format jsonb;
ALTER TABLE treasury_accounts DROP CONSTRAINT IF EXISTS chk_treasury_transfer_format;
ALTER TABLE treasury_accounts ADD CONSTRAINT chk_treasury_transfer_format
  CHECK (transfer_format IS NULL OR (jsonb_typeof(transfer_format) = 'object' AND jsonb_typeof(transfer_format -> 'columns') = 'array'));
COMMENT ON COLUMN treasury_accounts.transfer_format IS
  'G4-01 (mig 600) : format du fichier de virement attendu par le portail de cette banque ; NULL = CSV générique Kalum.';

INSERT INTO approval_rules (code, label, doc_type, condition, mode, escalate_after_hours, display_order)
VALUES ('payment_run_default', 'Campagne de paiement fournisseurs', 'payment_run',
        '{"field": "amount", "op": "gt", "value": 0}'::jsonb, 'serial', 48, 60)
ON CONFLICT (code) DO NOTHING;

INSERT INTO approval_rule_steps (rule_id, step_order, approver_role)
SELECT r.id, 1, 'admin' FROM approval_rules r
 WHERE r.code = 'payment_run_default'
   AND NOT EXISTS (SELECT 1 FROM approval_rule_steps x WHERE x.rule_id = r.id);
