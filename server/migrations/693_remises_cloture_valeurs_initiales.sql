-- Remises maximales et clôture de caisse : valeurs initiales en base.
-- Sans ligne, l'application appliquait déjà ces défauts (getParameter), mais l'écran
-- Paramètres et l'assistant affichaient « Indisponible » et ne pouvaient pas les régler.
-- Les valeurs sont exactement les défauts appliqués : aucun comportement ne change.
INSERT INTO module_parameters (key, value, description) VALUES
  ('sales.pricing', '{"max_discount_pct_sales": 10, "max_discount_pct_manager": 30, "max_price_override_pct": 30}',
   'Remise maximale en vente et caisse, puis gérant ; écart maximal au prix grille.'),
  ('sales.closure', '{"require_unsold_inventory": true}',
   'Clôture de caisse : inventaire des invendus demandé à la fermeture.')
ON CONFLICT (key) DO NOTHING;
