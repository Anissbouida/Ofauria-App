-- ═══════════════════════════════════════════════════════════════════════
-- 313 — Contrôle & Qualité, lot 1 : registre des pertes unifié
--   Une seule lecture de TOUTES les pertes, quelle que soit la porte d'entrée :
--     - produits finis (product_losses : production, vitrine, périmé, recyclage,
--       y compris les invendus détruits/recyclés et les écarts d'ouverture) ;
--     - matières premières sorties en perte (inventory_transactions type 'waste' :
--       casse, fond de sac, DLC dépassée, lot envoyé aux pertes).
--   Valorisation au COÛT DE REVIENT, jamais au prix de vente :
--     - produit fini : products.cost_price (coût de la fiche technique) ;
--     - matière première : prix d'achat du lot, à défaut coût de l'ingrédient.
--   Coût inconnu → value NULL et cost_missing = true (signalé, pas deviné).
-- Uniquement une vue : rien n'est saisi ni comptabilisé ici (cf. mig 311).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_loss_register AS
-- ─── Produits finis ───────────────────────────────────────────────────
SELECT
  pl.id,
  'produit'::text                                   AS source,
  CASE
    WHEN pl.loss_type = 'production' THEN 'production'
    WHEN pl.loss_type = 'recyclage' THEN 'recyclage'
    WHEN pl.loss_type = 'perime' OR pl.reason IN ('perime', 'dlc_expiree', 'expired') THEN 'perime'
    WHEN pl.reason LIKE 'invendu%' OR pl.reason = 'unsold' THEN 'invendu'
    ELSE 'vitrine'
  END                                               AS family,
  pl.loss_type                                      AS loss_type,
  pl.reason                                         AS reason_code,
  pl.reason_note                                    AS note,
  pl.created_at                                     AS occurred_at,
  pl.store_id,
  pl.product_id                                     AS item_id,
  p.name                                            AS item_name,
  pl.quantity                                       AS quantity,
  'u'::text                                         AS unit,
  NULLIF(p.cost_price, 0)                           AS unit_cost,
  CASE WHEN NULLIF(p.cost_price, 0) IS NULL THEN NULL
       ELSE round(pl.quantity * p.cost_price, 2) END AS value,
  (NULLIF(p.cost_price, 0) IS NULL)                 AS cost_missing,
  -- Valeur au prix de vente (manque à gagner), affichée à titre indicatif seulement.
  round(pl.quantity * COALESCE(p.price, 0), 2)      AS sale_value,
  pl.declared_by,
  COALESCE(u.first_name || ' ' || u.last_name, u.email) AS declared_by_name,
  pl.photo_url,
  pl.production_plan_id                             AS plan_id,
  pl.source_product_lot_id                          AS lot_id
FROM product_losses pl
JOIN products p ON p.id = pl.product_id
LEFT JOIN users u ON u.id = pl.declared_by

UNION ALL

-- ─── Matières premières ───────────────────────────────────────────────
SELECT
  it.id,
  'matiere'::text                                   AS source,
  'matiere'::text                                   AS family,
  'waste'::text                                     AS loss_type,
  CASE
    WHEN it.note ILIKE '%dlc%' OR it.note ILIKE '%périm%' OR it.note ILIKE '%perim%' OR it.note ILIKE '%expir%' THEN 'dlc_expiree'
    WHEN it.note ILIKE '%cass%' OR it.note ILIKE '%renvers%' OR it.note ILIKE '%contamin%' THEN 'casse'
    WHEN it.note ILIKE '%fond%' THEN 'fond_contenant'
    ELSE 'autre'
  END                                               AS reason_code,
  it.note                                           AS note,
  it.created_at                                     AS occurred_at,
  it.store_id,
  it.ingredient_id                                  AS item_id,
  ing.name                                          AS item_name,
  abs(it.quantity_change)                           AS quantity,
  ing.unit                                          AS unit,
  NULLIF(COALESCE(il.unit_cost, ing.unit_cost), 0)  AS unit_cost,
  CASE WHEN NULLIF(COALESCE(il.unit_cost, ing.unit_cost), 0) IS NULL THEN NULL
       ELSE round(abs(it.quantity_change) * COALESCE(il.unit_cost, ing.unit_cost), 2) END AS value,
  (NULLIF(COALESCE(il.unit_cost, ing.unit_cost), 0) IS NULL) AS cost_missing,
  NULL::numeric                                     AS sale_value,
  it.performed_by                                   AS declared_by,
  COALESCE(u.first_name || ' ' || u.last_name, u.email) AS declared_by_name,
  NULL::text                                        AS photo_url,
  it.production_plan_id                             AS plan_id,
  it.ingredient_lot_id                              AS lot_id
FROM inventory_transactions it
JOIN ingredients ing ON ing.id = it.ingredient_id
LEFT JOIN ingredient_lots il ON il.id = it.ingredient_lot_id
LEFT JOIN users u ON u.id = it.performed_by
WHERE it.type = 'waste';

COMMENT ON VIEW v_loss_register IS
  'Registre unifié des pertes (produits finis + matières premières), valorisé au coût de revient. Contrôle & Qualité, mig 313.';
