-- Périodicité de la déclaration de TVA : mensuelle par défaut (comportement d'avant).
INSERT INTO module_parameters (key, value, description) VALUES
  ('accounting.vat_periodicity', '{"mode": "monthly"}', 'Périodicité de la déclaration de TVA : mensuelle ou trimestrielle (écran Comptabilité › TVA).')
ON CONFLICT (key) DO NOTHING;
