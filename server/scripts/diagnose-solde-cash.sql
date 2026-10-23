-- Diagnostic Solde Cash : pourquoi le solde affiche != la caisse physique ?
-- LECTURE SEULE (aucune ecriture modifiee). Lancer :
--
--   psql "$DATABASE_URL" -f server/scripts/diagnose-solde-cash.sql
--
-- Fuseau aligne sur le serveur : Africa/Casablanca.
-- Adapter la date de fin ci-dessous (jour de la caisse comptee).
-- Si plusieurs magasins : ajouter "AND store_id = '<uuid>'" dans chaque WHERE.

\set date_fin '2026-06-23'
-- Montant physiquement compte dans le tiroir ce jour-la (pour comparaison) :
\set caisse_reelle 9826.50

\echo '=================================================================='
\echo ' Position cash cumulee jusqu au :date_fin (TZ Africa/Casablanca)'
\echo '=================================================================='

\echo ''
\echo '=== 1. Ventes cumulees : cash reel vs carte reel (POS + saisies) ==='
SELECT 'POS (table sales)' AS source,
       ROUND(COALESCE(SUM(CASE WHEN payment_method='cash' THEN total END),0),2) AS ventes_cash,
       ROUND(COALESCE(SUM(CASE WHEN payment_method='card' THEN total END),0),2) AS ventes_carte
FROM sales
WHERE payment_status IS DISTINCT FROM 'unpaid'
  AND DATE(COALESCE(paid_at, created_at) AT TIME ZONE 'Africa/Casablanca') <= :'date_fin'
UNION ALL
SELECT 'Saisies manuelles (matin+soir reel)',
       ROUND(COALESCE(SUM(COALESCE(matin_cash_reel,0)+COALESCE(soir_cash_reel,0)),0),2),
       ROUND(COALESCE(SUM(COALESCE(matin_carte_reel,0)+COALESCE(soir_carte_reel,0)),0),2)
FROM manual_shift_entries
WHERE entry_date <= :'date_fin';

\echo ''
\echo '=== 2. Paiements tresorerie agreges (cash vs banque, entree/sortie) ==='
SELECT
  CASE WHEN type='income' THEN '1-ENTREE' ELSE '2-SORTIE' END AS sens,
  CASE WHEN payment_method='cash' THEN 'CASH' ELSE 'BANQUE' END AS canal,
  COUNT(*) AS nb,
  ROUND(SUM(amount),2) AS total
FROM payments
WHERE (payment_method NOT IN ('check','traite') OR cashed_at IS NOT NULL)
  AND DATE((CASE WHEN payment_method IN ('check','traite') THEN cashed_at ELSE payment_date END)
           AT TIME ZONE 'Africa/Casablanca') <= :'date_fin'
GROUP BY 1,2
ORDER BY 1,2;

\echo ''
\echo '=== 3. Detail des SORTIES CASH (reperer une depense qui ne devrait PAS etre cash) ==='
SELECT DATE(payment_date AT TIME ZONE 'Africa/Casablanca') AS jour,
       ROUND(amount,2) AS montant, payment_method, reference, description
FROM payments
WHERE type <> 'income' AND payment_method='cash'
  AND DATE(payment_date AT TIME ZONE 'Africa/Casablanca') <= :'date_fin'
ORDER BY amount DESC
LIMIT 50;

\echo ''
\echo '=== 4. SYNTHESE : solde theorique vs caisse physique ==='
WITH ventes AS (
  SELECT
    COALESCE(SUM(CASE WHEN payment_method='cash' THEN total END),0)
      + (SELECT COALESCE(SUM(COALESCE(matin_cash_reel,0)+COALESCE(soir_cash_reel,0)),0)
         FROM manual_shift_entries WHERE entry_date <= :'date_fin') AS ventes_cash,
    COALESCE(SUM(CASE WHEN payment_method='card' THEN total END),0)
      + (SELECT COALESCE(SUM(COALESCE(matin_carte_reel,0)+COALESCE(soir_carte_reel,0)),0)
         FROM manual_shift_entries WHERE entry_date <= :'date_fin') AS ventes_carte
  FROM sales
  WHERE payment_status IS DISTINCT FROM 'unpaid'
    AND DATE(COALESCE(paid_at, created_at) AT TIME ZONE 'Africa/Casablanca') <= :'date_fin'
),
pay AS (
  SELECT
    COALESCE(SUM(CASE WHEN type='income'  AND payment_method='cash' THEN amount END),0) AS cash_in,
    COALESCE(SUM(CASE WHEN type<>'income' AND payment_method='cash' THEN amount END),0) AS cash_out,
    COALESCE(SUM(CASE WHEN type='income'  AND payment_method<>'cash' THEN amount END),0) AS bank_in,
    COALESCE(SUM(CASE WHEN type<>'income' AND payment_method<>'cash' THEN amount END),0) AS bank_out
  FROM payments
  WHERE (payment_method NOT IN ('check','traite') OR cashed_at IS NOT NULL)
    AND DATE((CASE WHEN payment_method IN ('check','traite') THEN cashed_at ELSE payment_date END)
             AT TIME ZONE 'Africa/Casablanca') <= :'date_fin'
)
SELECT
  ROUND(v.ventes_cash,2)   AS ventes_cash,
  ROUND(v.ventes_carte,2)  AS ventes_carte,
  ROUND(p.cash_in,2)       AS autres_entrees_cash,
  ROUND(p.cash_out,2)      AS sorties_cash,
  ROUND(p.bank_in,2)       AS entrees_banque,
  ROUND(p.bank_out,2)      AS sorties_banque,
  ROUND(v.ventes_cash + p.cash_in - p.cash_out, 2)                  AS solde_CASH_SEUL,
  ROUND(v.ventes_cash + v.ventes_carte + p.cash_in - p.cash_out, 2) AS solde_CASH_plus_CARTE,
  :caisse_reelle                                                    AS caisse_physique,
  ROUND(v.ventes_cash + v.ventes_carte + p.cash_in - p.cash_out - :caisse_reelle, 2) AS ecart_vs_physique
FROM ventes v, pay p;

\echo ''
\echo 'Lecture :'
\echo '  solde_CASH_SEUL        = tiroir si la carte part en banque (cash uniquement)'
\echo '  solde_CASH_plus_CARTE  = calcul actuel de l appli (carte incluse dans le cash)'
\echo '  ecart_vs_physique      = ce qui reste a expliquer (depense cash non saisie ?'
\echo '                           fond de caisse ? vente carte sur-saisie ?)'
