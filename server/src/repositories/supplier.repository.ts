import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import type { CreateSupplierInput, UpdateSupplierInput } from '../validators/supplier.validator.js';

/**
 * Fournisseurs — référentiel (refonte Achats D1, lot 1 : G-D1-01/04/17/19).
 *
 * Modèle (mig 304) :
 *   suppliers                 : identité d'usage + légale (legal_name, legal_form, vat_regime,
 *                               parent_supplier_id = entité juridique porteuse des identifiants)
 *   supplier_identifiers      : un identifiant légal par type (ICE, IF, RC…) ; les types viennent
 *                               du pack pays (identifier_types). suppliers.ice n'est qu'un miroir.
 *   account_auxiliaries       : auxiliaire 4411 créé par trigger à l'insertion du fournisseur.
 *   purchasing_master_audit   : journal SGBD (trigger) ; l'auteur est lu dans updated_by /
 *                               created_by, que ce dépôt renseigne à chaque écriture.
 *
 * Analogie Oracle : bloc maître (suppliers) / détail (supplier_identifiers), les règles
 * d'unicité et de format sont dans la base (triggers), le dépôt ne fait que les traduire
 * en erreurs HTTP lisibles.
 */

type PgError = Error & { code?: string; constraint?: string; detail?: string };
type HttpError = Error & { statusCode: number; code?: string; field?: string };

function httpError(statusCode: number, message: string, code?: string, field?: string): HttpError {
  const e = new Error(message) as HttpError;
  e.statusCode = statusCode;
  if (code) e.code = code;
  if (field) e.field = field;
  return e;
}

/** Traduit les violations de contraintes de la mig 304 en 409/400 explicites. */
function translatePgError(err: unknown): never {
  const e = err as PgError;
  if (e?.code === '23505') {
    if (e.constraint === 'uq_suppliers_name_ci') throw httpError(409, 'Un fournisseur porte déjà ce nom', 'SUPPLIER_NAME_TAKEN', 'name');
    if (e.constraint === 'uq_supplier_identifier_value') throw httpError(409, e.message, 'SUPPLIER_IDENTIFIER_TAKEN', 'identifiers');
    if (e.constraint === 'uq_supplier_identifiers_type') throw httpError(400, 'Un même type d\'identifiant est fourni deux fois', 'SUPPLIER_IDENTIFIER_DUPLICATE_TYPE', 'identifiers');
  }
  if (e?.code === '23514') {
    if (e.constraint === 'chk_supplier_identifier_format') throw httpError(400, e.message, 'SUPPLIER_IDENTIFIER_FORMAT', 'identifiers');
    if (e.constraint === 'chk_suppliers_name_trim') throw httpError(400, 'Le nom doit faire au moins 2 caractères', 'SUPPLIER_NAME_INVALID', 'name');
    if (e.constraint === 'chk_suppliers_parent_not_self') throw httpError(400, 'Un fournisseur ne peut pas être sa propre entité parente', 'SUPPLIER_PARENT_SELF', 'parentSupplierId');
  }
  if (e?.code === '23503' && e.constraint === 'supplier_identifiers_type_code_fkey') {
    throw httpError(400, 'Type d\'identifiant inconnu', 'SUPPLIER_IDENTIFIER_TYPE_UNKNOWN', 'identifiers');
  }
  throw err;
}

const SUPPLIER_SELECT = `
  SELECT s.*,
         p.name AS parent_supplier_name,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'typeCode', i.type_code, 'value', i.value, 'qualifier', i.qualifier,
                    'label', t.label, 'countryCode', t.country_code,
                    'requiredForVatDeduction', t.required_for_vat_deduction)
                  ORDER BY t.display_order)
             FROM supplier_identifiers i
             JOIN identifier_types t ON t.code = i.type_code
            WHERE i.supplier_id = s.id), '[]'::jsonb) AS identifiers,
         a.code AS auxiliary_code
    FROM suppliers s
    LEFT JOIN suppliers p ON p.id = s.parent_supplier_id
    LEFT JOIN account_auxiliaries a ON a.supplier_id = s.id`;

