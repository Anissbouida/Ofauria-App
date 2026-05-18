-- Reclassify existing payments to match new expense category structure
-- Two types of fixes:
--   A) Items in "Autres ingrédients" → correct specific type
--   B) Items pointing to level-2 categories (promoted) → correct level-3 type

-- ═══════════════════════════════════════════════════════════════════
-- A. RECLASSIFICATION DES "AUTRES INGRÉDIENTS"
-- ═══════════════════════════════════════════════════════════════════

-- Fruits & Purées
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000044'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%mangue%' OR description ILIKE '%fraise%'
    OR description ILIKE '%framboise%' OR description ILIKE '%citron%'
    OR description ILIKE '%banane%' OR description ILIKE '%pomme%'
    OR description ILIKE '%pêche%' OR description ILIKE '%pech%'
    OR description ILIKE '%bigarou%' OR description ILIKE '%fruit%');

-- Légumes
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000043'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%carotte%' OR description ILIKE '%laitue%'
    OR description ILIKE '%oignon%' OR description ILIKE '%persil%'
    OR description ILIKE '%tomate%' OR description ILIKE '%courgette%'
    OR description ILIKE '%poivron%' OR description ILIKE '%olive%'
    OR description ILIKE '%choux%' OR description ILIKE '%maïs%'
    OR description ILIKE '%mais%' OR description ILIKE '%cornichon%'
    OR description ILIKE '% légume%');

-- Viandes & Volailles
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000041'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%poulet%' OR description ILIKE '%blanc de poulet%'
    OR description ILIKE '%dinde%' OR description ILIKE '%viande%'
    OR description ILIKE '%jambon%' OR description ILIKE '%kefta%'
    OR description ILIKE '%mergue%');

-- Poissons & Fruits de mer
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000042'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%thon%' OR description ILIKE '%poisson%'
    OR description ILIKE '%crevette%' OR description ILIKE '%saumon%'
    OR description ILIKE '%épice%poisson%');

-- Lait & Produits laitiers (lait, yaourt, fromage, jben, lben)
UPDATE payments SET category_id = 'a0c1343f-fe7a-4fc1-a72e-49e80ecc8a49'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%lait%' OR description ILIKE '%yaourt%'
    OR description ILIKE '%yaoult%' OR description ILIKE '%fromage%'
    OR description ILIKE '%jben%' OR description ILIKE '%lben%'
    OR description ILIKE '%moony%' OR description ILIKE '%kenz%');

-- Crèmes (crème cheese, crème fraîche, caramel, nappage)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000036'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%crème%' OR description ILIKE '%creme%'
    OR description ILIKE '%caramel%' OR description ILIKE '%nappage%'
    OR description ILIKE '%margafrique%' OR description ILIKE '%sofadex%');

-- Beurre
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000013'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%beurre%' OR description ILIKE '%smen%'
    OR description ILIKE '%margarine%');

-- Matières grasses & Huiles
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000038'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%huile%' OR description ILIKE '%ricamaroc%');

-- Chocolat & Cacao
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000037'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%chocolat%' OR description ILIKE '%gala%'
    OR description ILIKE '%cacao%' OR description ILIKE '%lotus%'
    OR description ILIKE '%oreo%' OR description ILIKE '%olla%');

-- Fruits secs & Oléagineux
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000045'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%sésame%' OR description ILIKE '%sesame%'
    OR description ILIKE '%amande%' OR description ILIKE '%noisette%'
    OR description ILIKE '%pistache%' OR description ILIKE '%noix%'
    OR description ILIKE '%raisin%' OR description ILIKE '%grain%'
    OR description ILIKE '%nigelle%' OR description ILIKE '%nigella%'
    OR description ILIKE '%balbola%' OR description ILIKE '%pâté de dattes%'
    OR description ILIKE '%date%');

-- Oeufs
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000015'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%œuf%' OR description ILIKE '%oeuf%'
    OR description ILIKE '%plateau%œuf%' OR description ILIKE '%plateau oeuf%'
    OR description ILIKE '%plateau%egg%');

-- Farine (feuille pastilla, konafa, bghrir, balbouza, semoule)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000012'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%pastilla%' OR description ILIKE '%konafa%'
    OR description ILIKE '%bghrir%' OR description ILIKE '%balbouza%'
    OR description ILIKE '%semoule%' OR description ILIKE '%balbola%');

