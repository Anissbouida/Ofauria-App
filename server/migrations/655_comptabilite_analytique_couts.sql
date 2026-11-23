-- ═══════════════════════════════════════════════════════════════════════
-- 655 — Moteur analytique du coût de revient (imputation rationnelle)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Le mode « charges mensuelles » (mig 527) répartissait les charges du mois au
--   prorata des matières des plans DÉJÀ CHIFFRÉS. En novembre 2026 : 293 plans,
--   1 seul chiffré → il recevait 100 % des 36 000 DH (revient 37 206 DH pour
--   1 376 pains). Aucune notion de capacité, de centre, de nature de charge.
--
-- QUOI
--   1. Centres de coûts (mig 386) enrichis : principal / auxiliaire, niveau
--      (approvisionnement, production, administration, distribution), sous-centre,
--      inducteur (unité d'œuvre), capacité normale et maximale, règles de cession
--      des centres auxiliaires vers les principaux (pourcentages, effectif, masse
--      salariale). 11 centres proposés par défaut.
--   2. analytic_charges : référentiel des charges à répartir, classées sur deux
--      axes indépendants (fixe / variable / semi-variable × directe / indirecte),
--      rattachées à un centre (ou à une clé de répartition en %), ou à un produit
--      (charge directe : équipement dédié…). Montant prévisionnel mensuel +
--      montant réel par mois (analytic_charge_actuals).
--   3. employee_cost_allocations : un salarié réparti sur un ou plusieurs centres
--      (%), main-d'œuvre directe ou indirecte. Son coût = coût employeur de la paie
--      (brut + charges patronales).
--   4. fn_plan_cost_drivers : quantités d'inducteurs consommées par chaque plan
--      (unités, kg, heures MO, heures machine, lots, valeur matières, valeur de
--      vente HT) — base des taux et de l'activité réelle d'une période.
--   5. production_cout_reel : charges d'approvisionnement, de production, de
--      structure et directes séparées ; niveaux de coût et comparaison des
--      méthodes (jsonb) ; cout_production (colonne calculée) = coût de production
--      SANS les charges de structure → valorisation des lots de produits finis.
--      cout_total reste le coût de revient complet (pilotage des marges).
--   6. company_settings.production_charges_method : nouvelle valeur 'analytic'.
--      Les sociétés en « charges mensuelles » y passent (leurs charges sont reprises
--      dans le référentiel) ; celles au « taux sur les matières » ne changent pas.
--
-- INVERSION
--   UPDATE company_settings SET production_charges_method = 'monthly' WHERE production_charges_method = 'analytic';
--   ALTER TABLE company_settings DROP CONSTRAINT chk_company_settings_charges_method; (re-créer avec rate, monthly)
--   ALTER TABLE production_cout_reel DROP COLUMN cout_production, DROP COLUMN cout_charges_appro,
--     DROP COLUMN cout_charges_production, DROP COLUMN cout_charges_structure, DROP COLUMN cout_charges_directes,
--     DROP COLUMN detail_analytique, DROP COLUMN niveaux, DROP COLUMN methodes;
--   Re-créer fn_plan_item_unit_cost_v2 sur cout_total (mig 598).
--   DROP FUNCTION fn_plan_cost_drivers(uuid, date, date, uuid);
--   DROP TABLE employee_cost_allocations, analytic_charge_actuals, analytic_charges, cost_center_transfers;
--   ALTER TABLE cost_centers DROP COLUMN kind, level, parent_id, driver, normal_capacity, max_capacity,
--     transfer_basis, sort_order, description;
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Centres de coûts ───────────────────────────────────────────────
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS kind            varchar(12) NOT NULL DEFAULT 'principal';
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS level           varchar(20) NOT NULL DEFAULT 'production';
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS parent_id       uuid REFERENCES cost_centers(id) ON DELETE SET NULL;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS driver          varchar(20) NOT NULL DEFAULT 'units';
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS normal_capacity numeric(14,3) CHECK (normal_capacity IS NULL OR normal_capacity > 0);
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS max_capacity    numeric(14,3) CHECK (max_capacity IS NULL OR max_capacity > 0);
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS transfer_basis  varchar(12) NOT NULL DEFAULT 'percent';
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS sort_order      int NOT NULL DEFAULT 100;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS description     text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cost_centers_kind') THEN
    ALTER TABLE cost_centers ADD CONSTRAINT chk_cost_centers_kind CHECK (kind IN ('principal', 'auxiliaire'));
    ALTER TABLE cost_centers ADD CONSTRAINT chk_cost_centers_level
      CHECK (level IN ('approvisionnement', 'production', 'administration', 'distribution'));
    ALTER TABLE cost_centers ADD CONSTRAINT chk_cost_centers_driver
      CHECK (driver IN ('units', 'weight_kg', 'labour_hours', 'machine_hours', 'batches', 'material_cost', 'sales_value'));
    ALTER TABLE cost_centers ADD CONSTRAINT chk_cost_centers_transfer_basis
      CHECK (transfer_basis IN ('percent', 'headcount', 'payroll'));
    ALTER TABLE cost_centers ADD CONSTRAINT chk_cost_centers_parent CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;
COMMENT ON COLUMN cost_centers.kind IS 'Mig 655 : principal (impute ses coûts aux produits) ou auxiliaire (cède ses coûts aux autres centres).';
COMMENT ON COLUMN cost_centers.level IS 'Mig 655 : niveau de coût alimenté — approvisionnement (coût d''achat), production (coût de production), administration / distribution (coût de revient complet).';
COMMENT ON COLUMN cost_centers.driver IS 'Mig 655 : inducteur (unité d''œuvre) d''un centre principal : units, weight_kg, labour_hours, machine_hours, batches, material_cost, sales_value.';
COMMENT ON COLUMN cost_centers.normal_capacity IS 'Mig 655 : capacité normale mensuelle, en unités de l''inducteur (NULL = moyenne des 3 derniers mois). Base de l''imputation rationnelle des charges fixes.';
COMMENT ON COLUMN cost_centers.max_capacity IS 'Mig 655 : capacité maximale théorique mensuelle (information, taux d''utilisation).';
COMMENT ON COLUMN cost_centers.transfer_basis IS 'Mig 655 : cession d''un centre auxiliaire — percent (règles cost_center_transfers), headcount (effectif affecté aux centres principaux), payroll (masse salariale affectée).';

CREATE TABLE IF NOT EXISTS cost_center_transfers (
  from_center_id uuid NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  to_center_id   uuid NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  percent        numeric(7,4) NOT NULL CHECK (percent > 0 AND percent <= 100),
  PRIMARY KEY (from_center_id, to_center_id),
  CHECK (from_center_id <> to_center_id)
);
COMMENT ON TABLE cost_center_transfers IS 'Mig 655 : répartition secondaire — part (%) du coût d''un centre auxiliaire cédée à un autre centre.';

-- Centres proposés (codes stables ; un centre existant du même code est gardé tel quel).
INSERT INTO cost_centers (code, name, axis_id, kind, level, driver, transfer_basis, sort_order, description)
SELECT v.code, v.name, (SELECT id FROM analytic_axes WHERE code = 'ACT'), v.kind, v.level, v.driver, v.basis, v.ord, v.descr
  FROM (VALUES
    ('PROD',  'Production',               'principal',  'production',        'units',         'percent',   10, 'Ateliers de fabrication : personnel de production, locaux et énergie des ateliers.'),
    ('ACH',   'Achats et approvisionnement','principal','approvisionnement', 'material_cost', 'percent',   20, 'Achats, réception, magasin matières : alimente le coût d''achat des matières.'),
    ('ADM',   'Administration',           'principal',  'administration',    'sales_value',   'percent',   30, 'Charges administratives générales.'),
    ('COM',   'Commercial et marketing',  'principal',  'distribution',      'sales_value',   'percent',   40, 'Vente, boutique, marketing, distribution.'),
    ('MAINT', 'Maintenance',              'auxiliaire', 'production',        'units',         'percent',   50, 'Entretien des équipements : cédé à la production.'),
    ('QUAL',  'Qualité',                  'auxiliaire', 'production',        'units',         'percent',   55, 'Contrôle qualité, hygiène, analyses : cédé à la production.'),
    ('LOG',   'Logistique',               'auxiliaire', 'production',        'units',         'percent',   60, 'Stockage, préparation, livraisons.'),
    ('DG',    'Direction générale',       'auxiliaire', 'administration',    'sales_value',   'percent',   70, 'Dirigeants et direction générale.'),
    ('RH',    'Ressources humaines',      'auxiliaire', 'administration',    'sales_value',   'headcount', 75, 'Gestion du personnel : cédée au prorata de l''effectif.'),
    ('FIN',   'Comptabilité et finances', 'auxiliaire', 'administration',    'sales_value',   'percent',   80, 'Comptabilité, trésorerie, juridique.'),
    ('IT',    'Informatique',             'auxiliaire', 'administration',    'sales_value',   'headcount', 85, 'Logiciels, matériel, abonnements : cédés au prorata de l''effectif.')
  ) AS v(code, name, kind, level, driver, basis, ord, descr)
ON CONFLICT (code) DO NOTHING;

-- Cessions par défaut des centres auxiliaires « au pourcentage ».
INSERT INTO cost_center_transfers (from_center_id, to_center_id, percent)
SELECT f.id, t.id, v.pct
  FROM (VALUES ('MAINT','PROD',100), ('QUAL','PROD',100), ('LOG','ACH',60), ('LOG','PROD',40),
               ('DG','ADM',100), ('FIN','ADM',100)) AS v(f, t, pct)
  JOIN cost_centers f ON f.code = v.f AND f.kind = 'auxiliaire'
  JOIN cost_centers t ON t.code = v.t
 WHERE NOT EXISTS (SELECT 1 FROM cost_center_transfers x WHERE x.from_center_id = f.id)
ON CONFLICT DO NOTHING;

-- ─── 2. Référentiel des charges ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytic_charges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid REFERENCES stores(id),
  label             varchar(160) NOT NULL,
  nature            varchar(24) NOT NULL DEFAULT 'autre'
                    CHECK (nature IN ('loyer', 'assurance', 'abonnement', 'amortissement', 'salaires', 'energie', 'eau',
                                      'maintenance', 'informatique', 'securite', 'administratif', 'honoraires',
                                      'transport', 'marketing', 'sous_traitance', 'consommables', 'taxes', 'autre')),
  behavior          varchar(14) NOT NULL DEFAULT 'fixed' CHECK (behavior IN ('fixed', 'variable', 'semi_variable')),
  fixed_pct         numeric(5,2) NOT NULL DEFAULT 100 CHECK (fixed_pct BETWEEN 0 AND 100),
  assignment        varchar(10) NOT NULL DEFAULT 'indirect' CHECK (assignment IN ('direct', 'indirect')),
  cost_center_id    uuid REFERENCES cost_centers(id),
  allocation_key_id uuid REFERENCES analytic_keys(id),
  product_id        uuid REFERENCES products(id),
  normal_quantity   numeric(14,3) CHECK (normal_quantity IS NULL OR normal_quantity > 0),
  monthly_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Une charge directe vise un produit ; une indirecte, un centre ou une clé.
  CONSTRAINT chk_analytic_charge_target CHECK (
    (assignment = 'direct' AND product_id IS NOT NULL)
    OR (assignment = 'indirect' AND product_id IS NULL AND (cost_center_id IS NOT NULL OR allocation_key_id IS NOT NULL))
  )
);
CREATE INDEX IF NOT EXISTS idx_analytic_charges_store ON analytic_charges (store_id) WHERE is_active;
COMMENT ON TABLE analytic_charges IS
  'Mig 655 : charges réparties dans le coût de revient. behavior (fixe/variable/semi-variable, fixed_pct = part fixe) et assignment (directe → produit ; indirecte → centre ou clé %) sont indépendants. monthly_amount = prévisionnel ; réel par mois dans analytic_charge_actuals.';
