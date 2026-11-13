-- 510 — Secteur « Industrie / Fabrication » (plan Production générique, lot P1).
--
-- Pour une entreprise qui fabrique autre chose que du pain : tout le transverse du
-- secteur Générique + le socle de fabrication (Production et Fiches techniques =
-- nomenclatures). La couche boulangerie reste éteinte : pas de Demandes boutique, ni
-- d'Invendus, ni de Contrôle des ventes, et aucune option boulangerie (features vide :
-- DLC du jour, vitrine, contenants cru/cuit, cuisson, HACCP, congélation, fiche
-- bilingue). Chacun se rallume dans Paramètres › Secteur et modules (mig 507).
--
-- Additif : nouveau pack, aucune société n'y est rattachée. Retour arrière : retirer
-- les lignes 'fabrication' de sector_labels puis de sector_packs.

INSERT INTO sector_packs (code, label, enabled_modules, home_route, report_keys, features) VALUES
  ('fabrication', 'Industrie / Fabrication', ARRAY[
     'dashboard','pos','sales','orders','products','customers','stock','recipes','production',
     'employees','accounting','purchasing','users','reports','settings','packaging','controle',
     'projects','crm','maintenance'
   ], NULL, ARRAY['sales','margins','builder'], '{}')
ON CONFLICT (code) DO NOTHING;

-- Vocabulaire neutre (phase 9.1) : nomenclature et fabrication plutôt que recette et
-- production. Le lot P6 étendra ces libellés à tout le module.
INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES
  ('fabrication', 'recipe', 'Nomenclature'),
  ('fabrication', 'recipes', 'Nomenclatures'),
  ('fabrication', 'production', 'Fabrication'),
  ('fabrication', 'product', 'Article'),
  ('fabrication', 'products', 'Articles')
ON CONFLICT (sector_pack, label_key) DO NOTHING;
