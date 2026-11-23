-- 637 — Sortir les métiers des rôles (plan d'exécution multi-industries, étape 3).
--
-- POURQUOI
--   Les métiers de la boulangerie vivaient dans les rôles : CHECK de roles.base_role figé sur
--   baker, pastry_chef, viennoiserie, beldi_sale…, suffixes de numéros de demande (BOUL, PAT,
--   VIEN, BELD) et couleurs d'écran indexés sur ces codes. Une société sans ces rôles ne
--   pouvait pas créer un rôle de production autrement qu'en héritant d'un rôle boulanger.
--
-- CE QUI CHANGE
--   - roles.base_role : le CHECK figé est remplacé par un contrôle « base_role = un rôle
--     système existant » (mêmes valeurs aujourd'hui, extensible par ajout d'un rôle système).
--   - Deux archétypes neutres, rôles proposés (non système : un rôle système porte son propre
--     code comme base, contrainte roles_base_coherent) : « Opérateur de production » et
--     « Responsable de production ». Leur périmètre technique est celui des bases existantes (baker,
--     manager) ; leurs droits par module et par action sont recopiés de ces bases.
--   - production_workshops.short_code et .color : le suffixe des numéros et la couleur
--     d'écran sont portés par l'atelier. Reprise à l'identique pour les ateliers existants
--     (BOUL, PAT, VIEN, BELD ; ambre, rose, orange, sarcelle) : aucun numéro ne change.

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_base_role_check;
CREATE OR REPLACE FUNCTION fn_check_role_base() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_role IS NOT NULL AND NEW.base_role <> NEW.code
     AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = NEW.base_role AND r.is_system) THEN
    RAISE EXCEPTION 'Rôle de base inconnu : %', NEW.base_role USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_role_base ON roles;
CREATE TRIGGER trg_check_role_base BEFORE INSERT OR UPDATE OF base_role ON roles
  FOR EACH ROW EXECUTE FUNCTION fn_check_role_base();

INSERT INTO roles (code, label, description, base_role, is_system)
SELECT 'operateur_production', 'Opérateur de production', 'Fabrique dans un atelier : étapes, relevés, déclarations.', 'baker', false
 WHERE EXISTS (SELECT 1 FROM roles WHERE code = 'baker')
ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (code, label, description, base_role, is_system)
SELECT 'responsable_production', 'Responsable de production', 'Planifie, lance et clôture les ordres ; suit les coûts et la qualité.', 'manager', false
 WHERE EXISTS (SELECT 1 FROM roles WHERE code = 'manager')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config)
SELECT 'operateur_production', module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code = 'baker'
ON CONFLICT (role_code, module) DO NOTHING;
INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config)
SELECT 'responsable_production', module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code = 'manager'
ON CONFLICT (role_code, module) DO NOTHING;

DO $$ BEGIN
  IF to_regclass('public.role_action_permissions') IS NOT NULL THEN
    INSERT INTO role_action_permissions (role_code, permission_key)
    SELECT 'operateur_production', permission_key FROM role_action_permissions WHERE role_code = 'baker'
    ON CONFLICT DO NOTHING;
    INSERT INTO role_action_permissions (role_code, permission_key)
    SELECT 'responsable_production', permission_key FROM role_action_permissions WHERE role_code = 'manager'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

ALTER TABLE production_workshops ADD COLUMN IF NOT EXISTS short_code VARCHAR(8);
ALTER TABLE production_workshops ADD COLUMN IF NOT EXISTS color VARCHAR(20);
UPDATE production_workshops SET short_code = CASE code
    WHEN 'baker' THEN 'BOUL' WHEN 'pastry_chef' THEN 'PAT' WHEN 'viennoiserie' THEN 'VIEN' WHEN 'beldi_sale' THEN 'BELD'
    ELSE upper(left(code, 4)) END
 WHERE short_code IS NULL;
UPDATE production_workshops SET color = CASE
    WHEN code IN ('baker', 'boulangerie') THEN 'amber'
    WHEN code IN ('pastry_chef', 'patisserie') THEN 'pink'
    WHEN code = 'viennoiserie' THEN 'orange'
    WHEN code IN ('beldi_sale', 'beldi', 'sale') THEN 'teal'
    ELSE NULL END
 WHERE color IS NULL;
