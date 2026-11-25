-- ═══════════════════════════════════════════════════════════════════════
-- 679 — Capacité des équipements, retour de matière au magasin (audit C-19, C-28)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   C-19 : rien ne disait combien de plaques entrent dans un four ou combien de kilos tient
--     un batteur. Un planning pouvait demander 40 plaques à un four qui en cuit 24 par jour.
--   C-28 : une fois le bon de sortie accepté, la matière était sortie pour de bon. Un article
--     annulé, une fournée plus petite, un reste de sac : rien ne revenait au magasin, et le
--     coût du plan gardait la matière non utilisée.
--
-- QUOI
--   production_equipements : capacite_par_cycle, capacite_unite (plaque, contenant, kg, pièce),
--     cycles_par_jour. Capacité du jour = capacité par cycle × cycles par jour.
--   recipe_equipements : charge d'une fiche (ou d'un format de la fiche) sur un équipement,
--     par fournée. Charge du jour = Σ fournées planifiées × charge par fournée.
--   production_material_returns : chaque retour (bon, ligne, lot, article, quantité, motif,
--     auteur). La sortie du plan est diminuée d'autant (production_lot_usage), le lot
--     reprend la quantité en en-cours ouvert, l'inventaire suit.
--   inventory_transactions.type : 'production_return' (mouvement d'entrée du retour, distinct
--     des sorties 'production' que les rapports comptent en valeur absolue).
--   La séparation des tâches (C-32) est une politique du catalogue, sans colonne.
--
-- INVERSION
--   DROP TABLE production_material_returns, recipe_equipements ; DROP COLUMN des trois
--   colonnes d'équipement ; remettre la contrainte de type sans 'production_return' (après
--   avoir requalifié ces mouvements).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE production_equipements
  ADD COLUMN IF NOT EXISTS capacite_par_cycle numeric(12,3) CHECK (capacite_par_cycle IS NULL OR capacite_par_cycle > 0),
  ADD COLUMN IF NOT EXISTS capacite_unite varchar(20) CHECK (capacite_unite IS NULL OR capacite_unite IN ('plaque', 'contenant', 'kg', 'piece')),
  ADD COLUMN IF NOT EXISTS cycles_par_jour integer CHECK (cycles_par_jour IS NULL OR cycles_par_jour > 0);

COMMENT ON COLUMN production_equipements.capacite_par_cycle IS 'Audit C-19 : ce que l''équipement traite en un cycle (une cuisson, un pétrissage), dans capacite_unite.';
COMMENT ON COLUMN production_equipements.cycles_par_jour IS 'Audit C-19 : nombre de cycles possibles dans une journée de production.';

CREATE TABLE IF NOT EXISTS recipe_equipements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  format_id uuid REFERENCES recipe_formats(id) ON DELETE CASCADE,
  equipement_id uuid NOT NULL REFERENCES production_equipements(id) ON DELETE CASCADE,
  charge_par_fournee numeric(12,3) NOT NULL CHECK (charge_par_fournee > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_equipements
  ON recipe_equipements (recipe_id, COALESCE(format_id, '00000000-0000-0000-0000-000000000000'::uuid), equipement_id);
CREATE INDEX IF NOT EXISTS idx_recipe_equipements_equip ON recipe_equipements (equipement_id);
COMMENT ON TABLE recipe_equipements IS 'Audit C-19 : charge d''une fiche (format_id NULL) ou d''un de ses formats sur un équipement, par fournée, dans l''unité de capacité de l''équipement.';

CREATE TABLE IF NOT EXISTS production_material_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  bon_id uuid NOT NULL REFERENCES production_bons_sortie(id) ON DELETE CASCADE,
  bon_ligne_id uuid NOT NULL REFERENCES production_bons_sortie_lignes(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  ingredient_lot_id uuid NOT NULL REFERENCES ingredient_lots(id),
  plan_item_id uuid REFERENCES production_plan_items(id) ON DELETE SET NULL,
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit varchar(20),
  reason text NOT NULL,
  returned_by uuid REFERENCES users(id),
  returned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_returns_plan ON production_material_returns (plan_id);
CREATE INDEX IF NOT EXISTS idx_material_returns_lot ON production_material_returns (ingredient_lot_id);
COMMENT ON TABLE production_material_returns IS 'Audit C-28 : matière rendue au magasin après prélèvement ; la sortie du plan (production_lot_usage) est diminuée d''autant.';

ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_type_check CHECK (type IN (
  'restock', 'usage', 'adjustment', 'waste', 'production', 'purchase_order', 'recycle',
  'open_container', 'transfer', 'correction', 'inventory', 'production_return'));
