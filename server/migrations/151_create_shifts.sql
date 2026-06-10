-- Planning hebdomadaire par categorie : catalogue de shifts standard
-- + rattachement schedule -> shift + shift par defaut sur employe
-- + flag is_expected sur attendance (pre-remplissage depuis le planning)

CREATE TABLE IF NOT EXISTS shifts (
  code          VARCHAR(20) PRIMARY KEY,
  label         VARCHAR(80) NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  is_night      BOOLEAN DEFAULT FALSE,
  display_order INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed des 5 shifts standard de la boulangerie
-- Vendeuses : 7h-14h (7h presence) puis 14h-22h (8h presence)
-- Patisserie / Beldi-Sale : 2 equipes de 8h, l'une demarre a 7h, l'autre a 10h
-- Boulangerie + Viennoiserie : equipe de nuit pour preparer pain & viennoiseries
INSERT INTO shifts (code, label, start_time, end_time, is_night, display_order) VALUES
  ('SALES_AM',   'Vente matin 7h-14h',           '07:00', '14:00', false, 1),
  ('SALES_PM',   'Vente apres-midi 14h-22h',     '14:00', '22:00', false, 2),
  ('PROD_EARLY', 'Production matin 7h-15h',      '07:00', '15:00', false, 3),
  ('PROD_MID',   'Production mi-journee 10h-18h','10:00', '18:00', false, 4),
  ('NIGHT',      'Nuit 22h-06h',                 '22:00', '06:00', true,  5)
ON CONFLICT (code) DO NOTHING;

-- Shift par defaut sur l'employe : aide a pre-remplir une semaine vide
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS default_shift_code VARCHAR(20) REFERENCES shifts(code);

-- Rattachement schedule -> shift. start_time/end_time restent en place pour
-- supporter un eventuel override exceptionnel (fin anticipee, etc.).
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS shift_code VARCHAR(20) REFERENCES shifts(code);

-- La contrainte UNIQUE(employee_id, date) existe deja depuis la migration 009.

-- Flag attendance pre-rempli par le planning. is_expected=true => ligne creee
-- automatiquement par le planning, sera ecrasee par un pointage reel.
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS is_expected BOOLEAN DEFAULT FALSE;
