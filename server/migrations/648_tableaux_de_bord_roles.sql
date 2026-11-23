-- 648 — Tableaux de bord par rôle (plan d'exécution multi-industries, étape 10, pas 10e).
--
-- POURQUOI
--   Le gérant et le chef d'atelier voyaient le même tableau de bord de production : le chef
--   cherchait ses ordres à relancer et ses rendements sous les coûts de la période.
--
-- CE QUI CHANGE
--   Définition publiée de l'écran « production.dashboard » pour le rôle neutre « Responsable
--   de production » (archétype de la mig 637) : ordres à relancer et rendement d'abord,
--   coûts masqués. Le gérant garde l'écran par défaut ; les rôles d'Ofauria ne changent pas.
--   Toute société ajuste ensuite ces vues dans Paramètres › Production › Écrans.
--
-- RETOUR ARRIÈRE
--   DELETE FROM screen_definitions WHERE screen_key = 'production.dashboard' AND scope_type = 'role'
--   AND scope_id = 'responsable_production'.

INSERT INTO screen_definitions (screen_key, scope_type, scope_id, status, version_no, definition, published_at)
SELECT 'production.dashboard', 'role', 'responsable_production', 'publie', 1,
       '{"sections": [
          {"key": "blocked-alert", "visible": true, "order": 10},
          {"key": "relaunch", "visible": true, "order": 20},
          {"key": "yield", "visible": true, "order": 30},
          {"key": "kpis", "visible": true, "order": 40},
          {"key": "cost-split", "visible": false, "order": 50},
          {"key": "cost-per-day", "visible": false, "order": 60},
          {"key": "reports", "visible": false, "order": 70}
        ]}'::jsonb, now()
 WHERE EXISTS (SELECT 1 FROM roles WHERE code = 'responsable_production')
   AND NOT EXISTS (SELECT 1 FROM screen_definitions WHERE screen_key = 'production.dashboard' AND scope_type = 'role'
                     AND scope_id = 'responsable_production' AND status = 'publie');
