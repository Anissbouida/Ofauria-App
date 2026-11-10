-- Migration 470 : conversions pour le référentiel des unités de mesure
--
-- Phase 3.3 (ERP multi-secteur) — socle « unités en référentiel + conversions ».
-- Le référentiel `units` (ref_entries, mig 058) ne portait que code + libellé.
-- On y ajoute, dans la colonne metadata (JSONB) déjà existante, de quoi
-- CONVERTIR une quantité d'une unité à une autre sans règle codée en dur :
--   - category : famille de mesure (mass / volume / count)
--   - to_base  : facteur pour exprimer 1 unité dans l'unité de base de la famille
--   - is_base  : vrai pour l'unité de base de la famille (facteur 1)
--
-- Unités de base par famille : masse → g, volume → ml, décompte → unit.
-- Conversion A→B (même famille) : valeur_B = valeur_A × (to_base_A / to_base_B).
-- (Les passages masse↔volume relèvent de la densité par ingrédient, hors sujet.)
--
-- Données seules, idempotent : on FUSIONNE (||) sans écraser une metadata
-- éventuelle, et on cible chaque unité par son code. Aucune modif de schéma.

UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('category', 'mass',   'to_base', 1000, 'is_base', false)
  WHERE table_id = 'units' AND code = 'kg';
UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('category', 'mass',   'to_base', 1,    'is_base', true)
  WHERE table_id = 'units' AND code = 'g';
UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('category', 'volume', 'to_base', 1000, 'is_base', false)
  WHERE table_id = 'units' AND code = 'l';
UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('category', 'volume', 'to_base', 1,    'is_base', true)
  WHERE table_id = 'units' AND code = 'ml';
UPDATE ref_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('category', 'count',  'to_base', 1,    'is_base', true)
  WHERE table_id = 'units' AND code = 'unit';
