-- Migration 479 : base de prix explicite (HT ou TTC) sur l'article.
--
-- Phase 5.1 (feuille de route multi-secteur). Jusqu'ici le même nombre
-- `products.price` était lu TTC pour un particulier (prix affiché en boutique,
-- sans ligne de TVA) et HT pour un professionnel (TVA ajoutée par-dessus) :
-- « le même article lu TTC ici et HT là ». On rend la base explicite.
--
--   price_includes_tax = true  -> products.price est un prix TTC (toutes taxes
--                                  comprises). C'est la réalité d'Ofauria : le
--                                  prix catalogue est le prix payé en boutique.
--   price_includes_tax = false -> products.price est un prix HT (hors taxe).
--
-- Le HT ou le TTC manquant se dérive du taux du code TVA de l'article (mig 473),
-- de façon déterministe, au lieu de réinterpréter le même nombre selon le client.
--
-- Défaut = true (TTC) : miroir exact du comportement Ofauria. Les articles
-- d'Ofauria n'ont pas de code TVA (taux 0) : TTC = HT, rien ne change.
--
-- Les surcharges de prix (prix par canal mig 173, paliers au poids mig 171) sont
-- des remplacements de products.price : elles héritent de la base de l'article
-- (même sémantique HT/TTC). Les vraies listes de prix multi-bases relèvent de la
-- phase 6 (tarification), qui porteront leur propre base.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_includes_tax BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN products.price_includes_tax IS
  'Base du prix catalogue (mig 479) : true = products.price est TTC (défaut, prix boutique Ofauria), false = HT. Le HT/TTC manquant se dérive du taux du code TVA de l''article.';
