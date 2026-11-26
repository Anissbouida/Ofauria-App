-- 732 — Postes horaires et centres de coût selon le métier (audit de cohérence des profils, R2).
--
-- Les postes livrés par la mig 151 (« Vente matin », « Production matin »…) et les centres de coût
-- de la mig 655 (Production, Maintenance, Qualité) étaient proposés à toutes les sociétés : une
-- entreprise de services planifiait ses salariés sur « Production mi-journée ».
--   - shifts.sectors : profils auxquels le poste s'adresse (vide = tous), lu comme les
--     référentiels sectoriels (fn_active_sector_lineage) ; un poste déjà utilisé reste visible.
--     Postes de vente : profils avec caisse ; postes de production : profils qui fabriquent.
--     Nouveau poste commun « Journée 8h-17h ».
--   - cost_centers.module : module dont dépend le centre (Production, Maintenance, Contrôle) ;
--     un centre dont le module est éteint n'est plus proposé (il reste s'il porte des imputations).
--
-- Rollback : ALTER TABLE shifts DROP COLUMN sectors ; DELETE FROM shifts WHERE code = 'DAY' ;
--   ALTER TABLE cost_centers DROP COLUMN module.

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS sectors TEXT[] NOT NULL DEFAULT '{}';
UPDATE shifts SET sectors = '{boulangerie,restauration,commerce_detail,negoce,sante,agroalimentaire,agro_conditionne,atelier,discret,fabrication,process,generique}'
 WHERE code IN ('SALES_AM', 'SALES_PM') AND sectors = '{}';
UPDATE shifts SET sectors = '{boulangerie,restauration,agroalimentaire,agro_conditionne,atelier,discret,fabrication,process,textile,agriculture,generique}'
 WHERE code IN ('PROD_EARLY', 'PROD_MID') AND sectors = '{}';
INSERT INTO shifts (code, label, start_time, end_time, is_night, display_order, is_active)
VALUES ('DAY', 'Journée 8h-17h', '08:00', '17:00', false, 5, true)
ON CONFLICT (code) DO NOTHING;
COMMENT ON COLUMN shifts.sectors IS 'Profils auxquels le poste s''adresse (vide = tous) — mig 732.';

ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS module VARCHAR(40);
UPDATE cost_centers SET module = 'production' WHERE code = 'PROD' AND module IS NULL;
UPDATE cost_centers SET module = 'maintenance' WHERE code = 'MAINT' AND module IS NULL;
UPDATE cost_centers SET module = 'controle' WHERE code = 'QUAL' AND module IS NULL;
COMMENT ON COLUMN cost_centers.module IS 'Module dont dépend le centre ; éteint, le centre n''est plus proposé — mig 732.';
