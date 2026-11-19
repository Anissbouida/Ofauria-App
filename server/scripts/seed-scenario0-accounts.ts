// Scénario 0 (docs/scenarios/SCENARIO_0_PREMIERE_CONFIGURATION.md), étape 14 :
// un compte utilisateur LOCAL par employé fictif, avec son rôle, relié à sa fiche.
// Ne jamais lancer contre la production : le script refuse une base non locale.
//
// Prérequis : les rôles du scénario (econome, chef_beldi, chef_sale, resp_achats,
// commercial) et les 12 fiches employés fictives existent déjà.
//
// Usage (depuis server/) :
//   npx tsx scripts/seed-scenario0-accounts.ts
//
// Le script n'efface rien et ne touche pas un compte qui existe déjà (ni son mot de
// passe, ni ses rôles). Mêmes fonctions que l'écran Utilisateurs : création du compte,
// attribution des rôles, lien avec la fiche employé.
//
// Identifiants (base locale uniquement) : <prenom>.<nom>@kalum.local, même mot de passe
// de test que scripts/seed-test-accounts.ts (constante PASSWORD ci-dessous).
// Les deux caissiers ont en plus un code PIN de caisse (champ `pin` ci-dessous).
import { db } from '../src/config/database.js';
import { hashPassword, hashPin } from '../src/utils/hash.js';
import { NEW_PIN_RE } from '../src/validators/auth.validator.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { roleRepository } from '../src/repositories/role.repository.js';

const PASSWORD = 'KalumTest-2026!';

/** Une personne peut porter plusieurs rôles : le premier est le rôle principal. */
const ACCOUNTS: { firstName: string; lastName: string; email: string; roles: string[]; pin?: string }[] = [
  { firstName: 'Karim', lastName: 'Bennani', email: 'karim.bennani@kalum.local', roles: ['manager'] },
  { firstName: 'Salma', lastName: 'El Idrissi', email: 'salma.el-idrissi@kalum.local', roles: ['commercial'] },
  { firstName: 'Youssef', lastName: 'Tazi', email: 'youssef.tazi@kalum.local', roles: ['resp_achats'] },
  { firstName: 'Hassan', lastName: 'Ouazzani', email: 'hassan.ouazzani@kalum.local', roles: ['econome'] },
  { firstName: 'Nadia', lastName: 'Berrada', email: 'nadia.berrada@kalum.local', roles: ['pastry_chef'] },
  { firstName: 'Mehdi', lastName: 'Alaoui', email: 'mehdi.alaoui@kalum.local', roles: ['viennoiserie'] },
  { firstName: 'Fatima Zahra', lastName: 'Chraibi', email: 'fatima-zahra.chraibi@kalum.local', roles: ['chef_beldi'] },
  { firstName: 'Omar', lastName: 'Kettani', email: 'omar.kettani@kalum.local', roles: ['chef_sale'] },
  { firstName: 'Rachid', lastName: 'Amrani', email: 'rachid.amrani@kalum.local', roles: ['baker'] },
  { firstName: 'Abdelilah', lastName: 'Saidi', email: 'abdelilah.saidi@kalum.local', roles: ['baker'] },
  // Caissiers : un code PIN de caisse chacun (6 à 10 chiffres), pour la connexion par tuile.
  { firstName: 'Imane', lastName: 'Fassi', email: 'imane.fassi@kalum.local', roles: ['cashier'], pin: '260111' },
  { firstName: 'Hamza', lastName: 'Belkadi', email: 'hamza.belkadi@kalum.local', roles: ['cashier'], pin: '260222' },
];

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error('Base non locale : création des comptes du scénario refusée.');
  }
  const admin = (await db.query(
    `SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1`)).rows[0]?.id as string | undefined;
  if (!admin) throw new Error('Aucun administrateur actif.');
  const hash = await hashPassword(PASSWORD);

  for (const a of ACCOUNTS) {
    const employee = (await db.query(
      `SELECT id, store_id, user_id FROM employees WHERE first_name = $1 AND last_name = $2 AND is_active`,
      [a.firstName, a.lastName])).rows[0];
    if (!employee) { console.log(`! ${a.email} : fiche employé absente, compte non créé`); continue; }
    let user = await userRepository.findByEmail(a.email);
    if (user) {
      console.log(`= ${a.email} existe déjà`);
    } else {
      for (const code of a.roles) {
        if (!(await roleRepository.isAssignable(code))) throw new Error(`Rôle inconnu ou désactivé : ${code}`);
      }
      user = await userRepository.create(
        { email: a.email, passwordHash: hash, firstName: a.firstName, lastName: a.lastName, role: a.roles[0], storeId: employee.store_id },
        admin);
      await userRepository.setRoleCodes(user.id, a.roles, a.roles[0], admin);
      await userRepository.setLinkedEmployee(user.id, employee.id, admin);
      console.log(`+ ${a.email} (${a.roles.join(' + ')})`);
    }
    // Code PIN de caisse : posé seulement si le compte n'en a pas (jamais remplacé).
    if (a.pin && !user.pin_code) {
      if (!NEW_PIN_RE.test(a.pin)) throw new Error(`Code PIN invalide pour ${a.email} : 6 à 10 chiffres.`);
      await userRepository.update(user.id, { pinCode: await hashPin(a.pin), pinLength: a.pin.length }, admin);
      console.log(`  code PIN défini pour ${a.email}`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
