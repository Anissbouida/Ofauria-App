import * as XLSX from 'xlsx';
import { db } from '../config/database.js';
import { listDefs, type CfEntity } from './custom-fields.js';

const CF_BY_TABLE: Record<string, CfEntity> = { products: 'product', ingredients: 'ingredient', suppliers: 'supplier', customers: 'customer' };

/**
 * Exports de l'administrateur (audit Paramètres, lot 7).
 *   - Configuration (JSON) : tout le paramétrage, pour l'archiver, le comparer
 *     ou préparer un nouvel établissement. Aucun secret : ni mots de passe, ni
 *     PIN, ni logo (volumineux).
 *   - Données de base (Excel) : une feuille par référentiel métier, pour que
 *     le client garde ses données hors de l'application.
 * Les tables absentes de la base (migrations non passées) sont ignorées.
 */

async function tableExists(name: string): Promise<boolean> {
  return (await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`])).rows[0].ok as boolean;
}

async function rows(sql: string, table: string): Promise<Record<string, unknown>[] | null> {
  if (!(await tableExists(table))) return null;
  return (await db.query(sql)).rows;
}

/** Paramétrage complet, sans secrets. */
export async function exportConfiguration() {
  const sections: [string, string, string][] = [
    ['societe', 'company_settings', `SELECT * FROM company_settings WHERE id = 1`],
    ['etablissements', 'stores', `SELECT * FROM stores ORDER BY name`],
    ['comptes_bancaires', 'company_bank_accounts', `SELECT * FROM company_bank_accounts ORDER BY label`],
    ['roles', 'roles', `SELECT * FROM roles ORDER BY code`],
    ['droits_des_roles', 'role_permissions', `SELECT * FROM role_permissions ORDER BY role_code, module`],
    ['droits_des_utilisateurs', 'user_permissions',
      `SELECT u.email, p.module, p.can_view, p.can_create, p.can_edit, p.can_delete, p.config
         FROM user_permissions p JOIN users u ON u.id = p.user_id ORDER BY u.email, p.module`],
    ['utilisateurs', 'users', `SELECT email, first_name, last_name, role, is_active, store_id FROM users ORDER BY email`],
    ['series_de_numeros', 'document_sequences', `SELECT * FROM document_sequences ORDER BY display_order`],
    ['modeles_de_documents', 'document_templates', `SELECT * FROM document_templates ORDER BY display_order`],
    ['regles_de_notification', 'notification_rules', `SELECT * FROM notification_rules ORDER BY type`],
    ['parametres_metier', 'module_parameters', `SELECT key, value, description FROM module_parameters ORDER BY key`],
    ['codes_tva', 'tax_codes', `SELECT * FROM tax_codes ORDER BY code, valid_from`],
    ['referentiel_tables', 'ref_tables', `SELECT * FROM ref_tables ORDER BY id`],
    ['referentiel_valeurs', 'ref_entries', `SELECT * FROM ref_entries ORDER BY table_id, display_order NULLS LAST`],
    ['canaux_de_vente', 'sales_channels', `SELECT * FROM sales_channels ORDER BY display_order`],
    ['imprimantes', 'printer_configs', `SELECT * FROM printer_configs ORDER BY name`],
    ['parametres_de_paie', 'payroll_settings', `SELECT * FROM payroll_settings`],
  ];
  const out: Record<string, unknown> = {
    format: 'kalum-configuration',
    version: 1,
    exported_at: new Date().toISOString(),
    migrations: (await rows(`SELECT name FROM _migrations ORDER BY name DESC LIMIT 1`, '_migrations'))?.[0]?.name ?? null,
  };
  for (const [key, table, sql] of sections) {
    let data: Record<string, unknown>[] | null;
    try { data = await rows(sql, table); } catch { data = null; } // colonne de tri absente sur une base ancienne
    if (data === null) continue;
    // Secrets et données lourdes exclus.
    out[key] = data.map(r => {
      const { logo_url: _logo, password_hash: _pw, pin_code: _pin, ...rest } = r as Record<string, unknown>;
      return rest;
    });
  }
  return out;
}

/** Données de base, une feuille par référentiel. */
export async function exportBaseData(): Promise<{ buffer: Buffer; counts: Record<string, number> }> {
  const sheets: [string, string, string][] = [
    ['Produits', 'products', `SELECT p.name AS "Produit", c.name AS "Catégorie", p.price AS "Prix", p.cost_price AS "Coût", p.is_available AS "Disponible", p.created_at AS "Créé le", p.custom_fields AS "__cf"
                              FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY c.name, p.name`],
    ['Ingrédients', 'ingredients', `SELECT name AS "Ingrédient", unit AS "Unité", unit_cost AS "Coût unitaire", supplier AS "Fournisseur", allergens AS "Allergènes", custom_fields AS "__cf"
                                     FROM ingredients ORDER BY name`],
    ['Fournisseurs', 'suppliers', `SELECT name AS "Nom", contact_name AS "Contact", phone AS "Téléphone", email AS "E-mail", address AS "Adresse", city AS "Ville", ice AS "ICE", is_active AS "Actif", custom_fields AS "__cf"
                                    FROM suppliers ORDER BY name`],
    ['Clients', 'customers', `SELECT first_name AS "Prénom", last_name AS "Nom", phone AS "Téléphone", email AS "E-mail", city AS "Ville", loyalty_points AS "Points", total_spent AS "Total acheté", created_at AS "Créé le", custom_fields AS "__cf"
                               FROM customers ORDER BY last_name, first_name`],
    ['Personnel', 'employees', `SELECT first_name AS "Prénom", last_name AS "Nom", role AS "Fonction", phone AS "Téléphone", hire_date AS "Embauche", is_active AS "Actif"
                                 FROM employees ORDER BY last_name, first_name`],
    ['Établissements', 'stores', `SELECT name AS "Établissement", city AS "Ville", address AS "Adresse", phone AS "Téléphone", is_active AS "Ouvert" FROM stores ORDER BY name`],
  ];
  const wb = XLSX.utils.book_new();
  const counts: Record<string, number> = {};
  for (const [name, table, sql] of sheets) {
    let data: Record<string, unknown>[] | null;
    try { data = await rows(sql, table); } catch { data = null; } // colonne absente sur une base ancienne
    if (data === null) {
      // Base sans champs personnalisés (mig 369 non passée) : même requête sans la colonne.
      try { data = await rows(sql.replace(/, (?:[a-z]\.)?custom_fields AS "__cf"/, ''), table); } catch { data = null; }
    }
    if (data === null) continue;
    // Champs personnalisés (mig 369) : une colonne par champ, libellé en en-tête.
    const cfEntity = CF_BY_TABLE[table];
    if (cfEntity && data.some(r => '__cf' in r)) {
      const defs = await listDefs(cfEntity, true);
      data = data.map(r => {
        const { __cf, ...rest } = r as Record<string, unknown> & { __cf?: Record<string, unknown> };
        for (const d of defs) rest[d.label] = __cf?.[d.code] ?? null;
        return rest;
      });
    }
    counts[name] = data.length;
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ '(vide)': '' }]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const info = XLSX.utils.aoa_to_sheet([
    ['Export des données de base — Kalum'],
    ['Date', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })],
    [],
    ...Object.entries(counts).map(([k, v]) => [k, v]),
  ]);
  XLSX.utils.book_append_sheet(wb, info, 'Sommaire');
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, counts };
}

/** État de la base pour l'écran Données : dernière migration, volumes, derniers exports. */
export async function dataStatus() {
  const counts: Record<string, number | null> = {};
  for (const t of ['products', 'ingredients', 'suppliers', 'customers', 'employees', 'sales', 'invoices', 'stores', 'users']) {
    counts[t] = (await tableExists(t)) ? Number((await db.query(`SELECT count(*) FROM ${t}`)).rows[0].count) : null;
  }
  const size = (await db.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`)).rows[0].s as string;
  const lastMigration = (await rows(`SELECT name, executed_at FROM _migrations ORDER BY name DESC LIMIT 1`, '_migrations'))?.[0] ?? null;
  const exports = (await db.query(
    `SELECT e.event_type, e.created_at, e.details, concat_ws(' ', u.first_name, u.last_name) AS by_name
       FROM auth_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.event_type IN ('config_export', 'data_export', 'data_import')
      ORDER BY e.created_at DESC LIMIT 10`)).rows;
  return { counts, size, lastMigration, exports };
}
