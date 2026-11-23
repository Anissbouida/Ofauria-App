-- ═══════════════════════════════════════════════════════════════════════
-- 659 — Charges réelles reprises de la comptabilité (lot D)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Le montant réel d'une charge analytique se saisissait à la main chaque mois, alors
--   que le grand livre le connaît déjà (loyer 6131, énergie 6125…).
--
-- QUOI
--   1. analytic_charge_accounts : comptes de classe 6 rattachés à une charge.
--   2. fn_analytic_ledger_amount(charge, établissement, mois) : solde débiteur des écritures
--      validées de ces comptes sur le mois (écritures de l'établissement ou sans
--      établissement). Le réel d'une charge = montant saisi pour le mois, sinon le grand
--      livre (s'il porte au moins une écriture sur le mois), sinon le prévisionnel.
--   3. Rattachements proposés d'après la nature de la charge (loyer → 6131, énergie → 6125,
--      entretien → 6133, transport → 6142, publicité → 6144, impôts → 6167,
--      amortissements → 6191, autres → 6181), pour les charges existantes sans rattachement.
--
-- INVERSION
--   DROP FUNCTION fn_analytic_ledger_amount(uuid, uuid, date); DROP TABLE analytic_charge_accounts;
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytic_charge_accounts (
  charge_id  uuid NOT NULL REFERENCES analytic_charges(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (charge_id, account_id)
);
COMMENT ON TABLE analytic_charge_accounts IS
  'Mig 659 : comptes de charges (classe 6) dont les écritures validées donnent le montant réel mensuel d''une charge analytique.';

CREATE OR REPLACE FUNCTION fn_analytic_ledger_amount(p_charge uuid, p_store uuid, p_period date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT SUM(l.debit - l.credit)
    FROM analytic_charge_accounts x
    JOIN journal_entry_lines l ON l.account_id = x.account_id
    JOIN journal_entries e ON e.id = l.journal_entry_id
   WHERE x.charge_id = p_charge
     AND e.status IN ('posted', 'reversed')
     AND e.entry_date >= p_period AND e.entry_date < (p_period + interval '1 month')
     AND (p_store IS NULL OR e.store_id IS NULL OR e.store_id = p_store)
$$;
COMMENT ON FUNCTION fn_analytic_ledger_amount(uuid, uuid, date) IS
  'Mig 659 : montant réel d''une charge analytique sur un mois = solde (débit − crédit) des écritures validées de ses comptes ; NULL sans compte rattaché ou sans écriture sur le mois (le prévisionnel s''applique alors).';

INSERT INTO analytic_charge_accounts (charge_id, account_id)
SELECT ch.id, a.id
  FROM analytic_charges ch
  JOIN (VALUES ('loyer', '6131'), ('energie', '6125'), ('eau', '6125'), ('maintenance', '6133'),
               ('transport', '6142'), ('marketing', '6144'), ('taxes', '6167'),
               ('amortissement', '6191'), ('autre', '6181')) AS m(nature, code) ON m.nature = ch.nature
  JOIN accounts a ON a.code = m.code AND a.is_active
 WHERE NOT EXISTS (SELECT 1 FROM analytic_charge_accounts x WHERE x.charge_id = ch.id)
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS analytic_charge_accounts_config_audit ON analytic_charge_accounts;
CREATE TRIGGER analytic_charge_accounts_config_audit AFTER INSERT OR UPDATE OR DELETE ON analytic_charge_accounts
  FOR EACH ROW EXECUTE FUNCTION log_config_change('charge_id', '');
