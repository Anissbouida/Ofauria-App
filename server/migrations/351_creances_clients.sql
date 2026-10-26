-- Migration 351 : créances clients (lot 1 — impayés rattachés à une fiche client)
--
-- POURQUOI
--   Un ticket « à plus tard » portait un nom libre (unpaid_customer_name) :
--   impossible de savoir ce qu'un client doit au total, depuis quand, ni de
--   relancer. Comme dans les ERP (Odoo « Compte client », SAP FI-AR, Sage
--   échéancier), l'impayé devient une créance d'un client identifié, avec une
--   échéance, suivie avec les factures clients ouvertes dans « Créances clients ».
--
-- PORTEE
--   sales.due_date : échéance du ticket impayé = date de vente + délai de
--   paiement du client (customers.delai_paiement_jours, 0 par défaut), posée
--   par trigger à l'enregistrement ; reprise des impayés existants.
--   Aucune règle de chiffre d'affaires modifiée : un ticket impayé compte
--   toujours au jour de son encaissement (paid_at).
--
-- INVERSION
--   DROP TRIGGER sales_due_date ON sales ; DROP FUNCTION trg_sales_due_date ;
--   ALTER TABLE sales DROP COLUMN due_date.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date date;

COMMENT ON COLUMN sales.due_date IS
  'Échéance d''un ticket impayé : date de vente + délai de paiement du client (mig 351). NULL pour un ticket payé comptant.';

CREATE OR REPLACE FUNCTION trg_sales_due_date() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_status = 'unpaid' AND NEW.due_date IS NULL THEN
    NEW.due_date := (COALESCE(NEW.created_at, now()) AT TIME ZONE 'Africa/Casablanca')::date
                    + COALESCE((SELECT delai_paiement_jours FROM customers WHERE id = NEW.customer_id), 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_due_date ON sales;
CREATE TRIGGER sales_due_date BEFORE INSERT OR UPDATE OF payment_status, customer_id ON sales
  FOR EACH ROW EXECUTE FUNCTION trg_sales_due_date();

-- Reprise : impayés déjà en base.
UPDATE sales s
   SET due_date = (s.created_at AT TIME ZONE 'Africa/Casablanca')::date
                  + COALESCE((SELECT delai_paiement_jours FROM customers c WHERE c.id = s.customer_id), 0)
 WHERE s.payment_status = 'unpaid' AND s.due_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_unpaid_customer ON sales (customer_id) WHERE payment_status = 'unpaid';
