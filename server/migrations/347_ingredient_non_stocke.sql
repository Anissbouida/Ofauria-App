-- F-016 — Ingredients non stockes (eau au robinet, etc.).
--
-- Avant : « Eau » etant un ingredient stocke ordinaire, chaque plan generait une
-- ligne BSI en RUPTURE (ex. 36 l) et « A commander » proposait d'acheter de l'eau.
-- Ce drapeau exclut ces ingredients du calcul des besoins de production (donc des
-- ruptures BSI et des propositions d'achat). Le cout matieres reste pris en compte
-- par les vues de cout (qui lisent recipe_ingredients, pas les besoins).

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS non_stocke boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ingredients.non_stocke IS
  'Ingredient non gere en stock (ex. eau du robinet) : exclu des besoins de production, des ruptures BSI et de « A commander » (F-016).';

-- Backfill conservateur : seulement les libelles d'eau evidents (match exact apres
-- normalisation). Les autres ingredients non stockes sont a marquer a la main.
UPDATE ingredients
   SET non_stocke = true
 WHERE btrim(lower(name)) IN ('eau', 'eau du robinet', 'eau robinet');
