-- Migration 249 : Fiche de besoin partagée (module Contrôle des ventes, ISOLE, TEMPORAIRE)
-- Jusqu'ici la fiche de besoin vivait uniquement dans l'état local du
-- navigateur : les quantités ajustées par créneau, les produits ajoutés et les
-- produits retirés étaient perdus au rechargement et invisibles pour les
-- autres utilisateurs. Cette table persiste la fiche d'une date : une ligne
-- par produit, répartition par créneau en JSONB (clé = slot_number).
-- DROP : DROP TABLE IF EXISTS recon_fiche_lines;

CREATE TABLE IF NOT EXISTS recon_fiche_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiche_date DATE NOT NULL,
  product_key VARCHAR(200) NOT NULL,
  sku VARCHAR(100),
  product_name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Répartition par créneau : { "1": 50, "2": 38, "3": 37 }
  slot_qty JSONB NOT NULL DEFAULT '{}',
  total_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Produit retiré de la fiche du jour (masqué même si une suggestion J-7 existe)
  removed BOOLEAN NOT NULL DEFAULT false,
  saved_by UUID,
  saved_by_name VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fiche_date, product_key)
);