COMMENT ON COLUMN analytic_charges.normal_quantity IS 'Mig 655 : charge directe — quantité mensuelle normale du produit (NULL = moyenne des 3 derniers mois).';

CREATE TABLE IF NOT EXISTS analytic_charge_actuals (
  charge_id  uuid NOT NULL REFERENCES analytic_charges(id) ON DELETE CASCADE,
  period     date NOT NULL CHECK (period = date_trunc('month', period)::date),
  amount     numeric(14,2) NOT NULL CHECK (amount >= 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (charge_id, period)
);
COMMENT ON TABLE analytic_charge_actuals IS 'Mig 655 : montant réel d''une charge pour un mois (sinon le prévisionnel s''applique).';

-- Reprise des charges mensuelles saisies (mig 527) dans le référentiel.
DO $$
DECLARE
  v_loyer numeric; v_energie numeric; v_autres numeric; v_prod uuid; v_key uuid; v_axis uuid;
BEGIN
  SELECT COALESCE(production_charge_loyer, 0), COALESCE(production_charge_energie, 0), COALESCE(production_charge_autres, 0)
    INTO v_loyer, v_energie, v_autres FROM company_settings WHERE id = 1;
  SELECT id INTO v_prod FROM cost_centers WHERE code = 'PROD';
  SELECT id INTO v_axis FROM analytic_axes WHERE code = 'ACT';
  IF EXISTS (SELECT 1 FROM analytic_charges) OR v_prod IS NULL THEN RETURN; END IF;
  IF v_loyer > 0 THEN
    -- Loyer : clé « surfaces occupées » (ateliers 70 %, boutique 20 %, bureaux 10 %), modifiable.
    INSERT INTO analytic_keys (axis_id, name) VALUES (v_axis, 'Surfaces occupées')
      ON CONFLICT (axis_id, name) DO NOTHING;
    SELECT id INTO v_key FROM analytic_keys WHERE axis_id = v_axis AND name = 'Surfaces occupées';
    INSERT INTO analytic_key_lines (key_id, cost_center_id, percent)
    SELECT v_key, c.id, v.pct FROM (VALUES ('PROD', 70), ('COM', 20), ('ADM', 10)) AS v(code, pct)
      JOIN cost_centers c ON c.code = v.code
    ON CONFLICT DO NOTHING;
    INSERT INTO analytic_charges (label, nature, behavior, fixed_pct, assignment, allocation_key_id, monthly_amount, notes)
    VALUES ('Loyer', 'loyer', 'fixed', 100, 'indirect', v_key, v_loyer, 'Repris des charges mensuelles de production (mig 527).');
  END IF;
  IF v_energie > 0 THEN
    INSERT INTO analytic_charges (label, nature, behavior, fixed_pct, assignment, cost_center_id, monthly_amount, notes)
    VALUES ('Énergie (eau, électricité, gaz)', 'energie', 'semi_variable', 30, 'indirect', v_prod, v_energie,
            'Repris des charges mensuelles de production (mig 527). Part fixe 30 % (abonnements, éclairage), modifiable.');
  END IF;
  IF v_autres > 0 THEN
    INSERT INTO analytic_charges (label, nature, behavior, fixed_pct, assignment, cost_center_id, monthly_amount, notes)
    VALUES ('Autres charges fixes', 'autre', 'fixed', 100, 'indirect', v_prod, v_autres, 'Repris des charges mensuelles de production (mig 527).');
  END IF;
END $$;

-- ─── 3. Personnel par centre ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_cost_allocations (
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cost_center_id uuid NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  percent        numeric(7,4) NOT NULL CHECK (percent > 0 AND percent <= 100),
  labor_type     varchar(10) NOT NULL DEFAULT 'indirect' CHECK (labor_type IN ('direct', 'indirect')),
  PRIMARY KEY (employee_id, cost_center_id)
);
COMMENT ON TABLE employee_cost_allocations IS
  'Mig 655 : répartition du coût employeur d''un salarié entre centres (%, total 100). direct = main-d''œuvre directe de production (imputée par le temps pointé ; le temps non pointé reste dans le centre).';

-- Affectation proposée d'après le rôle (modifiable dans Production › Coûts analytiques).
INSERT INTO employee_cost_allocations (employee_id, cost_center_id, percent, labor_type)
SELECT e.id, c.id, 100,
       CASE WHEN e.role IN ('baker', 'pastry_chef', 'viennoiserie', 'chef_beldi', 'chef_sale', 'beldi_sale') THEN 'direct' ELSE 'indirect' END
  FROM employees e
  JOIN cost_centers c ON c.code = CASE
         WHEN e.role IN ('baker', 'pastry_chef', 'viennoiserie', 'chef_beldi', 'chef_sale', 'beldi_sale', 'production') THEN 'PROD'
         WHEN e.role IN ('econome', 'magasinier') THEN 'LOG'
         WHEN e.role IN ('resp_achats', 'acheteur') THEN 'ACH'
         WHEN e.role IN ('cashier', 'commercial', 'vendeur', 'seller') THEN 'COM'
         WHEN e.role IN ('manager', 'admin', 'directeur') THEN 'DG'
         WHEN e.role IN ('comptable', 'accountant') THEN 'FIN'
         WHEN e.role IN ('rh', 'hr') THEN 'RH'
         ELSE 'ADM' END
 WHERE NOT EXISTS (SELECT 1 FROM employee_cost_allocations a WHERE a.employee_id = e.id)
ON CONFLICT DO NOTHING;

-- ─── 4. Inducteurs consommés par les plans ─────────────────────────────
-- Quantités d'unités d'œuvre de chaque plan (en cours ou terminé) d'une période :
-- un plan précis (p_plan) ou tous ceux d'un établissement sur [p_from, p_to[.
CREATE OR REPLACE FUNCTION fn_plan_cost_drivers(p_store uuid, p_from date, p_to date, p_plan uuid DEFAULT NULL)
RETURNS TABLE (plan_id uuid, plan_date date, units numeric, weight_kg numeric, labour_hours numeric,
               machine_hours numeric, batches numeric, material_cost numeric, sales_value numeric)
LANGUAGE sql STABLE AS $$
  WITH plans AS (
    SELECT pp.id, pp.plan_date::date AS plan_date
      FROM production_plans pp
     WHERE (p_plan IS NOT NULL AND pp.id = p_plan)
        OR (p_plan IS NULL AND pp.store_id IS NOT DISTINCT FROM p_store AND pp.plan_date >= p_from AND pp.plan_date < p_to
            AND pp.status IN ('in_progress', 'completed'))
  ),
  items AS (
    SELECT ppi.plan_id,
           SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) AS units,
           SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity) * COALESCE(rf.poids_cuit_g / 1000.0, r.piece_weight_kg, 0)) AS weight_kg,
           COUNT(*) AS batches,
           SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity) * COALESCE(p.price, 0)
               / CASE WHEN p.price_includes_tax THEN 1 + COALESCE(tc.rate, 0) / 100 ELSE 1 END) AS sales_value
      FROM production_plan_items ppi
      JOIN plans ON plans.id = ppi.plan_id
      JOIN products p ON p.id = ppi.product_id
      LEFT JOIN recipe_formats rf ON rf.id = ppi.format_id
      LEFT JOIN recipes r ON r.id = COALESCE(ppi.alt_recipe_id,
             (SELECT r2.id FROM recipes r2 WHERE r2.product_id = ppi.product_id AND r2.archived_at IS NULL LIMIT 1))
      LEFT JOIN LATERAL (SELECT t.rate FROM tax_codes t WHERE t.code = p.tax_code AND t.valid_from <= CURRENT_DATE
                          ORDER BY t.valid_from DESC LIMIT 1) tc ON true
     WHERE ppi.status <> 'cancelled'
     GROUP BY ppi.plan_id
  ),
  steps AS (
    SELECT ppi.plan_id,
           SUM(pie.duree_reelle_min) / 60.0 AS labour_hours,
           SUM(pie.duree_reelle_min) FILTER (WHERE pie.work_center_id IS NOT NULL) / 60.0 AS machine_hours
      FROM production_item_etapes pie
      JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
      JOIN plans ON plans.id = ppi.plan_id
     WHERE pie.status = 'completed' AND pie.duree_reelle_min > 0
     GROUP BY ppi.plan_id
  ),
  std_machine AS (
    SELECT l.plan_id, SUM(l.minutes_required) / 60.0 AS hours
      FROM v_production_work_center_load l JOIN plans ON plans.id = l.plan_id
     GROUP BY l.plan_id
  ),
  lots AS (
    SELECT plu.production_plan_id AS plan_id, plu.ingredient_id,
           SUM(plu.quantity_used * COALESCE(plu.unit_cost_at_use, il.unit_cost, 0)) AS total
      FROM production_lot_usage plu
      JOIN plans ON plans.id = plu.production_plan_id
      JOIN ingredient_lots il ON il.id = plu.ingredient_lot_id
     GROUP BY plu.production_plan_id, plu.ingredient_id
  ),
  fallback AS (
    SELECT it.production_plan_id AS plan_id, SUM(ABS(it.quantity_change) * COALESCE(i.unit_cost, 0)) AS total
      FROM inventory_transactions it
      JOIN plans ON plans.id = it.production_plan_id
      JOIN ingredients i ON i.id = it.ingredient_id
     WHERE it.type = 'production'
       AND NOT EXISTS (SELECT 1 FROM lots l WHERE l.plan_id = it.production_plan_id AND l.ingredient_id = it.ingredient_id)
     GROUP BY it.production_plan_id
  ),
  mat AS (
    SELECT plan_id, SUM(total) AS total FROM (
      SELECT plan_id, total FROM lots UNION ALL SELECT plan_id, total FROM fallback) x
     GROUP BY plan_id
  )
  SELECT plans.id, plans.plan_date,
         COALESCE(items.units, 0), COALESCE(items.weight_kg, 0), COALESCE(steps.labour_hours, 0),
         COALESCE(NULLIF(steps.machine_hours, 0), std_machine.hours, 0), COALESCE(items.batches, 0),
         ROUND(COALESCE(mat.total, 0), 2), ROUND(COALESCE(items.sales_value, 0), 2)
    FROM plans
    LEFT JOIN items ON items.plan_id = plans.id
    LEFT JOIN steps ON steps.plan_id = plans.id
    LEFT JOIN std_machine ON std_machine.plan_id = plans.id
    LEFT JOIN mat ON mat.plan_id = plans.id
