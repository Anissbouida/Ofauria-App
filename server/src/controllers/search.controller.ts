import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';

/**
 * Recherche globale (barre de l'en-tête) : un seul endpoint qui interroge les
 * référentiels les plus consultés et renvoie des résultats typés et cliquables.
 * Les ingrédients ont un lien direct (/stock/:id) ; les autres mènent à leur
 * liste. Limité à quelques résultats par type pour rester instantané.
 */
export const searchController = {
  async global(req: AuthRequest, res: Response) {
    const raw = String(req.query.q ?? '').trim();
    if (raw.length < 2) { res.json({ success: true, data: [] }); return; }
    const like = `%${raw.replace(/[%_]/g, m => '\\' + m)}%`;
    const PER = 6;

    const [ingredients, products, customers, suppliers] = await Promise.all([
      db.query(
        `SELECT id, name, unit FROM ingredients WHERE name ILIKE $1 ORDER BY name LIMIT ${PER}`, [like]),
      db.query(
        `SELECT p.id, p.name, c.name AS category FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.name ILIKE $1 ORDER BY p.name LIMIT ${PER}`, [like]),
      db.query(
        `SELECT id, company_name, first_name, last_name, phone, city FROM customers
          WHERE company_name ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
          ORDER BY COALESCE(company_name, last_name, first_name) LIMIT ${PER}`, [like]),
      db.query(
        `SELECT id, name, phone FROM suppliers WHERE name ILIKE $1 ORDER BY name LIMIT ${PER}`, [like]),
    ]);

    const results: { type: string; typeLabel: string; id: string; label: string; sublabel: string | null; href: string }[] = [];

    for (const r of ingredients.rows) {
      results.push({ type: 'ingredient', typeLabel: 'Ingrédient', id: r.id, label: r.name, sublabel: r.unit || null, href: `/stock/${r.id}` });
    }
    for (const r of products.rows) {
      results.push({ type: 'product', typeLabel: 'Produit', id: r.id, label: r.name, sublabel: r.category || null, href: '/products' });
    }
    for (const r of customers.rows) {
      const name = r.company_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Client';
      const sub = [r.phone, r.city].filter(Boolean).join(' · ') || null;
      results.push({ type: 'customer', typeLabel: 'Client', id: r.id, label: name, sublabel: sub, href: '/customers' });
    }
    for (const r of suppliers.rows) {
      results.push({ type: 'supplier', typeLabel: 'Fournisseur', id: r.id, label: r.name, sublabel: r.phone || null, href: '/purchasing' });
    }

    res.json({ success: true, data: results });
  },
};
