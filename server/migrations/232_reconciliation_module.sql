-- Migration 232 : module Rapprochement journalier (ISOLE, TEMPORAIRE)
--
-- POURQUOI
--   Outil de transition, le temps que le POS interne et la production soient
--   adoptes par tous. Suivi quotidien par produit :
--     approvisionne (envoye au magasin) - vendu (importe de Loyverse)
--     - invendu (compte en fin de journee) = ecart.
--
--   ETANCHE : aucune cle etrangere vers products / sales / stores, aucune
--   ecriture dans les tables de production. Tout est pilote par le SKU/nom
--   issu du CSV Loyverse (item-sales-summary). Le module se debranche sans
--   laisser de trace.
--
-- INVERSION (le jour ou le systeme complet est adopte) :
--   DROP TABLE recon_lines, recon_days ;
--   puis retirer le montage de route /reconciliation, les fichiers serveur
--   reconciliation.* , le dossier client features/reconciliation, l'entree de
--   nav et le module 'reconciliation'.

-- 1. En-tete d'une journee de rapprochement (par magasin)
CREATE TABLE IF NOT EXISTS recon_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE NOT NULL,
  store_id UUID,                        -- pas de FK : etancheite volontaire
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_date, store_id)
);

-- 2. Une ligne par produit et par jour
--    ecart_qty / ecart_value sont calcules par la base (colonnes generees,
--    equivalent des virtual columns Oracle) : jamais desynchronises.
CREATE TABLE IF NOT EXISTS recon_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_day_id UUID NOT NULL REFERENCES recon_days(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,            -- coalesce(nullif(sku,''), upper(name)) cote appli
  sku TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  appro_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  vendu_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  invendu_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ecart_qty NUMERIC(12,3) GENERATED ALWAYS AS (appro_qty - vendu_qty - invendu_qty) STORED,
  ecart_value NUMERIC(14,2) GENERATED ALWAYS AS ((appro_qty - vendu_qty - invendu_qty) * unit_price) STORED,
  source_vendu VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source_vendu IN ('manual', 'loyverse_import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recon_day_id, product_key)
);

CREATE INDEX IF NOT EXISTS idx_recon_lines_day ON recon_lines(recon_day_id);
CREATE INDEX IF NOT EXISTS idx_recon_days_date ON recon_days(business_date);
