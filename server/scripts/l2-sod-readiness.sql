-- =============================================================================
-- L2 — Aperçu avant bascule « warn » → « block » de la séparation des tâches
-- docs/AUDIT_P2P_GAP_ANALYSIS.md
-- =============================================================================
-- En mode « warn » (purchasing.sod_mode), les triggers SoD (mig 440) ne bloquent
-- pas : ils journalisent chaque violation dans sod_violations. Passer en « block »
-- rejettera (OF403) exactement ces actions. Ce script montre ce qui serait
-- bloqué, pour anticiper les ruptures AVANT de basculer.
--
-- Lecture seule. À jouer sur la base de prod.
-- =============================================================================

-- 1. Mode actuel + règles actives.
SELECT (SELECT value->>'mode' FROM module_parameters WHERE key = 'purchasing.sod_mode') AS mode_actuel;
SELECT code, action, forbidden, is_active, label FROM sod_document_rules ORDER BY code;

-- 2. Violations journalisées par règle et par acteur (ce que « block » rejetterait).
SELECT
  v.rule_code,
  COALESCE(u.first_name || ' ' || u.last_name, u.email, v.actor_id::text) AS acteur,
  count(*)                 AS occurrences,
  count(DISTINCT v.doc_id) AS documents,
  min(v.occurred_at)::date AS premier,
  max(v.occurred_at)::date AS dernier
FROM sod_violations v
LEFT JOIN users u ON u.id = v.actor_id
WHERE v.occurred_at >= now() - INTERVAL '90 days'
GROUP BY v.rule_code, acteur
ORDER BY occurrences DESC;

-- 3. Synthèse par règle : volume et acteurs concernés.
SELECT
  v.rule_code,
  r.label,
  count(*)                   AS occurrences,
  count(DISTINCT v.actor_id) AS acteurs
FROM sod_violations v
JOIN sod_document_rules r ON r.code = v.rule_code
WHERE v.occurred_at >= now() - INTERVAL '90 days'
GROUP BY v.rule_code, r.label
ORDER BY occurrences DESC;

-- 4. Dérogations tracées en vigueur (cas explicitement autorisés).
SELECT o.rule_code, o.doc_type, o.doc_id,
       COALESCE(u.first_name || ' ' || u.last_name, u.email) AS acteur, o.reason, o.created_at::date
FROM sod_overrides o LEFT JOIN users u ON u.id = o.actor_id
ORDER BY o.created_at DESC;
