-- ═══════════════════════════════════════════════════════════════════════
-- 333 — Contrôle & Qualité, lot 3 : motifs de perte unifiés
--   Jusqu'ici le motif d'une perte matière n'était pas enregistré : le registre
--   le devinait dans le texte libre de la note (mig 313). On ajoute :
--     - un référentiel éditable material_loss_reasons (Paramètres › Référentiels) ;
--     - inventory_transactions.reason_code, renseigné par les sorties en perte ;
--     - la reprise de l'historique à partir des notes (même règle que la vue) ;
--     - les codes déjà écrits par les pertes produits (dlc_expiree, dlv_expiree,
--       perime, invendu_fin_journee) dans loss_reasons, pour qu'ils aient un libellé.
--   Rollback : DROP COLUMN reason_code ; DELETE des entrées ajoutées ; recréer la vue 313.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO ref_tables (id, label, description, source, editable)
VALUES ('material_loss_reasons', 'Motifs de perte matières',
        'Motifs des pertes de matières premières (pesage, lot envoyé aux pertes)', 'ref_entries', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, display_order, is_active) VALUES
  ('material_loss_reasons', 'dlc_expiree',       'DLC dépassée',            'Date limite de consommation atteinte',      1, true),
  ('material_loss_reasons', 'casse',             'Casse / renversé',        'Contenant percé, renversé, endommagé',      2, true),
  ('material_loss_reasons', 'contamination',     'Contamination',           'Nuisibles, corps étranger, humidité',       3, true),
  ('material_loss_reasons', 'fond_contenant',    'Fond de contenant',       'Reste inutilisable en fond de sac / seau',  4, true),
  ('material_loss_reasons', 'qualite',           'Échec contrôle qualité',  'Matière non conforme',                      5, true),
  ('material_loss_reasons', 'autre',             'Autre',                   'Préciser dans la note',                     6, true)
ON CONFLICT DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, description, display_order, is_active) VALUES
  ('loss_reasons', 'dlc_expiree',         'DLC dépassée',           'Destruction automatique d''un lot à DLC dépassée', 10, true),
  ('loss_reasons', 'dlv_expiree',         'DLV dépassée',           'Durée de vente dépassée',                          11, true),
  ('loss_reasons', 'perime',              'Périmé',                 NULL,                                               12, true),
  ('loss_reasons', 'invendu_fin_journee', 'Invendu fin de journée', 'Détruit à la clôture de caisse',                   13, true)
ON CONFLICT DO NOTHING;

ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reason_code text;
COMMENT ON COLUMN inventory_transactions.reason_code IS
  'Motif d''une sortie en perte (type waste) : code du référentiel material_loss_reasons. Mig 333.';

UPDATE inventory_transactions SET reason_code = CASE
    WHEN note ILIKE '%dlc%' OR note ILIKE '%périm%' OR note ILIKE '%perim%' OR note ILIKE '%expir%' THEN 'dlc_expiree'
    WHEN note ILIKE '%contamin%' THEN 'contamination'
    WHEN note ILIKE '%cass%' OR note ILIKE '%renvers%' OR note ILIKE '%endommag%' THEN 'casse'
    WHEN note ILIKE '%fond%' THEN 'fond_contenant'
    WHEN note ILIKE '%contr%le%' OR note ILIKE '%conform%' THEN 'qualite'
    ELSE 'autre'
  END
 WHERE type = 'waste' AND reason_code IS NULL;

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
  COALESCE(it.reason_code, 'autre')                 AS reason_code,
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
  'Registre unifié des pertes (produits finis + matières premières), valorisé au coût de revient. Contrôle & Qualité, mig 313 ; motif matière enregistré, mig 333.';
