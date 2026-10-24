-- Migration 302 : coupe — sorties multiples d'un même cadre, décidées à la production
--
-- POURQUOI
--   En pâtisserie, un cadre (40×60 → 50 tranches) ne sort pas toujours en un seul
--   produit : à la coupe, le chef peut prélever un ou plusieurs entremets et
--   détailler le reste en tranches. Le système n'enregistrait qu'un seul chiffre
--   par article (« quantité produite ») sur un seul produit : stock, lots et
--   rendement étaient faux dès qu'il y avait deux sorties.
--
--   La répartition n'appartient PAS à la fiche technique (qui décrit la recette) :
--   c'est une décision du chef, prise dans le plan, au moment de la coupe.
--
-- QUOI
--   production_item_outputs — ce que le chef a réellement sorti, par article de
--   plan : produit, quantité, équivalence en pièces de l'article (un entremets =
--   8 tranches) figée au moment de la production, lot produit créé.
--   La quantité produite de l'article (actual_quantity) devient la somme en
--   pièces équivalentes : le rendement reste comparable au théorique.
--   Les sorties déjà utilisées pour un produit servent de suggestions aux
--   productions suivantes (aucun paramétrage préalable).

CREATE TABLE IF NOT EXISTS production_item_outputs (
  id             bigserial PRIMARY KEY,
  plan_item_id   uuid NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  label          varchar(120) NOT NULL,
  quantity       numeric(12,3) NOT NULL CHECK (quantity > 0),
  equiv_pieces   numeric(8,3) NOT NULL CHECK (equiv_pieces > 0),
  product_lot_id uuid REFERENCES product_lots(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_item_outputs_item ON production_item_outputs (plan_item_id);
CREATE INDEX IF NOT EXISTS idx_production_item_outputs_product ON production_item_outputs (product_id);
