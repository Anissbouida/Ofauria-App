-- Migration 349 : lignes de BC « service » et « immobilisation »
--
-- POURQUOI
--   Un BC ne portait qu'un ingrédient ou un consommable. Une réparation, un
--   contrat d'entretien, un transport ou l'achat d'un four ne pouvaient pas être
--   commandés sans créer un faux article. Comme dans les ERP du marché, chaque
--   ligne porte désormais un TYPE qui décide de la réception et de l'imputation :
--     ingredient  -> stock en lots (inchangé)
--     consumable  -> stock simple packaging_items (inchangé)
--     service     -> pas de stock ; réception = « service rendu » ; charge 6xxx
--     asset       -> pas de stock ; réception = mise en service ; compte 23xx
--                    + fiche d'immobilisation créée automatiquement (amortissement)
--   Une ligne service/immobilisation n'a pas de fiche article : désignation libre
--   + catégorie de dépense obligatoires (la catégorie donne le compte comptable,
--   cf. resolveCategoryAccountCode — aucune logique comptable nouvelle).
--
-- PORTEE
--   purchase_order_items.line_type + contrainte ; reception_voucher_items accepte
--   une ligne sans article ; branche de catégories « Immobilisations » (23xx) avec
--   compte d'amortissement et durée par défaut ; fixed_assets relié à la réception.
--
-- INVERSION
--   Supprimer les lignes service/asset, restaurer po_item_kind_check / rvi_kind_check
--   de la mig 110/207, DROP COLUMN line_type, purchase_order_item_id,
--   reception_voucher_item_id, asset_* ; désactiver la branche Immobilisations.

-- ─── 1. Type de ligne de BC ────────────────────────────────────────────────
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS line_type varchar(20);

UPDATE purchase_order_items
   SET line_type = CASE WHEN packaging_id IS NOT NULL THEN 'consumable' ELSE 'ingredient' END
 WHERE line_type IS NULL;

ALTER TABLE purchase_order_items ALTER COLUMN line_type SET DEFAULT 'ingredient';
ALTER TABLE purchase_order_items ALTER COLUMN line_type SET NOT NULL;

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS po_item_kind_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT po_item_kind_check CHECK (
  (line_type = 'ingredient' AND ingredient_id IS NOT NULL AND packaging_id IS NULL)
  OR (line_type = 'consumable' AND packaging_id IS NOT NULL AND ingredient_id IS NULL)
  OR (line_type IN ('service', 'asset') AND ingredient_id IS NULL AND packaging_id IS NULL
      AND COALESCE(btrim(description), '') <> '' AND category_id IS NOT NULL)
);

COMMENT ON COLUMN purchase_order_items.line_type IS
  'ingredient | consumable | service | asset. service/asset : pas d''article, description + category_id obligatoires (mig 349).';

-- ─── 2. Ligne de réception sans article (service rendu / mise en service) ──
ALTER TABLE reception_voucher_items DROP CONSTRAINT IF EXISTS rvi_kind_check;
ALTER TABLE reception_voucher_items ADD CONSTRAINT rvi_kind_check CHECK (
  NOT (ingredient_id IS NOT NULL AND packaging_id IS NOT NULL)
  AND (ingredient_id IS NOT NULL OR packaging_id IS NOT NULL OR purchase_order_item_id IS NOT NULL)
);

-- ─── 3. Instantané de version : désignation des lignes sans article ───────
CREATE OR REPLACE FUNCTION public.fn_po_snapshot(p_po uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object(
    'header', jsonb_build_object(
      'order_number', po.order_number, 'supplier_id', po.supplier_id, 'supplier_name', s.name,
      'order_date', po.order_date, 'expected_delivery_date', po.expected_delivery_date, 'notes', po.notes),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', poi.id, 'item', COALESCE(ing.name, pkg.name, poi.description),
               'line_type', poi.line_type,
               'ingredient_id', poi.ingredient_id, 'packaging_id', poi.packaging_id,
               'qty_container', poi.qty_container, 'qty_per_container', poi.qty_per_container,
               'quantity_ordered', poi.quantity_ordered, 'base_unit', poi.base_unit,
               'unit_price', poi.unit_price, 'discount_pct', poi.discount_pct, 'tva_rate', poi.tva_rate,
               'amount_ht', poi.amount_ht, 'expected_date', poi.expected_date)
             ORDER BY COALESCE(ing.name, pkg.name, poi.description))
        FROM purchase_order_items poi
        LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
        LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
       WHERE poi.purchase_order_id = po.id), '[]'::jsonb))
  FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.id = p_po
$function$;

-- ─── 4. Branche « Immobilisations » du référentiel des dépenses ───────────
-- Paramètres d'immobilisation portés par la catégorie : compte d'amortissement
-- cumulé (28xx) et durée d'amortissement par défaut. Le compte d'actif (23xx)
-- est le account_id habituel de la catégorie.
ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS asset_depreciation_account_id uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS asset_duration_years int CHECK (asset_duration_years IS NULL OR asset_duration_years > 0);

INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('2340', 'Materiel de transport', 2, '23', '234', 'asset', 'D')
ON CONFLICT (code) DO NOTHING;

INSERT INTO expense_categories (id, name, type, description, parent_id, level, display_order, is_active, code, requires_po)
VALUES ('10000000-0000-0000-0000-000000000010', 'Immobilisations', 'expense',
        'Biens durables amortis (four, pétrin, mobilier, caisse…) : compte 23xx, pas de charge immédiate',
        NULL, 1, 10, true, 'immobilisations', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_categories (id, name, type, description, parent_id, level, display_order, is_active, code, requires_po,
                                account_id, asset_depreciation_account_id, asset_duration_years)
SELECT v.id::uuid, v.name, 'expense', v.descr, '10000000-0000-0000-0000-000000000010', 2, v.ord, true, v.code, true,
       (SELECT id FROM accounts WHERE code = v.acc), (SELECT id FROM accounts WHERE code = v.dep), v.years
  FROM (VALUES
    ('30000000-0000-0000-0000-000000000101', 'Matériel et outillage',      'immo_materiel',     'Four, pétrin, laminoir, chambre froide, batteur', '2332', '2833', 10, 1),
    ('30000000-0000-0000-0000-000000000102', 'Matériel informatique & caisse', 'immo_informatique', 'Ordinateur, caisse, imprimante, balance connectée', '2355', '2835', 5, 2),
    ('30000000-0000-0000-0000-000000000103', 'Mobilier',                    'immo_mobilier',     'Vitrines, tables, présentoirs, rayonnages',         '2351', '2835', 10, 3),
    ('30000000-0000-0000-0000-000000000104', 'Agencements & aménagements',  'immo_agencements',  'Travaux d''aménagement du local, installations',    '2356', '2835', 10, 4),
    ('30000000-0000-0000-0000-000000000105', 'Matériel de transport',       'immo_transport',    'Véhicule de livraison, triporteur',                 '2340', '2834', 5, 5)
  ) AS v(id, name, code, descr, acc, dep, years, ord)
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Fiche d'immobilisation reliée à la réception ─────────────────────
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid REFERENCES purchase_order_items(id),
  ADD COLUMN IF NOT EXISTS reception_voucher_item_id uuid REFERENCES reception_voucher_items(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_rvi
  ON fixed_assets (reception_voucher_item_id) WHERE reception_voucher_item_id IS NOT NULL;
