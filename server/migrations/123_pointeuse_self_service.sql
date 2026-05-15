-- Migration 123 : pointeuse self-service + commissions employees
--
-- Objectif : permettre aux employes de pointer leur arrivee/depart depuis un
-- terminal kiosque sans login, en utilisant uniquement un PIN. Le PIN est
-- decouple des comptes users (employees.user_id reste optionnel) : un cuisinier
-- ou un vendeur peut pointer sans avoir d'acces logiciel.
--
-- Lien sales <-> employee : aujourd'hui sales.user_id pointe sur l'utilisateur
-- logge a la caisse, ce qui ne dit pas QUI a encaisse (le caissier de jour ou
-- de soiree). On ajoute employee_id pour attribuer chaque vente a l'employe
-- "actif" sur la caisse (dernier clock-in non clos), ce qui sert aux rapports
-- de productivite et au calcul de commission.
--
-- Commissions : table de regles versionnees (valid_from/valid_to). Un employe
-- peut avoir une regle "tous produits" et des regles plus specifiques par
-- categorie ou produit qui prennent le pas.

BEGIN;

-- ─── 1. PIN code sur employees (bcrypt hash) ───
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pin_code VARCHAR(255);

COMMENT ON COLUMN employees.pin_code IS
  'Hash bcrypt du PIN de pointage (4-6 chiffres en clair cote saisie).';

-- ─── 2. Trace methode/terminal sur attendance ───
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_method VARCHAR(10)
    CHECK (check_in_method IN ('manual', 'pin', 'badge') OR check_in_method IS NULL),
  ADD COLUMN IF NOT EXISTS check_in_terminal VARCHAR(50),
  ADD COLUMN IF NOT EXISTS check_out_method VARCHAR(10)
    CHECK (check_out_method IN ('manual', 'pin', 'badge') OR check_out_method IS NULL),
  ADD COLUMN IF NOT EXISTS check_out_terminal VARCHAR(50);

-- ─── 3. Lien sales -> employee ───
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id);

CREATE INDEX IF NOT EXISTS idx_sales_employee ON sales(employee_id);

-- ─── 4. Regles de commission ───
CREATE TABLE IF NOT EXISTS employee_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  rate_percent DECIMAL(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  applies_to VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (applies_to IN ('all', 'category', 'product')),
  applies_id UUID,
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK ((applies_to = 'all' AND applies_id IS NULL) OR (applies_to <> 'all' AND applies_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_employee_commissions_employee
  ON employee_commissions(employee_id, valid_from DESC);

COMMENT ON TABLE employee_commissions IS
  'Regles de commission versionnees. La specificite l''emporte : product > category > all.';

COMMIT;
