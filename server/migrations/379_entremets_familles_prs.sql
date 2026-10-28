-- 379 — Entremets par personne : généralisation aux familles PRS.
--
-- Suite à la mig 377, on remplace les produits numérotés « <FAMILLE> PRS 6/8/10… »
-- par un seul produit « <FAMILLE> PRS » vendu par personne à 30 DH/personne.
-- Les anciennes variantes sont désactivées (is_available = false) et non supprimées,
-- pour conserver l'historique des ventes.
--
-- Idempotent : la création est gardée par NOT EXISTS, la désactivation est un no-op
-- si déjà faite. Les familles sans produit source (prod différente) sont ignorées.
-- Hors périmètre volontairement : FRAISIER PRS / GÂTEAUX AUX FRUITS PRS (déjà uniques),
-- « Noisette 8personnes » et « Basbousa 10pers » (prix non standard, à revoir à la main).
--
-- Rollback : réactiver les variantes et supprimer les produits unifiés créés.

INSERT INTO products (name, slug, category_id, price, price_per_person, cost_price, is_available, sale_unit, sale_type, is_custom_orderable)
SELECT fam.uname, fam.slug, v.category_id, 30, 30, v.cost_price, true, 'person', v.sale_type, true
FROM (VALUES
  ('AMANDINE PRS','amandine-prs','AMANDINE PRS 8'),
  ('CASABLANCA PRS','casablanca-prs','CASABLANCA PRS 8'),
  ('FERRERO ROCHER PRS','ferrero-rocher-prs','FERRERO ROCHER PRS 8'),
  ('FEUILLES D''AUTOMNE PRS','feuilles-d-automne-prs','FEUILLES D''AUTOMNE PRS 8'),
  ('GÂTEAU CARAMEL PRS','gateau-caramel-prs','GÂTEAU CARAMEL PRS 8'),
  ('NOISETTE PRS','noisette-prs','NOISETTE PRS 8'),
  ('OPÉRA PRS','opera-prs','OPÉRA PRS 8'),
  ('PRALINO PRS','pralino-prs','PRALINO PRS 8'),
  ('ROYAL PRS','royal-prs','ROYAL PRS 8'),
  ('TRIO PRS','trio-prs','TRIO PRS 8'),
  ('Ô FAURIA PRS','o-fauria-prs','Ô FAURIA PRS 8')
) AS fam(uname, slug, src)
JOIN LATERAL (SELECT category_id, cost_price, sale_type FROM products WHERE name = fam.src LIMIT 1) v ON true
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = fam.uname);

UPDATE products SET is_available = false, updated_at = NOW()
WHERE name ~* '^(AMANDINE|CASABLANCA|FERRERO ROCHER|FEUILLES D''AUTOMNE|GÂTEAU CARAMEL|NOISETTE|OPÉRA|PRALINO|ROYAL|TRIO|Ô FAURIA) PRS\s*[0-9]+\s*$'
  AND is_available = true;
