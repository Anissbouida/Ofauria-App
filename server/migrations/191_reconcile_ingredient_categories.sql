-- Migration 191: Reconciliation des categories d'ingredients (referentiel unique)
--
-- Contexte: l'economat lisait jusqu'ici une liste de categories codee en dur.
-- On bascule l'economat (comme le BC et les charges) sur le referentiel
-- 'ingredient_categories' (ref_entries), deja synchronise vers expense_categories
-- par la migration 148 (trigger ref_entries_sync_expense_categories).
--
-- Cette migration:
--   1. Peuple ref_entries.color/icon pour 'ingredient_categories' (UI Parametres).
--   2. Requalifie les ingredients dont la categorie n'existe plus dans le
--      referentiel (notamment 'emballages', retire par la migration 148) -> 'autre'.
--   3. Verifie que le trigger de sync 148 est present (sinon le re-cree par sync).
--
-- Idempotente: relancable sans effet de bord.

-- ─── STEP 1: Couleurs / icones pour l'UI Referentiel (seulement si vide) ─────
-- (L'economat colore ses tags via des classes CSS odoo-tag; ces couleurs hex
--  servent l'ecran Parametres > Referentiel.)

UPDATE ref_entries AS r
SET color = c.color
FROM (VALUES
  ('farines',                '#f59e0b'),
  ('sucres',                 '#ec4899'),
  ('lait',                   '#0ea5e9'),
  ('cremes',                 '#fbbf24'),
  ('beurre',                 '#eab308'),
  ('fromages',              '#ea580c'),
  ('produits_laitiers',      '#3b82f6'),
  ('oeufs',                  '#eab308'),
  ('matieres_grasses',       '#f97316'),
  ('chocolat',               '#78716c'),
  ('fruits',                 '#22c55e'),
  ('fruits_secs',            '#84cc16'),
  ('viandes',                '#dc2626'),
  ('poissons_fruits_de_mer', '#0d9488'),
  ('legumes',                '#10b981'),
  ('epices',                 '#ef4444'),
  ('sel_vinaigre',           '#64748b'),
  ('levures',                '#8b5cf6'),
  ('gelifiants',             '#06b6d4'),
  ('colorants',              '#d946ef'),
  ('decors',                 '#a855f7'),
  ('sauces',                 '#f43f5e'),
  ('conserves',              '#14b8a6'),
  ('preparations',           '#6366f1'),
  ('pates_riz',              '#ca8a04'),
  ('autre',                  '#9ca3af')
) AS c(code, color)
WHERE r.table_id = 'ingredient_categories'
  AND r.code = c.code
  AND (r.color IS NULL OR r.color = '');

-- ─── STEP 2: Requalifier les ingredients orphelins vers 'autre' ──────────────
-- Tout ingredient dont 'category' ne correspond plus a un code actif du
-- referentiel (ex: 'emballages' supprime en 148, ou code obsolete) est
-- rebascule sur 'autre' afin de rester filtrable et libelle dans l'economat.

UPDATE ingredients ing
SET category = 'autre'
WHERE COALESCE(ing.category, '') <> 'autre'
  AND NOT EXISTS (
    SELECT 1 FROM ref_entries re
    WHERE re.table_id = 'ingredient_categories'
      AND re.code = ing.category
      AND re.is_active = true
  );

-- ─── STEP 3: Re-synchroniser ref_entries -> expense_categories ──────────────
-- Garantit que la branche "Matieres premieres > Ingredients" reflete les codes
-- actifs du referentiel (cree les manquants, desactive les disparus). No-op si
-- la fonction n'existe pas (installation anterieure a la 148).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'sync_ref_to_expense_categories'
  ) THEN
    PERFORM sync_ref_to_expense_categories('ingredient_categories', '20000000-0000-0000-0000-000000000004');
    PERFORM sync_ref_to_expense_categories('packaging_categories',  '20000000-0000-0000-0000-000000000005');
  END IF;
END $$;
