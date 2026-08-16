-- Migration 268 : Ecart de mix isole dans le cout reel (audit A10, P2)
--
-- POURQUOI
--   nb_par_defaut d'un format determine son ratio_poids -> le cout unitaire
--   theorique est fige sur le mix par defaut. Si un plan lance 6 moyens + 0
--   petits alors que le mix standard etait 3+3, le cout prevu total (mig 261,
--   theo_cout_complet_u × planned_quantity) ne reflete pas le mix effectif.
--   L'ecart standard/reel embarque un « ecart de mix » non isole : impossible
--   de dire si l'ecart vient d'un prix matiere different, d'une perte, ou
--   simplement du mix change.
--
--   SAP decompose : ecart_total = ecart_mix + ecart_prix_ou_perte. On fait
--   pareil ici :
--     cout_prevu           = SUM(theo_cout_complet_u × planned_quantity)      [snapshot A6b]
--     cout_prevu_mix_reel  = SUM(theo_cout_complet_u × actual_quantity)       [prevu applique au mix effectivement produit]
--     ecart_mix            = cout_prevu - cout_prevu_mix_reel                 [+ = mix reduit / - = mix plus dense]
--     ecart_prix_ou_perte  = cout_total - cout_prevu_mix_reel                 [reste : prix + pertes]
--     ecart_total          = cout_total - cout_prevu                         = ecart_mix + ecart_prix_ou_perte
--
--   Fallback actual_quantity IS NULL (item en cours ou jamais produit) :
--   utilise planned_quantity -> pas d'ecart de mix sur cet item.
--
-- PORTEE
--   ALTER TABLE production_cout_reel : 2 colonnes nullables.
--   Repo production-cout.calculateFor() calcule et upsert les 2 valeurs.
--   Aucune donnee existante modifiee.
--
-- INVERSION
--   ALTER TABLE production_cout_reel DROP COLUMN cout_prevu_mix_reel;
--   ALTER TABLE production_cout_reel DROP COLUMN ecart_mix;

ALTER TABLE production_cout_reel
  ADD COLUMN IF NOT EXISTS cout_prevu_mix_reel NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS ecart_mix           NUMERIC(12,2);

COMMENT ON COLUMN production_cout_reel.cout_prevu_mix_reel IS
  'Prevu au mix reellement produit : SUM(theo_cout_complet_u × actual_quantity). Mig 268 (A10).';
COMMENT ON COLUMN production_cout_reel.ecart_mix IS
  'Ecart de mix : cout_prevu - cout_prevu_mix_reel. Isole l''effet du changement de mix sur l''ecart total. Mig 268 (A10).';
