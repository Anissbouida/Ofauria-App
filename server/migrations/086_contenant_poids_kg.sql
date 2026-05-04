-- 086: Ajouter poids_kg aux contenants
-- Pour les contenants dont l'unite n'est pas kg_pate, la quantite theorique est en pieces.
-- On ajoute poids_kg pour exprimer le poids total en kg par lancement.

ALTER TABLE production_contenants ADD COLUMN IF NOT EXISTS poids_kg DECIMAL(10,2);

-- Pour les contenants kg_pate, poids_kg = quantite_theorique (deja en kg)
UPDATE production_contenants
SET poids_kg = quantite_theorique
WHERE unite_lancement = 'kg_pate' AND poids_kg IS NULL;
