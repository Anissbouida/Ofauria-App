-- 645 — Coûts : coût machine réel et composantes de coût activables (plan d'exécution
-- multi-industries, étape 9).
--
-- POURQUOI
--   Le taux horaire d'un poste de charge ne servait qu'au coût standard : le coût réel d'un
--   ordre ignorait le temps machine, essentiel en mécanique ou en atelier. Et toutes les
--   composantes (MO, énergie, charges…) étaient calculées quel que soit le métier.
--
-- CE QUI CHANGE
--   - production_cout_reel.cout_machine / detail_machine : taux du poste × temps réel des
--     étapes rattachées à un poste (production_item_etapes.work_center_id, duree_reelle_min).
--   - cout_total recréé : + cout_machine. Valeurs existantes inchangées (cout_machine = 0).
--   - Composantes activables par la politique production.cost_components (catalogue des
--     paramètres) : défaut = les composantes calculées aujourd'hui, machine ÉTEINTE (Ofauria
--     inchangé). Les profils « discret » et « atelier » livrent la composante machine allumée.
--
-- RETOUR ARRIÈRE
--   Recréer cout_total sans cout_machine (définition de la mig 584) ;
--   ALTER TABLE production_cout_reel DROP COLUMN cout_machine, DROP COLUMN detail_machine.

ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS cout_machine NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS detail_machine JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE production_cout_reel DROP COLUMN IF EXISTS cout_total;
ALTER TABLE production_cout_reel ADD COLUMN cout_total numeric(12,2)
  GENERATED ALWAYS AS (cout_matieres + cout_emballages + cout_main_oeuvre + cout_energie
                       + COALESCE(cout_charges_fixes, 0) + cout_sous_traitance + cout_machine) STORED;
COMMENT ON COLUMN production_cout_reel.cout_total IS 'Coût de revient = matières + emballages + MO + énergie + charges + façon + machine (mig 527, 584, 645).';

-- Profils de fabrication discrète et d'atelier : composante machine allumée.
UPDATE sector_packs
   SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{policies}',
                           COALESCE(profile->'policies', '[]'::jsonb)
                           || '[{"key": "production.cost_components", "value": {"emballage": true, "main_oeuvre": true, "machine": true, "energie": true, "sous_traitance": true, "pertes": true, "charges": true}}]'::jsonb)
 WHERE code IN ('discret', 'atelier')
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(profile->'policies', '[]'::jsonb)) p WHERE p->>'key' = 'production.cost_components');
