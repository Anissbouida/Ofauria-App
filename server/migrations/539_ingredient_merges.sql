-- G2-03 (plan d'action 2026-11) — journal des fusions d'ingrédients.
--
-- Deux fiches du même ingrédient (trois « Beurre », deux « Sucre semoule »…) répartissent
-- le stock et le coût entre elles. La fusion (repositories/ingredient-merge.repository.ts)
-- repointe toutes les références de la fiche en trop vers la fiche gardée, additionne les
-- stocks, recalcule le coût moyen pondéré, puis retire la fiche en trop.
--
-- La table ingredients n'a pas d'état « archivé » et 149 requêtes la lisent : plutôt que
-- d'y laisser une fiche fantôme à filtrer partout, la fiche retirée est ARCHIVÉE ICI,
-- entière (source_snapshot), avec le décompte de ce qui a été repointé (impact).
--
--   source_id       : identifiant de la fiche retirée (elle n'existe plus dans ingredients)
--   source_snapshot : la ligne ingredients complète au moment de la fusion
--   impact          : nombre de lignes repointées par table, stocks additionnés
--   unit_cost_*     : coût de la fiche gardée avant / après (moyenne pondérée par les stocks)
--
-- INVERSION : DROP TABLE ingredient_merges; (les fusions faites ne sont pas défaites)
CREATE TABLE IF NOT EXISTS ingredient_merges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        uuid NOT NULL,
  source_name      varchar(200) NOT NULL,
  target_id        uuid NOT NULL REFERENCES ingredients(id),
  source_snapshot  jsonb NOT NULL,
  impact           jsonb NOT NULL DEFAULT '{}'::jsonb,
  unit_cost_before numeric(12,4),
  unit_cost_after  numeric(12,4),
  merged_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  merged_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingredient_merges_target ON ingredient_merges (target_id, merged_at DESC);
