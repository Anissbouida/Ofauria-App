-- =============================================================================
-- L0 — Aperçu avant bascule « log » → « enforce » de la garde des droits
-- docs/AUDIT_P2P_GAP_ANALYSIS.md
-- =============================================================================
-- La garde par module (moduleGuard, mig 330) tourne en mode « log » : elle
-- journalise les accès hors droits dans auth_events (event_type =
-- 'access_denied') SANS bloquer. Passer en « enforce » répondra 403 sur
-- exactement ces appels. Ce script liste ce qui serait nouvellement bloqué,
-- pour anticiper les ruptures AVANT de basculer (Utilisateurs › Rôles).
--
-- Lecture seule — aucune écriture. À jouer sur la base de prod.
--
-- Nuance de comptage : en mode « log », la garde ne journalise qu'une fois par
-- jour, par utilisateur et par forme de route (déduplication anti-bruit). Les
-- compteurs ci-dessous sont donc des minorants ; l'ENSEMBLE des couples
-- (route, rôle) concernés, lui, est complet.
-- =============================================================================

-- 1. Par forme de route et par rôle : qui perdrait l'accès, et depuis quand.
SELECT
  e.details->>'route'  AS route,
  e.details->>'role'   AS role,
  e.details->>'action' AS action,
  count(*)             AS occurrences_journalisees,
  count(DISTINCT e.user_id) AS utilisateurs_distincts,
  min(e.created_at)::date   AS premier_vu,
  max(e.created_at)::date   AS dernier_vu
FROM auth_events e
WHERE e.event_type = 'access_denied'
  AND COALESCE(e.details->>'mode', 'log') = 'log'
  AND e.created_at >= now() - INTERVAL '90 days'
GROUP BY 1, 2, 3
ORDER BY occurrences_journalisees DESC, route;

-- 2. Synthèse par rôle : nombre de routes distinctes qui casseraient.
SELECT
  e.details->>'role' AS role,
  count(DISTINCT e.details->>'route') AS routes_impactees,
  count(DISTINCT e.user_id)           AS utilisateurs
FROM auth_events e
WHERE e.event_type = 'access_denied'
  AND COALESCE(e.details->>'mode', 'log') = 'log'
  AND e.created_at >= now() - INTERVAL '90 days'
GROUP BY 1
ORDER BY routes_impactees DESC;

-- 3. Mode actuellement configuré (doit valoir 'log' avant la bascule).
SELECT security_module_enforcement AS mode_actuel FROM company_settings WHERE id = 1;
