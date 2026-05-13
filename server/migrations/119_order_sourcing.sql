-- Sourcing automatique des order_items, miroir du mecanisme replenishment.
-- A la creation d'une commande, le systeme calcule par ligne :
--   qty_from_stock = stock magasin disponible (backroom)
--   qty_to_produce = ce qui doit etre produit
--   source_type    = 'stock' | 'mixed' | 'production'
--   production_plan_id = plan auto-cree (si toProduce > 0)
-- Les colonnes existent deja sur replenishment_request_items (memes noms,
-- meme semantique) — on les recopie sur order_items pour partager le helper.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS source_type        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS qty_from_stock     INTEGER,
  ADD COLUMN IF NOT EXISTS qty_to_produce     INTEGER,
  ADD COLUMN IF NOT EXISTS production_plan_id UUID REFERENCES production_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status             VARCHAR(20) DEFAULT 'pending';

-- Index pour lookup rapide depuis un plan vers ses order_items (cascade de
-- statut commande → ready quand le plan est complete : meme pattern que pour
-- replenishment_request_items).
CREATE INDEX IF NOT EXISTS idx_order_items_production_plan
  ON order_items(production_plan_id) WHERE production_plan_id IS NOT NULL;
