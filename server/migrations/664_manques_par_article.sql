-- ═══════════════════════════════════════════════════════════════════════
-- 664 — Matières non livrées par le bon de sortie, par article
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Le bon de sortie est commun au plan. Quand une matière manque, le magasinier peut remettre
--   le bon « avec manquants » ; mais ensuite tout le plan démarrait, y compris l'article qui
--   avait besoin de la matière, et cette matière n'était jamais sortie pour lui, même une fois
--   le stock arrivé. À l'inverse, attendre la matière bloquait tous les articles du plan.
--
-- QUOI
--   production_item_shortages : ce qui manque à chaque article à la réception du bon
--   (part de son besoin non livrée). L'article passe en liste d'attente ; les autres articles
--   du plan démarrent. Remis en production : la matière lui est sortie (lots, mouvement,
--   coût rattachés à l'article) ; « produire sans » : le manque est levé sans sortie.
--   status : open (en attente), issued (sortie faite à la remise en production),
--            waived (produit sans la matière), cancelled (article annulé).
--
-- INVERSION
--   DROP TABLE production_item_shortages.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS production_item_shortages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  plan_item_id  uuid NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  bon_ligne_id  uuid REFERENCES production_bons_sortie_lignes(id) ON DELETE SET NULL,
  missing_qty   numeric(14,4) NOT NULL CHECK (missing_qty > 0),
  issued_qty    numeric(14,4) NOT NULL DEFAULT 0,
  status        varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'issued', 'waived', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_item_shortages_item ON production_item_shortages(plan_item_id);
CREATE INDEX IF NOT EXISTS idx_item_shortages_open ON production_item_shortages(plan_id) WHERE status = 'open';

COMMENT ON TABLE production_item_shortages IS
  'Part du besoin d''un article non livrée par le bon de sortie : article en liste d''attente jusqu''à la sortie ou à « produire sans » (mig 664)';
