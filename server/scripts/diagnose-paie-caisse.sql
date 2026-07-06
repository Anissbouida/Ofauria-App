-- Diagnostic : paiements de salaires invisibles en Caisse / Charges & Depenses
--
-- CONTEXTE
--   Symptome : un bulletin est marque "Paye" mais le Solde Cash ne bouge pas
--   et aucune ligne n'apparait dans Charges & Depenses.
--   Deux causes possibles :
--     A) la ligne payments n'a jamais ete creee (echec apres le marquage paye,
--        avant le correctif d'atomicite) -> requetes 1 et 2 ;
--     B) la ligne existe mais store_id NULL alors que le compte qui consulte
--        est rattache a un magasin (filtre strict avant correctif) -> requete 3.
--
-- USAGE : executer chaque section en lecture ; la reparation (section 5) est
-- commentee, a executer seulement apres verification.

-- ═══ 1. Bulletins MENSUELS payes sans sortie de caisse correspondante ═══
SELECT p.id, e.first_name || ' ' || e.last_name AS employe,
       p.month, p.year, p.net_salary, p.advance_deduction,
       p.paid_at, p.payment_method
  FROM payroll p
  JOIN employees e ON e.id = p.employee_id
 WHERE p.paid = true
   AND p.paid_at > NOW() - INTERVAL '60 days'
   -- net entierement couvert par la retenue = pas de sortie de caisse attendue
   AND COALESCE(p.net_salary, 0) - COALESCE(p.advance_deduction, 0) > 0
   AND NOT EXISTS (
     SELECT 1 FROM payments pay
      WHERE pay.type = 'salary'
        AND pay.employee_id = p.employee_id
        AND pay.reference LIKE 'SAL-' || p.month || '/' || p.year || '-%'
   )
 ORDER BY p.paid_at DESC;

-- ═══ 2. Bulletins HEBDO payes sans sortie de caisse correspondante ═══
SELECT wp.id, e.first_name || ' ' || e.last_name AS employe,
       wp.week_start, wp.net_amount, wp.advance_deduction,
       wp.paid_at, wp.payment_method
  FROM weekly_payroll wp
  JOIN employees e ON e.id = wp.employee_id
 WHERE wp.paid = true
   AND wp.paid_at > NOW() - INTERVAL '60 days'
   AND COALESCE(wp.net_amount, 0) - COALESCE(wp.advance_deduction, 0) > 0
   AND NOT EXISTS (
     SELECT 1 FROM payments pay
      WHERE pay.type = 'salary'
        AND pay.employee_id = wp.employee_id
        AND pay.reference LIKE 'SAL-S' || to_char(wp.week_start, 'YYYY-MM-DD') || '-%'
   )
 ORDER BY wp.paid_at DESC;

-- ═══ 3. Paiements salaires/avances recents : store_id et visibilite ═══
-- store_id NULL + compte consultant rattache a un magasin = invisible
-- avant le correctif (filtre strict p.store_id = $X).
SELECT pay.reference, pay.type, pay.amount, pay.payment_method,
       pay.payment_date, pay.store_id,
       e.first_name || ' ' || e.last_name AS employe,
       u.email AS cree_par, u.store_id AS store_du_payeur
  FROM payments pay
  LEFT JOIN employees e ON e.id = pay.employee_id
  LEFT JOIN users u ON u.id = pay.created_by
 WHERE pay.type IN ('salary', 'advance')
   AND pay.created_at > NOW() - INTERVAL '60 days'
 ORDER BY pay.created_at DESC;

-- ═══ 4. Comptes admin/gerant et leur rattachement magasin ═══
SELECT email, role, store_id FROM users WHERE role IN ('admin', 'manager');

-- ═══ 5. REPARATION (commentee) ═══
-- Pour les bulletins des requetes 1/2 : repasser paid=false pour pouvoir
-- re-cliquer "Payer" dans l'interface (qui recreera la sortie de caisse
-- proprement, ecriture comptable comprise). NE PAS l'executer si l'argent
-- est deja sorti physiquement ET la ligne payments existe.
--
-- UPDATE payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0
--  WHERE id IN ('<ids requete 1>');
--
-- UPDATE weekly_payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0
--  WHERE id IN ('<ids requete 2>');
--
-- NB : si des retenues d'avance avaient ete imputees sur ces bulletins
-- (salary_advance_repayments), les supprimer aussi et re-crediter
-- remaining_amount sur les avances concernees avant de re-payer.
