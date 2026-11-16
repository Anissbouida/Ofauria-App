-- G1-10 (plan d'action 2026-11) — péremption des lots de produits finis, tâche planifiée.
--
-- Les lots dont la DLC ou la DLV est dépassée devaient être traités quand un utilisateur
-- chargeait la liste des produits. Cet appel échouait à chaque fois (requête invalide,
-- erreur avalée) : la péremption automatique ne passait jamais. La requête est corrigée et
-- le traitement confié à la tâche `lots_expire` (services/scheduler.ts), toutes les
-- 15 minutes : perte enregistrée, stock du magasin synchronisé, lot passé à « périmé ».
-- Idempotente : un lot déjà traité n'est plus « actif ».
--
-- DÉSACTIVÉE à la livraison : à sa première exécution elle sortira du stock TOUS les lots
-- périmés accumulés depuis que le traitement était en panne. Chiffrer d'abord avec
-- server/scripts/diagnose-lots-perimes-actifs.sql, puis activer dans Paramètres ›
-- Tâches planifiées.
--
-- INVERSION : DELETE FROM scheduled_jobs WHERE key = 'lots_expire';
INSERT INTO scheduled_jobs (key, label, description, domain, enabled, interval_minutes, display_order) VALUES
  ('lots_expire',
   'Péremption des lots de produits',
   'Sort du stock les lots de produits finis dont la DLC ou la DLV est dépassée et enregistre la perte.',
   'stock', false, 15, 30)
ON CONFLICT (key) DO NOTHING;
