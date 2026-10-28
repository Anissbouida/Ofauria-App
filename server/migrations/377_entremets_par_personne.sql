-- 377 — Entremets vendus par personne (mode de vente « person »).
--
-- Les entremets se vendent au nombre de parts : au lieu de produits distincts
-- « AMANDINE PRS 6 / 8 / 10 », un seul produit « AMANDINE PRS » avec un prix par
-- personne, et un nombre de personnes choisi en caisse parmi des tailles
-- standard (4, 6, 8, 10, 12, 16, paramétrables). En caisse, la ligne se calcule
-- comme pour le poids : quantity = nombre de personnes, prix = prix/personne × qté.
--
-- Rollback : remettre les CHECK à (unit, weight) / (unit, g), supprimer
-- price_per_person et le paramètre sales.person_sizes.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sale_unit_check;
ALTER TABLE products ADD CONSTRAINT products_sale_unit_check
  CHECK ((sale_unit)::text = ANY (ARRAY['unit', 'weight', 'person']));

ALTER TABLE products ADD COLUMN IF NOT EXISTS price_per_person NUMERIC(10,2);
COMMENT ON COLUMN products.price_per_person IS 'Prix par personne pour un entremet vendu au nombre de parts (sale_unit = person), mig 377.';

ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_unit_check;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_unit_check
  CHECK ((unit)::text = ANY (ARRAY['unit', 'g', 'person']));

INSERT INTO module_parameters (key, value, description) VALUES
  ('sales.person_sizes', '[4, 6, 8, 10, 12, 16]'::jsonb,
   'Tailles standard (nombre de personnes) proposées en caisse pour les entremets vendus par personne (mig 377).')
ON CONFLICT (key) DO NOTHING;
