import crypto from 'crypto';
import { db } from './database.js';
import { hashPassword } from '../utils/hash.js';

/**
 * Generate a strong random password (32 chars: letters + digits + symbols).
 */
function generateStrongPassword(): string {
  const charset = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*+-=';
  const bytes = crypto.randomBytes(32);
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += charset[bytes[i] % charset.length];
  }
  return out;
}

async function seed() {
  console.log('Seeding database...');

  // ─── Create admin user (OWASP A02-3) ────────────────────────
  // Admin password is either taken from env (SEED_ADMIN_PASSWORD) for
  // reproducible seeding, or generated randomly and printed ONCE.
  // Jamais de valeur hardcodee.
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@ofauria.com';
  const envPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminPassword = envPassword || generateStrongPassword();
  const passwordSource = envPassword ? 'SEED_ADMIN_PASSWORD env var' : 'random (shown only once)';

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (existing.rows.length === 0) {
    const passwordHash = await hashPassword(adminPassword);
    await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminEmail, passwordHash, 'Aniss', 'Bouida', 'admin']
    );
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ADMIN USER CREATED — SAVE THESE CREDENTIALS NOW          ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Email    : ${adminEmail.padEnd(44)} ║`);
    console.log(`║  Password : ${adminPassword.padEnd(44)} ║`);
    console.log(`║  Source   : ${passwordSource.padEnd(44)} ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('⚠️  Ce mot de passe ne sera PLUS jamais affiche.');
    console.log('⚠️  Copiez-le dans un gestionnaire de mots de passe maintenant.');
    console.log('');
  } else {
    console.log('⏭ Admin user already exists (pas de reset, aucun mot de passe n\'est modifie)');
  }

  // Seed some sample products
  const products = [
    { name: 'Baguette tradition', categorySlug: 'pains', price: 1.30, costPrice: 0.40 },
    { name: 'Pain de campagne', categorySlug: 'pains', price: 3.50, costPrice: 1.10 },
    { name: 'Croissant au beurre', categorySlug: 'viennoiseries', price: 1.20, costPrice: 0.35 },
    { name: 'Pain au chocolat', categorySlug: 'viennoiseries', price: 1.30, costPrice: 0.40 },
    { name: 'Chausson aux pommes', categorySlug: 'viennoiseries', price: 1.50, costPrice: 0.45 },
    { name: 'Eclair au chocolat', categorySlug: 'patisseries', price: 3.80, costPrice: 1.20 },
    { name: 'Tarte aux fraises', categorySlug: 'patisseries', price: 4.50, costPrice: 1.80 },
    { name: 'Mille-feuille', categorySlug: 'patisseries', price: 4.20, costPrice: 1.50 },
    { name: 'Paris-Brest', categorySlug: 'patisseries', price: 4.80, costPrice: 1.60 },
    { name: 'Flan patissier', categorySlug: 'patisseries', price: 2.80, costPrice: 0.90 },
    { name: 'Gateau au chocolat', categorySlug: 'gateaux', price: 22.00, costPrice: 7.00 },
    { name: 'Fraisier', categorySlug: 'gateaux', price: 28.00, costPrice: 10.00 },
    { name: 'Gateau personnalise', categorySlug: 'gateaux-sur-mesure', price: 45.00, costPrice: 15.00, isCustomOrderable: true },
    { name: 'Galette des rois', categorySlug: 'specialites-saison', price: 18.00, costPrice: 6.00 },
    { name: 'Buche de Noel', categorySlug: 'specialites-saison', price: 25.00, costPrice: 8.00 },
  ];

  const existingProducts = await db.query('SELECT COUNT(*) FROM products');
  if (parseInt(existingProducts.rows[0].count) === 0) {
    for (const p of products) {
      const cat = await db.query('SELECT id FROM categories WHERE slug = $1', [p.categorySlug]);
      if (cat.rows[0]) {
        const slug = p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        await db.query(
          `INSERT INTO products (name, slug, category_id, price, cost_price, is_available, is_custom_orderable)
           VALUES ($1, $2, $3, $4, $5, true, $6)`,
          [p.name, slug, cat.rows[0].id, p.price, p.costPrice, p.isCustomOrderable || false]
        );
      }
    }
    console.log('✅ 15 sample products created');
  } else {
    console.log('⏭ Products already exist');
  }

  // Seed some sample ingredients
  const ingredients = [
    { name: 'Farine T65', unit: 'kg', unitCost: 0.80, supplier: 'Moulins de France' },
    { name: 'Beurre AOP', unit: 'kg', unitCost: 8.50, supplier: 'Laiterie du Val' },
    { name: 'Sucre', unit: 'kg', unitCost: 1.20, supplier: 'Tereos' },
    { name: 'Oeufs', unit: 'unit', unitCost: 0.25, supplier: 'Ferme des Collines' },
    { name: 'Levure boulangere', unit: 'kg', unitCost: 3.50, supplier: 'Lesaffre' },
    { name: 'Chocolat noir 70%', unit: 'kg', unitCost: 12.00, supplier: 'Valrhona' },
    { name: 'Creme fraiche', unit: 'l', unitCost: 3.80, supplier: 'Laiterie du Val' },
    { name: 'Lait entier', unit: 'l', unitCost: 1.10, supplier: 'Laiterie du Val' },
    { name: 'Sel fin', unit: 'kg', unitCost: 0.50, supplier: 'Sel de Guerande' },
    { name: 'Amandes en poudre', unit: 'kg', unitCost: 14.00, supplier: 'Bio Fruits Secs' },
  ];

  const existingIngredients = await db.query('SELECT COUNT(*) FROM ingredients');
  if (parseInt(existingIngredients.rows[0].count) === 0) {
    for (const ing of ingredients) {
      const result = await db.query(
        `INSERT INTO ingredients (name, unit, unit_cost, supplier) VALUES ($1, $2, $3, $4) RETURNING id`,
        [ing.name, ing.unit, ing.unitCost, ing.supplier]
      );
      // Create inventory entry with threshold
      await db.query(
        `INSERT INTO inventory (ingredient_id, current_quantity, minimum_threshold) VALUES ($1, $2, $3)`,
        [result.rows[0].id, Math.random() * 20 + 5, 5]
      );
    }
    console.log('✅ 10 sample ingredients + inventory created');
  } else {
    console.log('⏭ Ingredients already exist');
  }

  // Seed some sample customers
  const customers = [
    { firstName: 'Marie', lastName: 'Dupont', email: 'marie.dupont@email.com', phone: '06 12 34 56 78' },
    { firstName: 'Pierre', lastName: 'Martin', email: 'pierre.martin@email.com', phone: '06 23 45 67 89' },
    { firstName: 'Sophie', lastName: 'Bernard', email: 'sophie.bernard@email.com', phone: '06 34 56 78 90' },
  ];

  const existingCustomers = await db.query('SELECT COUNT(*) FROM customers');
  if (parseInt(existingCustomers.rows[0].count) === 0) {
    for (const c of customers) {
      await db.query(
        `INSERT INTO customers (first_name, last_name, email, phone, loyalty_points, total_spent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.firstName, c.lastName, c.email, c.phone, Math.floor(Math.random() * 200), Math.random() * 500]
      );
    }
    console.log('✅ 3 sample customers created');
  } else {
    console.log('⏭ Customers already exist');
  }

  console.log('\nSeed complete!');
  // Ne JAMAIS afficher le mot de passe ici : soit il vient de env (deja connu),
  // soit il a ete affiche une seule fois au moment de la creation ci-dessus.

  await db.pool.end();
}

seed().catch(console.error);
