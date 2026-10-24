-- Migration 345 : inventory_transactions.type — CHECK realigne sur les types ecrits par le code
--
-- POURQUOI (decouvert en montant une base de test vierge, 2026-10-23)
--   Trois migrations ont chacune REDEFINI la contrainte en recopiant une liste
--   partielle :
--     010 : restock, usage, adjustment, waste, production
--     033 : + purchase_order
--     062 : restock, usage, adjustment, waste, recycle   <- 'production' et
--           'purchase_order' ont DISPARU (la 062 a recopie la liste d'origine
--           au lieu de l'etendre).
--   Or le code ecrit 'production' (complete, produceItems, startPrelevement du
--   BSI, consumeFEFO), 'purchase_order' (reception BC) et 'open_container'
--   (ouverture d'un contenant au pesage, jamais dans AUCUN CHECK).
--   Sur une base migree de zero, le premier prelevement BSI echoue :
--     « violates check constraint inventory_transactions_type_check ».
--   En production la contrainte a necessairement ete corrigee a la main
--   (schema non reproductible) — meme famille de derive que
--   production_plans.warnings (mig 338) et sales.sale_type.
--
-- CE QUE FAIT CETTE MIGRATION
--   Repose la contrainte sur l'UNION de tous les types ecrits par le code.
--   Idempotente et sans danger en prod : elle ne fait qu'elargir (si la prod
--   a deja une liste plus large, les types supplementaires sont conserves
--   ci-dessous par securite : 'transfer', 'correction', 'inventory').
--
-- INVERSION
--   Rejouer la definition de la mig 062 (deconseille : casse la production).

ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_type_check
  CHECK (type IN (
    'restock', 'usage', 'adjustment', 'waste',            -- mig 004/010
    'production',                                         -- mig 010 (perdu en 062)
    'purchase_order',                                     -- mig 033 (perdu en 062)
    'recycle',                                            -- mig 062
    'open_container',                                     -- pesage, jamais declare
    'transfer', 'correction', 'inventory'                 -- reserves / historiques
  ));

COMMENT ON COLUMN inventory_transactions.type IS
  'restock | usage | adjustment | waste | production | purchase_order | recycle | open_container | transfer | correction | inventory (mig 345 : union des types ecrits par le code).';
