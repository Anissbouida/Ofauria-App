-- Reprise des avances historiques saisies comme depenses
-- (categorie "Avances sur salaire") vers le nouveau suivi salary_advances.
--
-- A EXECUTER MANUELLEMENT apres la migration 228, apres revue :
--   les avances reprises arrivent avec remaining_amount = montant total
--   (statut 'open'). Si certaines ont deja ete recuperees de maniere
--   informelle (hors systeme), ajuster remaining_amount/status a la main
--   apres coup, ou solder via une retenue sur la prochaine paie.
--
-- Idempotent : un payment deja repris (present dans salary_advances.payment_id)
-- n'est pas reinsere.

BEGIN;

-- 1. Apercu de ce qui sera repris (verifier avant de valider)
SELECT p.id, p.payment_date, p.amount, p.payment_method,
       e.first_name || ' ' || e.last_name AS employe, p.description
  FROM payments p
  JOIN expense_categories ec ON ec.id = p.category_id
  LEFT JOIN employees e ON e.id = p.employee_id
 WHERE ec.name = 'Avances sur salaire'
   AND p.type IN ('expense', 'salary')
   AND NOT EXISTS (SELECT 1 FROM salary_advances sa WHERE sa.payment_id = p.id);

-- 2. Creation des avances (uniquement celles rattachees a un employe —
--    une avance sans employee_id est inexploitable pour la retenue :
--    corriger le paiement d'abord dans Charges & Depenses)
INSERT INTO salary_advances (employee_id, amount, advance_date, payment_method,
                             payment_id, remaining_amount, status, notes, created_by, store_id)
SELECT p.employee_id, p.amount, p.payment_date, p.payment_method,
       p.id, p.amount, 'open',
       'Reprise historique depuis Charges & Depenses',
       p.created_by, p.store_id
  FROM payments p
  JOIN expense_categories ec ON ec.id = p.category_id
 WHERE ec.name = 'Avances sur salaire'
   AND p.type IN ('expense', 'salary')
   AND p.employee_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM salary_advances sa WHERE sa.payment_id = p.id);

-- 3. Rebascule le type du paiement : 'advance' = sortie de tresorerie
--    (toujours deduite du solde cash en Caisse) mais plus une charge
--    (disparait de Charges & Depenses et du total des charges).
UPDATE payments p
   SET type = 'advance'
  FROM salary_advances sa
 WHERE sa.payment_id = p.id
   AND p.type != 'advance';

-- NOTE COMPTABLE : les ecritures deja generees pour ces paiements debitent
-- un compte de charge 6xxx. Pour un bilan exact, passer une OD manuelle de
-- reclassement (3431 D / 6xxx C du total repris) dans l'onglet Journal —
-- montant = SUM(remaining_amount) des avances reprises ci-dessus.

COMMIT;
