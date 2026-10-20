// Comptes de test LOCAUX (gerant + admin) pour verifier les ecrans en navigateur.
// Ne jamais lancer contre la production : le script refuse une base non locale.
// Le gerant est rattache a une fiche employe de test (onglet « Mon espace »).
//
// Usage (depuis server/) :
//   npx tsx scripts/seed-test-accounts.ts          -> cree / reinitialise les comptes
//   npx tsx scripts/seed-test-accounts.ts clean    -> supprime comptes et fiche de test
//
// Identifiants (base locale uniquement) :
//   gerant.test@kalum.local / KalumTest-2026!
//   admin.test@kalum.local  / KalumTest-2026!
import { db } from '../src/config/database.js';
import { hashPassword } from '../src/utils/hash.js';

const PASSWORD = 'KalumTest-2026!';
const ACCOUNTS = [
  { email: 'gerant.test@kalum.local', role: 'manager', firstName: 'Gérant', lastName: 'Test' },
  { email: 'admin.test@kalum.local', role: 'admin', firstName: 'Admin', lastName: 'Test' },
];
const EMPLOYEE_MARKER = '[COMPTE TEST]';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error('Base non locale : seed des comptes de test refuse.');
  }

  if (process.argv[2] === 'clean') {
    const emails = ACCOUNTS.map(a => a.email);
    await db.query(`DELETE FROM employees WHERE notes = $1`, [EMPLOYEE_MARKER]);
    const r = await db.query(`DELETE FROM users WHERE email = ANY($1) RETURNING email`, [emails]);
    console.log('supprimes:', r.rows.map(x => x.email).join(', ') || 'aucun');
    process.exit(0);
  }

  const store = (await db.query(
    `SELECT store_id FROM users WHERE role = 'manager' AND store_id IS NOT NULL LIMIT 1`
  )).rows[0]?.store_id ?? null;
  const hash = await hashPassword(PASSWORD);

  for (const a of ACCOUNTS) {
    const r = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, store_id)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
         is_active = true, failed_login_count = 0, locked_until = NULL
       RETURNING id`,
      [a.email, hash, a.firstName, a.lastName, a.role, store]
    );
    const userId = r.rows[0].id as string;
    if (a.role === 'manager') {
      const exists = await db.query(`SELECT 1 FROM employees WHERE user_id = $1`, [userId]);
      if (!exists.rowCount) {
        await db.query(
          `INSERT INTO employees (first_name, last_name, role, monthly_salary, hire_date, contract_type,
             pay_frequency, is_declared, is_active, user_id, store_id, notes)
           VALUES ($1, $2, 'manager', 6000, CURRENT_DATE - INTERVAL '2 years', 'cdi',
             'monthly', true, true, $3, $4, $5)`,
          [a.firstName, a.lastName, userId, store, EMPLOYEE_MARKER]
        );
      }
    }
    console.log(`${a.role.padEnd(8)} ${a.email}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
