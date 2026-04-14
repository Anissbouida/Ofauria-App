-- Register employee roles reference table
INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order) VALUES
  ('employee_roles', 'Fonctions des employes', 'Boulanger, Patissier, Vendeuse, Caissier...', 'UserCog', 'ref_entries', true, 7)
ON CONFLICT (id) DO NOTHING;

-- Seed current roles
INSERT INTO ref_entries (table_id, code, label, color, display_order) VALUES
  ('employee_roles', 'admin',        'Administrateur',  '#7c3aed', 1),
  ('employee_roles', 'manager',      'Gerant',          '#4f46e5', 2),
  ('employee_roles', 'baker',        'Boulanger',       '#d97706', 3),
  ('employee_roles', 'pastry_chef',  'Patissier',       '#db2777', 4),
  ('employee_roles', 'viennoiserie', 'Viennoiserie',    '#ea580c', 5),
  ('employee_roles', 'beldi_sale',   'Beldi & Sale',    '#0d9488', 6),
  ('employee_roles', 'saleswoman',   'Vendeuse',        '#059669', 7),
  ('employee_roles', 'cashier',      'Caissier',        '#2563eb', 8)
ON CONFLICT (table_id, code) DO NOTHING;