$$;
COMMENT ON FUNCTION fn_plan_cost_drivers(uuid, date, date, uuid) IS
  'Mig 655 : unités d''œuvre consommées par plan — units, weight_kg, labour_hours (étapes pointées), machine_hours (étapes sur un poste, sinon charge standard des gammes), batches (lignes), material_cost (lots consommés), sales_value (quantité × prix HT).';

-- ─── 5. Coût réel d'un plan : niveaux et méthodes ──────────────────────
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS cout_charges_appro      numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS cout_charges_production numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS cout_charges_structure  numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS cout_charges_directes   numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS detail_analytique jsonb;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS niveaux  jsonb;
ALTER TABLE production_cout_reel ADD COLUMN IF NOT EXISTS methodes jsonb;
COMMENT ON COLUMN production_cout_reel.cout_charges_fixes IS
  'Charges réparties sur le plan. Mode analytique (mig 655) : = cout_charges_appro + cout_charges_production + cout_charges_structure + cout_charges_directes.';
COMMENT ON COLUMN production_cout_reel.cout_charges_structure IS
  'Mig 655 : quote-part des centres administration et distribution — dans le coût de revient complet (cout_total), PAS dans le coût de production (cout_production).';

-- Coût de production (valorisation des stocks) = revient complet − charges de structure.
ALTER TABLE production_cout_reel DROP COLUMN IF EXISTS cout_production;
ALTER TABLE production_cout_reel ADD COLUMN cout_production numeric(12,2)
  GENERATED ALWAYS AS (cout_matieres + cout_emballages + cout_main_oeuvre + cout_energie + COALESCE(cout_charges_fixes, 0)
                       - cout_charges_structure + cout_sous_traitance + cout_machine) STORED;