async function replaceIdentifiers(
  client: PoolClient,
  supplierId: string,
  userId: string | null,
  identifiers: NonNullable<CreateSupplierInput['identifiers']>,
) {
  // Remplacement complet : la liste envoyée est la vérité. On supprime ce qui a
  // disparu, on upsert le reste (le trigger de la mig 304 valide format + unicité).
  const keep = identifiers.map(i => i.typeCode);
  await client.query(
    `DELETE FROM supplier_identifiers WHERE supplier_id = $1 AND NOT (type_code = ANY($2::varchar[]))`,
    [supplierId, keep],
  );
  for (const ident of identifiers) {
    await client.query(
      `INSERT INTO supplier_identifiers (supplier_id, type_code, value, qualifier, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (supplier_id, type_code) DO UPDATE
         SET value = EXCLUDED.value, qualifier = EXCLUDED.qualifier, updated_by = EXCLUDED.updated_by
       WHERE supplier_identifiers.value IS DISTINCT FROM EXCLUDED.value
          OR supplier_identifiers.qualifier IS DISTINCT FROM EXCLUDED.qualifier`,
      [supplierId, ident.typeCode, ident.value, ident.qualifier ?? null, userId],
    );
  }
}

export const supplierRepository = {
  /** Par défaut tout le référentiel (les écrans filtrent actifs/inactifs) ; `activeOnly` pour les sélecteurs. */
  async findAll(opts: { activeOnly?: boolean } = {}) {
    const where = opts.activeOnly ? 'WHERE s.is_active = true' : '';
    const result = await db.query(`${SUPPLIER_SELECT} ${where} ORDER BY s.name`);
    return result.rows;
  },

  /**
   * Écran Fournisseurs : liste paginée par situation de la relation. Chaque fournisseur
   * actif est classé dans UNE étape, la plus urgente : fiche à compléter > commande en
   * cours > à régler > à jour. Inactifs = historique. Activité limitée au magasin.
   */
  async findBoard(params: {
    storeId?: string; view: 'open' | 'history'; stage?: string; flag?: string; city?: string;
    search?: string; activeFrom?: string; activeTo?: string;
    sort: string; dir: 'asc' | 'desc'; limit: number; offset: number;
  }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond: string[] = [params.view === 'history' ? `stage = 'inactive'` : `stage <> 'inactive'`];
    if (params.stage) cond.push(`stage = ${add(params.stage)}`);
    // Critères transverses (non exclusifs, contrairement aux étapes).
    if (params.flag === 'missing_id') cond.push('missing_id');
    else if (params.flag === 'open_po') cond.push('open_po_count > 0');
    else if (params.flag === 'late_po') cond.push('late_po_count > 0');
    else if (params.flag === 'due') cond.push('amount_due > 0.005');
    else if (params.flag === 'overdue') cond.push('overdue_invoice_count > 0');
    else if (params.flag === 'never_ordered') cond.push('last_order_date IS NULL');
    else if (params.flag === 'dormant') cond.push(`(last_order_date IS NULL OR last_order_date < CURRENT_DATE - INTERVAL '90 days')`);
    if (params.city) cond.push(`city ILIKE ${add(params.city)}`);
    if (params.search) {
      const p = add(`%${params.search}%`);
      cond.push(`(name ILIKE ${p} OR COALESCE(legal_name, '') ILIKE ${p} OR COALESCE(contact_name, '') ILIKE ${p}
                 OR COALESCE(phone, '') ILIKE ${p} OR COALESCE(city, '') ILIKE ${p} OR identifiers::text ILIKE ${p})`);
    }
    // Période d'activité : au moins un BC commandé dans l'intervalle.
    if (params.activeFrom || params.activeTo) {
      const sub: string[] = ['po.supplier_id = staged.id'];
      if (params.activeFrom) sub.push(`po.order_date >= ${add(params.activeFrom)}::date`);
      if (params.activeTo) sub.push(`po.order_date <= ${add(params.activeTo)}::date`);
      cond.push(`EXISTS (SELECT 1 FROM purchase_orders po WHERE ${sub.join(' AND ')})`);
    }
    const SORTS: Record<string, string> = {
      name: 'lower(name)', city: 'lower(city)', last_order_date: 'last_order_date',
      purchased_12m: 'purchased_12m', amount_due: 'amount_due', open_po_count: 'open_po_count',
    };
    const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
    // Défaut « actifs » : le plus urgent d'abord (retards, reste dû), puis le nom.
    const orderBy = params.sort === 'urgency'
      ? 'stage_rank ASC, overdue_invoice_count DESC, late_po_count DESC, amount_due DESC, lower(name) ASC'
      : `${SORTS[params.sort] ?? 'lower(name)'} ${dir} NULLS LAST, lower(name) ASC`;
    const cte = this._stagedCte(params.storeId ? add(params.storeId) : null);
    const limit = add(params.limit);
    const offset = add(params.offset);
    const result = await db.query(
      `${cte}
       SELECT staged.*, COUNT(*) OVER() AS total_count FROM staged
       WHERE ${cond.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    const total = result.rows[0] ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count: _t, ...r }) => r), total };
  },

  /** Compteurs par étape + villes connues (filtre). */
  async boardSummary(storeId?: string) {
    const values: unknown[] = storeId ? [storeId] : [];
    const cte = this._stagedCte(storeId ? '$1' : null);
    const [stages, cities] = await Promise.all([
      db.query(
        `${cte}
         SELECT stage, COUNT(*)::int AS count,
                COALESCE(SUM(amount_due), 0) AS amount_due,
                COALESCE(SUM(open_po_amount), 0) AS open_po_amount,
                COALESCE(SUM(purchased_12m), 0) AS purchased_12m,
                COUNT(*) FILTER (WHERE overdue_invoice_count > 0 OR late_po_count > 0)::int AS late_count
         FROM staged GROUP BY stage`,
        values
      ),
      db.query(
        `SELECT initcap(trim(city)) AS city, COUNT(*)::int AS count FROM suppliers
         WHERE city IS NOT NULL AND trim(city) <> '' GROUP BY 1 ORDER BY 1`
      ),
    ]);
    return { stages: stages.rows, cities: cities.rows };
  },

  /** CTE : fiche + identifiants + activité (BC ouverts, reste dû, achats 12 mois) + étape. */
  _stagedCte(storeParam: string | null) {
    const poStore = storeParam ? `AND po.store_id = ${storeParam}` : '';
    const invStore = storeParam ? `AND inv.store_id = ${storeParam}` : '';
    return `WITH base AS (
        ${SUPPLIER_SELECT}
      ), act AS (
        SELECT base.*,
               (base.is_active AND base.vat_regime = 'assujetti' AND base.parent_supplier_id IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM supplier_identifiers i JOIN identifier_types t ON t.code = i.type_code
                   WHERE i.supplier_id = base.id AND t.required_for_vat_deduction
                 )) AS missing_id,
               po_agg.open_po_count, po_agg.open_po_amount, po_agg.late_po_count, po_agg.last_order_date, po_agg.purchased_12m,
               inv_agg.amount_due, inv_agg.overdue_invoice_count
        FROM base
        LEFT JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE po.status IN ('en_attente', 'envoye', 'livre_partiel'))::int AS open_po_count,
                 COALESCE(SUM(t.amount) FILTER (WHERE po.status IN ('en_attente', 'envoye', 'livre_partiel')), 0) AS open_po_amount,
                 COUNT(*) FILTER (WHERE po.status IN ('en_attente', 'envoye', 'livre_partiel')
                                  AND po.expected_delivery_date < CURRENT_DATE)::int AS late_po_count,
                 MAX(po.order_date) FILTER (WHERE po.status <> 'annule') AS last_order_date,
                 COALESCE(SUM(t.amount) FILTER (WHERE po.status NOT IN ('annule', 'non_livre')
                                                AND po.order_date >= CURRENT_DATE - INTERVAL '12 months'), 0) AS purchased_12m
          FROM purchase_orders po
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) AS amount
            FROM purchase_order_items WHERE purchase_order_id = po.id
          ) t ON true
          WHERE po.supplier_id = base.id ${poStore}
        ) po_agg ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(inv.total_amount - inv.paid_amount), 0) AS amount_due,
                 COUNT(*) FILTER (WHERE inv.status = 'overdue'
                                  OR (inv.due_date IS NOT NULL AND inv.due_date::date < CURRENT_DATE))::int AS overdue_invoice_count
          FROM invoices inv
          WHERE inv.supplier_id = base.id AND inv.invoice_type = 'received'
            AND inv.status NOT IN ('paid', 'cancelled') ${invStore}
        ) inv_agg ON true
      ), staged AS (
        SELECT act.*,
               CASE
                 WHEN NOT is_active THEN 'inactive'
                 WHEN missing_id THEN 'incomplete'
                 WHEN open_po_count > 0 THEN 'ordering'
                 WHEN amount_due > 0.005 THEN 'due'
                 ELSE 'ok'
               END AS stage,
               CASE
                 WHEN NOT is_active THEN 5
                 WHEN missing_id THEN 1
                 WHEN open_po_count > 0 THEN 2
                 WHEN amount_due > 0.005 THEN 3
                 ELSE 4
               END AS stage_rank
        FROM act
      )`;
  },

  async findById(id: string) {
    const result = await db.query(`${SUPPLIER_SELECT} WHERE s.id = $1`, [id]);
    return result.rows[0] || null;
  },

  /** Pré-contrôle de doublon à la frappe : nom (insensible à la casse) ou identifiant. */
  async findDuplicates(params: { name?: string; typeCode?: string; value?: string; excludeId?: string }) {
    const matches: Array<{ id: string; name: string; reason: string }> = [];
    if (params.name && params.name.trim().length >= 2) {
      const r = await db.query(
        `SELECT id, name FROM suppliers WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)`,
        [params.name.trim(), params.excludeId ?? null],
      );
      for (const row of r.rows) matches.push({ id: row.id, name: row.name, reason: 'name' });
    }
    if (params.typeCode && params.value) {
      const r = await db.query(
        `SELECT s.id, s.name, t.label
           FROM supplier_identifiers i
           JOIN suppliers s ON s.id = i.supplier_id
           JOIN identifier_types t ON t.code = i.type_code
          WHERE i.type_code = $1 AND i.value = $2 AND ($3::uuid IS NULL OR s.id <> $3)`,
        [params.typeCode, params.value.trim(), params.excludeId ?? null],
      );
      for (const row of r.rows) matches.push({ id: row.id, name: row.name, reason: row.label });
    }
    return matches;
  },

  async create(data: CreateSupplierInput, userId: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO suppliers
           (name, legal_name, legal_form, vat_regime, parent_supplier_id,
            contact_name, phone, email, address, city, notes, created_by, updated_by, currency_code)
         VALUES ($1,$2,$3,COALESCE($4,'assujetti'),$5,$6,$7,$8,$9,$10,$11,$12,$12,COALESCE($13,'MAD'))
         RETURNING id`,
        [data.name, data.legalName ?? null, data.legalForm ?? null, data.vatRegime ?? null, data.parentSupplierId ?? null,
         data.contactName ?? null, data.phone ?? null, data.email ?? null, data.address ?? null, data.city ?? null,
         data.notes ?? null, userId, data.currencyCode ?? null],
      );
      const id: string = ins.rows[0].id;
      if (data.identifiers?.length) await replaceIdentifiers(client, id, userId, data.identifiers);
      await client.query('COMMIT');
      return this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      translatePgError(err);
    } finally {
      client.release();
    }
  },

  async update(id: string, data: UpdateSupplierInput, userId: string | null) {
    const mapping: Record<string, string> = {
      name: 'name', legalName: 'legal_name', legalForm: 'legal_form', vatRegime: 'vat_regime',
      parentSupplierId: 'parent_supplier_id', contactName: 'contact_name', phone: 'phone', email: 'email',
      address: 'address', city: 'city', notes: 'notes', isActive: 'is_active', currencyCode: 'currency_code',
    };
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      const v = (data as Record<string, unknown>)[key];
      if (v !== undefined) { fields.push(`${col} = $${i++}`); values.push(v); }
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      if (fields.length) {
        fields.push(`updated_by = $${i++}`); values.push(userId);
        values.push(id);
        const r = await client.query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = $${i} RETURNING id`, values);
        if (!r.rowCount) { await client.query('ROLLBACK'); return null; }
      }
      if (data.identifiers !== undefined) await replaceIdentifiers(client, id, userId, data.identifiers);
      await client.query('COMMIT');
      return this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      translatePgError(err);
    } finally {
      client.release();
    }
  },

  /** Désactivation logique (jamais de DELETE : pièces comptables rattachées). */
  async deactivate(id: string, userId: string | null) {
    await db.query('UPDATE suppliers SET is_active = false, updated_by = $2 WHERE id = $1', [id, userId]);
  },

  /** Historique du tiers : fiche, identifiants (journal SGBD de la mig 304). */
  async history(supplierId: string, limit = 100) {
    const r = await db.query(
      `SELECT a.id, a.table_name, a.operation, a.record_id, a.changed_at, a.diff,
              a.changed_by, u.email AS changed_by_email,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) AS changed_by_name
         FROM purchasing_master_audit a
         LEFT JOIN users u ON u.id = a.changed_by
        WHERE a.supplier_id = $1
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT $2`,
      [supplierId, limit],
    );
    return r.rows;
  },

  async identifierTypes(countryCode?: string) {
    const r = await db.query(
      `SELECT code, country_code, label, description, pattern, is_unique, required_for_vat_deduction, display_order
         FROM identifier_types
        WHERE is_active AND ($1::char(2) IS NULL OR country_code = $1)
        ORDER BY country_code, display_order`,
      [countryCode ?? null],
    );
    return r.rows;
  },
};
