-- G0-09 (plan d'action 2026-11) — pointages exclus de la paie : rapport de rattrapage.
--
-- CONTEXTE
--   Avant le correctif, chaque enregistrement du planning repassait « attendu »
--   (is_expected = true) tout pointage sans heure d'arrivée. Or la paie ne compte
--   que les pointages réels (is_expected = false) : un salarié pointé présent, en
--   repos payé ou en demi-journée SANS heure perdait ce jour.
--
-- LECTURE SEULE. Ce script n'écrit rien. La régularisation (sur le bulletin
-- suivant) se décide avec le gérant, à partir de ces listes.
--
-- Deux niveaux de certitude :
--   A. CERTAIN   : ligne « attendue » dont le statut n'est pas 'present'. Le
--                  planning ne crée que des lignes 'present' : un autre statut a
--                  forcément été saisi à la main, puis remis à « attendu ».
--   B. À VÉRIFIER : ligne « attendue » au statut 'present', sans heure, dans une
--                  période déjà payée. Impossible à distinguer d'une simple
--                  présence prévue jamais pointée : à confronter au cahier de
--                  présence, salarié par salarié.
--
-- Montant du jour (indicatif) : salaire mensuel / 26, ou salaire hebdomadaire / 7.
--
-- USAGE : psql "$DATABASE_URL" -f scripts/diagnose-pointages-exclus-paie.sql

\echo '═══ Périmètre : jours « attendus » sans heure, dans une période DÉJÀ PAYÉE ═══'

CREATE TEMP VIEW v_g009_candidats AS
WITH paid AS (
  -- Bulletins mensuels payés
  SELECT p.employee_id, make_date(p.year, p.month, 1) AS d1,
         (make_date(p.year, p.month, 1) + INTERVAL '1 month - 1 day')::date AS d2,
         'mensuel' AS frequence
    FROM payroll p WHERE p.paid = true
  UNION ALL
  SELECT w.employee_id, w.week_start, w.week_end, 'hebdo' FROM weekly_payroll w WHERE w.paid = true
  UNION ALL
  SELECT b.employee_id, b.period_start, b.period_end, 'quinzaine' FROM biweekly_payroll b WHERE b.paid = true
)
SELECT DISTINCT ON (a.id)
       a.id, a.employee_id, a.date, a.status, a.notes, a.updated_by, a.updated_at,
       pd.frequence,
       e.first_name || ' ' || e.last_name AS salarie,
       ROUND(CASE WHEN COALESCE(e.monthly_salary, 0) > 0 THEN e.monthly_salary / 26.0
                  WHEN COALESCE(e.weekly_salary, 0) > 0 THEN e.weekly_salary / 7.0
                  ELSE 0 END, 2) AS montant_jour,
       -- Poids du jour dans la paie : demi-journée = 0,5 ; double = 2 ; absent = 0.
       CASE a.status WHEN 'half_day' THEN 0.5 WHEN 'double' THEN 2 WHEN 'absent' THEN 0 ELSE 1 END AS poids
  FROM attendance a
  JOIN employees e ON e.id = a.employee_id
  JOIN paid pd ON pd.employee_id = a.employee_id AND a.date BETWEEN pd.d1 AND pd.d2
 WHERE a.is_expected = true AND a.check_in IS NULL
 ORDER BY a.id, pd.frequence;

\echo ''
\echo '═══ A. CERTAIN — statut saisi à la main puis remis à « attendu » ═══'
SELECT salarie, to_char(date, 'YYYY-MM') AS mois, status AS statut, COUNT(*) AS jours,
       SUM(poids) AS jours_payes_perdus, SUM(ROUND(montant_jour * poids, 2)) AS montant_en_jeu
  FROM v_g009_candidats
 WHERE status <> 'present'
 GROUP BY salarie, to_char(date, 'YYYY-MM'), status
 ORDER BY mois, salarie, statut;

\echo ''
\echo '═══ A. Total certain ═══'
SELECT COUNT(*) AS lignes, COUNT(DISTINCT employee_id) AS salaries,
       COALESCE(SUM(poids), 0) AS jours_payes_perdus, COALESCE(SUM(ROUND(montant_jour * poids, 2)), 0) AS montant_en_jeu
  FROM v_g009_candidats WHERE status <> 'present';

\echo ''
\echo '═══ B. À VÉRIFIER — présence prévue jamais pointée, ou pointée sans heure ═══'
SELECT salarie, to_char(date, 'YYYY-MM') AS mois, COUNT(*) AS jours,
       COUNT(*) FILTER (WHERE updated_by IS NOT NULL OR notes IS NOT NULL) AS dont_trace_de_saisie,
       SUM(montant_jour) AS montant_maximal_en_jeu
  FROM v_g009_candidats
 WHERE status = 'present'
 GROUP BY salarie, to_char(date, 'YYYY-MM')
 ORDER BY mois, salarie;

\echo ''
\echo '═══ B. Total à vérifier ═══'
SELECT COUNT(*) AS lignes, COUNT(DISTINCT employee_id) AS salaries, COALESCE(SUM(montant_jour), 0) AS montant_maximal_en_jeu
  FROM v_g009_candidats WHERE status = 'present';

DROP VIEW v_g009_candidats;