COMMENT ON COLUMN production_cout_reel.cout_production IS
  'Mig 655 : coût de production = coût de revient complet (cout_total) sans les charges de structure (administration, distribution). Valorise les lots de produits finis.';

-- ─── 6. Lots de produits finis valorisés au coût de PRODUCTION ─────────
CREATE OR REPLACE FUNCTION fn_plan_item_unit_cost_v2(p_plan_item UUID, p_product UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT ROUND(cr.cout_production * s.share / NULLIF(s.quantity, 0), 4)
       FROM v_plan_item_cost_share s
       JOIN production_cout_reel cr ON cr.plan_id = s.plan_id AND cr.cout_production > 0
      WHERE s.plan_item_id = p_plan_item AND s.unified AND s.share > 0),
    fn_plan_item_unit_cost(p_plan_item, p_product))
$$;
DROP TRIGGER IF EXISTS trg_plan_cost_to_lots_v2 ON production_cout_reel;
CREATE TRIGGER trg_plan_cost_to_lots_v2
  AFTER INSERT OR UPDATE OF cout_matieres, cout_emballages, cout_main_oeuvre, cout_energie, cout_charges_fixes,
                            cout_charges_structure, cout_sous_traitance, cout_machine, detail_repartition
  ON production_cout_reel FOR EACH ROW EXECUTE FUNCTION fn_plan_cost_to_lots_v2();

-- ─── 7. Mode de calcul ─────────────────────────────────────────────────
ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS chk_company_settings_charges_method;
ALTER TABLE company_settings ADD CONSTRAINT chk_company_settings_charges_method
  CHECK (production_charges_method IN ('rate', 'monthly', 'analytic'));
UPDATE company_settings SET production_charges_method = 'analytic' WHERE production_charges_method = 'monthly';
COMMENT ON COLUMN company_settings.production_charges_method IS
  'Charges indirectes d''un plan : rate = taux × matières ; monthly = charges mensuelles au prorata des matières (mig 527, remplacé) ; analytic = moteur analytique, imputation rationnelle sur la capacité normale des centres (mig 655).';

-- ─── 8. Droit de paramétrer la comptabilité analytique (gérant) ────────
INSERT INTO role_action_permissions (role_code, permission_key)
SELECT r.code, 'production.production_cout.analytique' FROM roles r WHERE r.base_role = 'manager'
ON CONFLICT DO NOTHING;
