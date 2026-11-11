-- Phase 9.4 — Deuxième secteur réel : négoce (achat-revente), de bout en bout.
--
-- Un pack « Négoce » : tout le transverse commercial (ventes, commandes, clients, stock,
-- achats, caisse, compta, CRM) SANS fabrication (ni production, ni recettes, ni pesage, ni
-- invendus). Une société de négoce va du devis à l'encaissement sans écran boulangerie.
-- Ses articles sont des articles de revente (products.item_kind='resale', phase 3), sans
-- recette. Additif : nouveau pack, aucune société existante n'y est rattachée.

INSERT INTO sector_packs (code, label, enabled_modules, home_route, report_keys) VALUES
  ('negoce', 'Négoce (achat-revente)', ARRAY[
     'dashboard','pos','sales','orders','products','customers','stock','employees',
     'accounting','purchasing','users','reports','settings','crm'
   ], '/sales', ARRAY['sales','margins','builder'])
ON CONFLICT (code) DO NOTHING;

INSERT INTO sector_labels (sector_pack, label_key, label_value) VALUES
  ('negoce', 'product', 'Article'),
  ('negoce', 'products', 'Articles'),
  ('negoce', 'recipe', 'Fiche article'),
  ('negoce', 'production', 'Réassort')
ON CONFLICT (sector_pack, label_key) DO NOTHING;