-- Épices & Arômes
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000040'
WHERE category_id = '30000000-0000-0000-0000-000000000016'
  AND (description ILIKE '%paprika%' OR description ILIKE '%sel %'
    OR description ILIKE '%épice%' OR description ILIKE '%epice%'
    OR description ILIKE '%arôme%' OR description ILIKE '%arome%'
    OR description ILIKE '%gingembre%' OR description ILIKE '%cannelle%'
    OR description ILIKE '%laurier%' OR description ILIKE '%cumin%'
    OR description ILIKE '%lmeska%' OR description ILIKE '%mastic%'
    OR description ILIKE '%colorant%' OR description ILIKE '%vanille%'
    OR description ILIKE '%harissa%' OR description ILIKE '%décoration sable%'
    OR description ILIKE '%cappuccino%');

-- Sucre (reclassify Sucre from "Farine" category)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000014'
WHERE category_id = '30000000-0000-0000-0000-000000000012'
  AND description ILIKE '%sucre%';

-- Levure (reclassify Levure from "Farine" category)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000039'
WHERE category_id = '30000000-0000-0000-0000-000000000012'
  AND (description ILIKE '%levure%' OR description ILIKE '%agent levant%');

-- ═══════════════════════════════════════════════════════════════════
-- B. PAIEMENTS POINTANT VERS DES CATÉGORIES DE NIVEAU 2 → NIVEAU 3
-- ═══════════════════════════════════════════════════════════════════

-- Gaz (level 2 → Gaz ménager bouteilles level 3)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000048'
WHERE category_id = '30000000-0000-0000-0000-000000000001'
  AND (description ILIKE '%bouteille%' OR description ILIKE '%recharge%'
    OR description ILIKE '%gaz%');

-- Livraison → Coursiers (pour les taxis)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000066'
WHERE category_id = '30000000-0000-0000-0000-000000000030'
  AND description ILIKE '%taxi%';

-- Livraison → Livraison fournisseurs (autres)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000064'
WHERE category_id = '30000000-0000-0000-0000-000000000030';

-- Matériel cuisine → types adaptés
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000072' -- Autre matériel
WHERE category_id = '30000000-0000-0000-0000-000000000032';

-- Nettoyage → Produits d'entretien
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000053'
WHERE category_id = '30000000-0000-0000-0000-000000000025'
  AND (description ILIKE '%ajax%' OR description ILIKE '%javel%'
    OR description ILIKE '%oni%' OR description ILIKE '%produit%'
    OR description ILIKE '%papier%' OR description ILIKE '%sac%poubelle%'
    OR description ILIKE '%insecticide%' OR description ILIKE '%polystir%'
    OR description ILIKE '%balai%' OR description ILIKE '%gant%');

-- Nettoyage → Prestataire nettoyage (remaining)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000054'
WHERE category_id = '30000000-0000-0000-0000-000000000025';

-- Réparations → type adapté
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000050' -- Matériel de production
WHERE category_id = '30000000-0000-0000-0000-000000000024';

-- Dettes & Emprunts → Remboursement emprunt
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000078'
WHERE category_id = '30000000-0000-0000-0000-000000000034'
  AND (description ILIKE '%remboursement%' OR description ILIKE '%emprunt%');

-- Dettes & Emprunts → Intérêts bancaires (virements banque)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000079'
WHERE category_id = '30000000-0000-0000-0000-000000000034'
  AND description ILIKE '%virement%';

-- Repas & Restauration → Repas équipe
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000076'
WHERE category_id = '30000000-0000-0000-0000-000000000033';

-- Divers → Imprévus (régularisations, divers)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000081'
WHERE category_id = '30000000-0000-0000-0000-000000000035';

-- ═══════════════════════════════════════════════════════════════════
-- C. CORRECTIONS DIVERSES (mauvaise catégorie à l'origine)
-- ═══════════════════════════════════════════════════════════════════

-- "Image sucrée" était en Boites → Épices & Arômes (décor alimentaire)
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000040'
WHERE category_id = '30000000-0000-0000-0000-000000000017'
  AND description ILIKE '%image%';

-- "Sachet" devrait être Sacs, pas Boites
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000018'
WHERE category_id = '30000000-0000-0000-0000-000000000017'
  AND (description ILIKE '%sachet%' OR description ILIKE '%sac%');

-- Thé (classé en Nettoyage) → Épices & Arômes
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000040'
WHERE category_id = '30000000-0000-0000-0000-000000000053'
  AND description ILIKE '%thé%';

-- Réparation ordinateur (classé Matériel cuisine) → Informatique & POS
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000075' -- Réseau & Internet
WHERE category_id = '30000000-0000-0000-0000-000000000072'
  AND description ILIKE '%ordinateur%';

-- Moule silicone / tab silicone → Petit matériel
UPDATE payments SET category_id = '30000000-0000-0000-0000-000000000068' -- Outillage divers
WHERE category_id = '30000000-0000-0000-0000-000000000072'
  AND (description ILIKE '%moule%' OR description ILIKE '%silicone%'
    OR description ILIKE '%tab3%');
