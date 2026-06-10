-- Ajoute le shift administratif (admin / manager / fonctions support) : 9h-17h.
-- Complete le catalogue seed dans 151_create_shifts.sql.

INSERT INTO shifts (code, label, start_time, end_time, is_night, display_order) VALUES
  ('ADMIN_DAY', 'Administratif 9h-17h', '09:00', '17:00', false, 6)
ON CONFLICT (code) DO NOTHING;
