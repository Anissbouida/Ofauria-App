-- M3-05 (plan d'action 2026-11) — clé de répartition du coût d'un plan entre ses articles.
--
-- La clé est une politique (production.cost_allocation_key, catalogue des paramètres) :
-- poids (défaut), quantité, valeur de vente, manuelle ; réglable par société,
-- établissement, atelier ou type d'ordre. computePlanCost (production-cout.repository)
-- rend la répartition du coût réel du plan entre ses articles selon cette clé.
-- Clé manuelle : la part de chaque article du plan, en %, saisie sur le plan (total 100).
--
-- INVERSION : ALTER TABLE production_plan_items DROP COLUMN cost_share_pct;
ALTER TABLE production_plan_items
  ADD COLUMN IF NOT EXISTS cost_share_pct numeric(6,3) CHECK (cost_share_pct IS NULL OR (cost_share_pct >= 0 AND cost_share_pct <= 100));
