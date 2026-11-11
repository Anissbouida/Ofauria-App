-- Phase 9.1 — Libellés par secteur : une clé neutre, une valeur par secteur.
--
-- Le code et les menus emploient une clé neutre (ex. « recipe ») ; le libellé affiché
-- dépend du secteur (« Recette » en boulangerie, « Nomenclature » en générique). Changer
-- de secteur change les mots à l'écran, sans toucher au code. Additif : sans entrée pour
-- une clé, l'écran garde son libellé de repli (le défaut actuel d'Ofauria).

CREATE TABLE IF NOT EXISTS sector_labels (
  sector_pack VARCHAR(40) NOT NULL REFERENCES sector_packs(code) ON DELETE CASCADE,
  label_key   VARCHAR(60) NOT NULL,
  label_value VARCHAR(120) NOT NULL,
  PRIMARY KEY (sector_pack, label_key)
);

INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES
  ('boulangerie', 'recipe', 'Recette'),
  ('boulangerie', 'recipes', 'Recettes'),
  ('boulangerie', 'production', 'Production'),
  ('boulangerie', 'product', 'Produit'),
  ('generique', 'recipe', 'Nomenclature'),
  ('generique', 'recipes', 'Nomenclatures'),
  ('generique', 'production', 'Fabrication'),
  ('generique', 'product', 'Article')
ON CONFLICT (sector_pack, label_key) DO NOTHING;
