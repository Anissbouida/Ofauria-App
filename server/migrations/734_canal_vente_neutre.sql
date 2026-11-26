-- 734 — Canal de vente par défaut neutre (audit de cohérence des profils).
--
-- La mig 172 semait le canal par défaut « Boutique » pour toutes les sociétés (une entreprise de
-- services ou de BTP n'a pas de boutique). Le libellé devient « Vente directe » ; le code reste
-- « boutique » (identifiant interne). Seuls les libellés d'origine sont touchés : un canal
-- renommé par la société garde son nom. Accent corrigé sur « Événement ».
--
-- Rollback : UPDATE sales_channels SET label = 'Boutique' WHERE code = 'boutique' AND label = 'Vente directe' ;
--   UPDATE sales_channels SET label = 'Evenement' WHERE code = 'evenement' AND label = 'Événement'.

UPDATE sales_channels SET label = 'Vente directe', updated_at = now() WHERE code = 'boutique' AND label = 'Boutique';
UPDATE sales_channels SET label = 'Événement', updated_at = now() WHERE code = 'evenement' AND label = 'Evenement';
