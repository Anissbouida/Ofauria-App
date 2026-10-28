-- 374 — Caisse : vente des produits sans stock vitrine, au choix de l'admin.
--
-- Jusqu'ici, la règle était un drapeau d'environnement du serveur (POS_ALLOW_NEGATIVE_STOCK,
-- actif par défaut en développement). Elle devient un paramètre métier modifiable dans
-- Paramètres › Ventes et caisse › Règles de caisse :
--   block : un produit sans stock vitrine est grisé et sa vente refusée (stock réel respecté) ;
--   allow : tout produit actif se vend, le stock vitrine peut passer en négatif (commerces
--           qui ne tiennent pas la vitrine au réel, ou en attendant l'approvisionnement).
--
-- Rollback : DELETE FROM module_parameters WHERE key = 'sales.pos_stock' ;

INSERT INTO module_parameters (key, value, description) VALUES
  ('sales.pos_stock', '{"mode": "block"}'::jsonb,
   'Caisse : vente des produits sans stock vitrine — block (refusée, produit grisé) ou allow (vendable, stock négatif possible).')
ON CONFLICT (key) DO NOTHING;
