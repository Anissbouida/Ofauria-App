-- Migration 234 : Traductions darija éditables (nom produit → écriture arabe)
-- Module Contrôle des ventes (ISOLE, TEMPORAIRE).
-- Remplace progressivement le dictionnaire codé en dur côté client :
-- la base a priorité, le dictionnaire statique sert de repli (fallback).
-- DROP : DROP TABLE IF EXISTS recon_darija;

CREATE TABLE IF NOT EXISTS recon_darija (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nom produit normalisé : UPPER, espaces réduits, apostrophes unifiées
  product_key VARCHAR(200) NOT NULL UNIQUE,
  darija VARCHAR(300) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
