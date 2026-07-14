-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 242 — Enrichissement fiche client par type (Maroc)
--
-- Aujourd'hui customers.customer_type accepte 'particulier'|'professionnel'|
-- 'revendeur' mais tous les types partagent les mêmes champs. On étend :
--   - Ajout du type 'association'
--   - Identifiants légaux marocains pour B2B (ICE, IF, RC, TP, CNSS)
--   - Contact principal séparé pour les entités morales
--   - Conditions commerciales pour revendeurs (plafond crédit, remise, délai)
--   - Champs association (numéro récépissé, président)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  -- Identifiants légaux entreprises (Maroc)
  ADD COLUMN IF NOT EXISTS ice VARCHAR(15),               -- Identifiant Commun d'Entreprise (15 chiffres)
  ADD COLUMN IF NOT EXISTS if_fiscal VARCHAR(20),         -- Identifiant Fiscal
  ADD COLUMN IF NOT EXISTS rc VARCHAR(30),                -- Registre de Commerce (numéro)
  ADD COLUMN IF NOT EXISTS rc_ville VARCHAR(80),          -- Ville du tribunal de commerce
  ADD COLUMN IF NOT EXISTS tp VARCHAR(20),                -- Taxe Professionnelle (ex-patente)
  ADD COLUMN IF NOT EXISTS cnss VARCHAR(20),              -- Numéro CNSS employeur
  ADD COLUMN IF NOT EXISTS forme_juridique VARCHAR(30),   -- SARL, SA, SAS, AE (Auto-Entrepreneur), SNC, GIE...

  -- Association
  ADD COLUMN IF NOT EXISTS association_recepisse VARCHAR(50), -- N° de récépissé de déclaration
  ADD COLUMN IF NOT EXISTS president VARCHAR(200),            -- Nom du président

  -- Contact principal (pour entités morales : société/asso/revendeur)
  -- first_name/last_name du contact restent dans first_name/last_name (interlocuteur)
  ADD COLUMN IF NOT EXISTS contact_role VARCHAR(80),      -- ex "Gérant", "Trésorier", "Acheteur"

  -- Conditions commerciales (revendeur principalement)
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2),   -- Plafond de crédit en DH
  ADD COLUMN IF NOT EXISTS remise_pct NUMERIC(5, 2),      -- Remise commerciale par défaut (%)
  ADD COLUMN IF NOT EXISTS delai_paiement_jours INT,      -- Délai de paiement en jours (30, 60, 90...)
  ADD COLUMN IF NOT EXISTS tva_exonere BOOLEAN DEFAULT false; -- Exonération TVA (asso, certains cas)

-- ICE : unique quand renseigné (contrainte partielle)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_ice_unique ON customers(ice) WHERE ice IS NOT NULL;

-- Recherche par identifiants
CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers(company_name);

-- Étendre la liste des types acceptés (contrainte CHECK au lieu de rien)
-- Note : customer_type n'a pas de contrainte à ce stade, on la pose maintenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'customers' AND constraint_name = 'customers_customer_type_check'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_customer_type_check
      CHECK (customer_type IN ('particulier', 'professionnel', 'association', 'revendeur'));
  END IF;
END $$;
