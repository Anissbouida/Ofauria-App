-- Seed employees from April 2026 payroll
-- Link to existing users where names match
-- All employees are assigned to the default store

-- Mountassir (pastry_chef) — user exists
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, user_id, store_id)
SELECT 'Mountassir', u.last_name, 'pastry_chef', 10000.00, '2026-01-01', u.id, u.store_id
FROM users u WHERE u.first_name = 'Mountassir'
ON CONFLICT DO NOTHING;

-- Tarik (viennoiserie) — user exists
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, user_id, store_id)
SELECT 'Tarik', u.last_name, 'viennoiserie', 6000.00, '2026-01-01', u.id, u.store_id
FROM users u WHERE u.first_name = 'Tarik'
ON CONFLICT DO NOTHING;

-- Jamal (baker) — user exists
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, user_id, store_id)
SELECT 'Jamal', u.last_name, 'baker', 4000.00, '2026-01-01', u.id, u.store_id
FROM users u WHERE u.first_name = 'Jamal'
ON CONFLICT DO NOTHING;

-- Ikram (manager) — user exists
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, user_id, store_id)
SELECT 'Ikram', u.last_name, 'manager', 2500.00, '2026-01-01', u.id, u.store_id
FROM users u WHERE u.first_name = 'Ikram'
ON CONFLICT DO NOTHING;

-- Khadija (cashier) — user exists
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, user_id, store_id)
SELECT 'khadija', u.last_name, 'cashier', 2400.00, '2026-01-01', u.id, u.store_id
FROM users u WHERE lower(u.first_name) = 'khadija'
ON CONFLICT DO NOTHING;

-- Hasnaa (cashier) — user exists
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, user_id, store_id)
SELECT 'Hasnaa', u.last_name, 'cashier', 3000.00, '2026-01-01', u.id, u.store_id
FROM users u WHERE u.first_name = 'Hasnaa'
ON CONFLICT DO NOTHING;

-- Habiba (saleswoman) — user exists
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, user_id, store_id)
SELECT 'Habiba', u.last_name, 'saleswoman', 4000.00, '2026-01-01', u.id, u.store_id
FROM users u WHERE u.first_name = 'Habiba'
ON CONFLICT DO NOTHING;

-- Employees without user accounts (use default store)
INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, store_id)
VALUES
  ('Leila', '', 'saleswoman', 4000.00, '2026-01-01', '00000000-0000-0000-0000-000000000001'),
  ('Siham', '', 'saleswoman', 3500.00, '2026-01-01', '00000000-0000-0000-0000-000000000001'),
  ('Omar', '', 'baker', 3000.00, '2026-01-01', '00000000-0000-0000-0000-000000000001'),
  ('Yassmine', '', 'saleswoman', 2400.00, '2026-01-01', '00000000-0000-0000-0000-000000000001'),
  ('Kaoutar', '', 'saleswoman', 2500.00, '2026-01-01', '00000000-0000-0000-0000-000000000001'),
  ('Rajae', '', 'saleswoman', 2000.00, '2026-01-01', '00000000-0000-0000-0000-000000000001'),
  ('Nezha', '', 'saleswoman', 2400.00, '2026-01-01', '00000000-0000-0000-0000-000000000001'),
  ('Mohssine', '', 'baker', 3200.00, '2026-01-01', '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;
