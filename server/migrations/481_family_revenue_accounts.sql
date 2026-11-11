-- 481 — Comptes de produits par famille (phase 5.3).
--
-- Le générateur d'écritures créditait tout le chiffre d'affaires sur un seul compte
-- 7111 (en dur). Un expert-comptable ventile le CA par nature : pain en 7111,
-- pâtisserie en 7112, prestations en 7113… La famille de catégorie (mig 375,
-- `categories.family`) est le regroupement métier déjà utilisé en caisse ; on y
-- associe ici un compte de produit.
--
-- Résolution : ligne de vente/facture → produit → catégorie → famille → compte.
-- Une famille sans mapping (ou une ligne sans produit/catégorie/famille) retombe
-- sur 7111. Table vide par défaut → tout le CA reste sur 7111, comme avant :
-- aucune régression pour Ofauria.
--
-- Rollback : DROP TABLE family_revenue_accounts ;

CREATE TABLE IF NOT EXISTS family_revenue_accounts (
  family       VARCHAR(60) PRIMARY KEY,
  account_code VARCHAR(10) NOT NULL,
  label        VARCHAR(120),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  family_revenue_accounts IS 'Compte de produit par famille de catégorie (mig 481, phase 5.3). Vide = tout sur 7111.';
COMMENT ON COLUMN family_revenue_accounts.family       IS 'Famille de categories.family (mig 375), ex. Boulangerie, Pâtisserie.';
COMMENT ON COLUMN family_revenue_accounts.account_code IS 'Compte de produit crédité pour cette famille (classe 71), ex. 7111, 7112.';
