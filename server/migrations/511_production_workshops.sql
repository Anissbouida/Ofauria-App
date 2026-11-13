-- 511 — Ateliers de production paramétrables (plan Production générique, lot P2).
--
-- Jusqu'ici l'atelier ÉTAIT le rôle du chef : baker, pastry_chef, viennoiserie,
-- beldi_sale, et la correspondance catégorie → atelier était codée en dur
-- (shared ROLE_CATEGORY_SLUGS, et une 2e copie divergente dans order.controller).
-- Désormais un atelier est une ligne de référentiel :
--   * production_workshops            : l'atelier (libellé, poste de travail facultatif) ;
--   * production_workshop_categories  : les catégories de produits qu'il fabrique ;
--   * production_workshop_members     : qui y travaille (un rôle ou un utilisateur).
--
-- Le CODE de l'atelier reste ce que production_plans.target_role contient : les 4
-- ateliers repris gardent exactement le code de leur rôle, donc aucun plan existant,
-- aucune notification, aucun écran ne change pour la boulangerie. Un nouvel atelier
-- (« Montage ») fonctionne sans toucher au code.
--
-- Additif. Retour arrière : DROP TABLE production_workshop_members,
-- production_workshop_categories, production_workshops.

CREATE TABLE IF NOT EXISTS production_workshops (
  code            VARCHAR(30) PRIMARY KEY,
  label           VARCHAR(80) NOT NULL,
  work_center_id  UUID REFERENCES work_centers(id) ON DELETE SET NULL,
  -- Atelier qui reçoit ce qui n'est rattaché à aucun atelier (notifications de commandes).
  is_default      BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_workshop_code CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_default ON production_workshops (is_default) WHERE is_default;

-- Une catégorie relève d'un seul atelier.
CREATE TABLE IF NOT EXISTS production_workshop_categories (
  category_id    INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  workshop_code  VARCHAR(30) NOT NULL REFERENCES production_workshops(code) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS production_workshop_members (
  id             BIGSERIAL PRIMARY KEY,
  workshop_code  VARCHAR(30) NOT NULL REFERENCES production_workshops(code) ON DELETE CASCADE ON UPDATE CASCADE,
  role_code      VARCHAR(30) REFERENCES roles(code) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_workshop_member_one CHECK ((role_code IS NULL) <> (user_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_member_role ON production_workshop_members (workshop_code, role_code) WHERE role_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_member_user ON production_workshop_members (workshop_code, user_id) WHERE user_id IS NOT NULL;

-- Reprise : les 4 ateliers d'aujourd'hui, code = rôle, membres = ce rôle.
INSERT INTO production_workshops (code, label, is_default, sort_order)
SELECT v.code, v.label, v.is_default, v.ord
  FROM (VALUES ('baker', 'Boulangerie', true, 10), ('viennoiserie', 'Viennoiserie', false, 20),
               ('pastry_chef', 'Pâtisserie', false, 30), ('beldi_sale', 'Beldi & Salé', false, 40)) AS v(code, label, is_default, ord)
 WHERE EXISTS (SELECT 1 FROM roles r WHERE r.code = v.code)
ON CONFLICT (code) DO NOTHING;

INSERT INTO production_workshop_members (workshop_code, role_code)
SELECT w.code, w.code FROM production_workshops w
 WHERE w.code IN ('baker', 'viennoiserie', 'pastry_chef', 'beldi_sale')
   AND EXISTS (SELECT 1 FROM roles r WHERE r.code = w.code)
ON CONFLICT DO NOTHING;

-- Catégories : copie exacte de ROLE_CATEGORY_SLUGS (shared/src/constants/roles.ts).
INSERT INTO production_workshop_categories (category_id, workshop_code)
SELECT c.id, v.workshop
  FROM (VALUES
    ('baguette', 'baker'), ('baguette-tradition', 'baker'), ('pain-rond', 'baker'), ('pain-sandwich', 'baker'),
    ('viennoiseries', 'viennoiserie'),
    ('patisserie-classique', 'pastry_chef'), ('patisserie-premium', 'pastry_chef'), ('entremets', 'pastry_chef'),
    ('gateaux-cookies', 'pastry_chef'), ('cake-et-muffins', 'pastry_chef'), ('les-boites', 'pastry_chef'),
    ('macaron', 'pastry_chef'), ('pieces-portions', 'pastry_chef'), ('plateau-sale-sucre', 'pastry_chef'),
    ('sachet-mini', 'pastry_chef'),
    ('beldi', 'beldi_sale'), ('sale', 'beldi_sale'), ('sale-soiree', 'beldi_sale')
  ) AS v(slug, workshop)
  JOIN categories c ON c.slug = v.slug
  JOIN production_workshops w ON w.code = v.workshop
ON CONFLICT (category_id) DO NOTHING;

-- Journal du paramétrage (mig 328).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS production_workshops_config_audit ON production_workshops;
    CREATE TRIGGER production_workshops_config_audit AFTER INSERT OR UPDATE OR DELETE ON production_workshops
      FOR EACH ROW EXECUTE FUNCTION log_config_change('code', '');
    DROP TRIGGER IF EXISTS production_workshop_categories_config_audit ON production_workshop_categories;
    CREATE TRIGGER production_workshop_categories_config_audit AFTER INSERT OR UPDATE OR DELETE ON production_workshop_categories
      FOR EACH ROW EXECUTE FUNCTION log_config_change('category_id', 'workshop_code');
    DROP TRIGGER IF EXISTS production_workshop_members_config_audit ON production_workshop_members;
    CREATE TRIGGER production_workshop_members_config_audit AFTER INSERT OR UPDATE OR DELETE ON production_workshop_members
      FOR EACH ROW EXECUTE FUNCTION log_config_change('id', 'workshop_code');
  END IF;
END $$;
