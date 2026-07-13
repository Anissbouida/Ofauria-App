-- Migration 233 : Créneaux d'approvisionnement paramétrables par section
-- Module Rapprochement journalier (ISOLE, TEMPORAIRE).
-- DROP : DROP TABLE IF EXISTS recon_supply_slots;

CREATE TABLE IF NOT EXISTS recon_supply_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(100) NOT NULL,
  slot_number SMALLINT NOT NULL,
  label VARCHAR(50) NOT NULL,
  target_time TIME,
  default_pct SMALLINT NOT NULL DEFAULT 0 CHECK (default_pct BETWEEN 0 AND 100),
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, slot_number)
);

-- Seed : config par defaut (ajustable par l'admin)
INSERT INTO recon_supply_slots (category, slot_number, label, target_time, default_pct, sort_order) VALUES
  ('VIENNOISERIES',       1, 'Matin 7h',       '07:00', 50, 1),
  ('VIENNOISERIES',       2, 'Milieu 10h30',    '10:30', 30, 2),
  ('VIENNOISERIES',       3, 'Après-midi 14h',  '14:00', 20, 3),
  ('SALÉ',                1, 'Matin 7h',        '07:00', 50, 1),
  ('SALÉ',                2, 'Midi 12h',         '12:00', 30, 2),
  ('SALÉ',                3, 'Après-midi 15h',   '15:00', 20, 3),
  ('PÂTISSERIE CLASSIQUE',1, 'Matin 8h',        '08:00', 60, 1),
  ('PÂTISSERIE CLASSIQUE',2, 'Après-midi 14h',  '14:00', 40, 2),
  ('PÂTISSERIE PREMIUM',  1, 'Matin 8h',        '08:00', 60, 1),
  ('PÂTISSERIE PREMIUM',  2, 'Après-midi 14h',  '14:00', 40, 2),
  ('PIÈCES & PORTIONS',   1, 'Matin 8h',        '08:00', 60, 1),
  ('PIÈCES & PORTIONS',   2, 'Après-midi 14h',  '14:00', 40, 2),
  ('CAKE ET MUFFINS',     1, 'Matin 8h',        '08:00', 60, 1),
  ('CAKE ET MUFFINS',     2, 'Après-midi 14h',  '14:00', 40, 2),
  ('BAGUETTE',            1, 'Matin 6h30',      '06:30', 40, 1),
  ('BAGUETTE',            2, 'Midi 11h',         '11:00', 30, 2),
  ('BAGUETTE',            3, 'Après-midi 15h',   '15:00', 20, 3),
  ('BAGUETTE',            4, 'Soir 17h',         '17:00', 10, 4),
  ('BAGUETTE TRADITION',  1, 'Matin 6h30',      '06:30', 40, 1),
  ('BAGUETTE TRADITION',  2, 'Midi 11h',         '11:00', 30, 2),
  ('BAGUETTE TRADITION',  3, 'Après-midi 15h',   '15:00', 20, 3),
  ('BAGUETTE TRADITION',  4, 'Soir 17h',         '17:00', 10, 4),
  ('PAIN ROND',           1, 'Matin 6h30',      '06:30', 50, 1),
  ('PAIN ROND',           2, 'Midi 11h',         '11:00', 30, 2),
  ('PAIN ROND',           3, 'Après-midi 15h',   '15:00', 20, 3)
ON CONFLICT DO NOTHING;
