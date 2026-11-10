import { db } from '../config/database.js';

export const customerRepository = {
  async findAll(params: { search?: string; customerType?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.search) {
      conditions.push(`(c.first_name ILIKE $${i} OR c.last_name ILIKE $${i} OR c.email ILIKE $${i} OR c.phone ILIKE $${i} OR c.company_name ILIKE $${i} OR c.ice ILIKE $${i} OR c.city ILIKE $${i})`);
      values.push(`%${params.search}%`);
      i++;
    }
    if (params.customerType) {
      conditions.push(`c.customer_type = $${i++}`);
      values.push(params.customerType);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM customers c ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT c.*,
        COALESCE(os.orders_count, 0)::int AS orders_count,
        COALESCE(ss.sales_count, 0)::int AS sales_count,
        GREATEST(os.last_order, ss.last_sale) AS last_purchase_at,
        COALESCE(lp.points_12m, 0)::int AS points_12m
      FROM customers c
      -- Points gagnés sur 12 mois (mig 372) : base du niveau de fidélité.
      LEFT JOIN (
        SELECT customer_id, SUM(points)::int AS points_12m FROM loyalty_transactions
         WHERE created_at > now() - interval '12 months'
           AND (kind IN ('earn', 'adjust') AND points > 0 OR kind = 'reverse' AND sale_id IS NOT NULL AND points < 0)
         GROUP BY customer_id
      ) lp ON lp.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, COUNT(*)::int AS orders_count, MAX(created_at) AS last_order
        FROM orders GROUP BY customer_id
      ) os ON os.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, COUNT(*)::int AS sales_count, MAX(created_at) AS last_sale
        FROM sales GROUP BY customer_id
      ) ss ON ss.customer_id = c.id
      ${where}
      ORDER BY c.created_at DESC LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByPhone(phone: string) {
    const result = await db.query('SELECT * FROM customers WHERE phone = $1', [phone]);
    return result.rows[0] || null;
  },

  async create(data: Record<string, unknown>) {
    const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : v);
    const bool = (v: unknown) => v === true || v === 'true' || v === 'on' || v === '1';
    const result = await db.query(
      `INSERT INTO customers (
        first_name, last_name, email, phone, notes,
        customer_type, company_name, address, city, birthday,
        preferred_contact, allergies,
        ice, if_fiscal, rc, rc_ville, tp, cnss, forme_juridique,
        association_recepisse, president, contact_role,
        credit_limit, remise_pct, delai_paiement_jours, tva_exonere, billing_frequency,
        parent_customer_id, payer_customer_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22,
        $23, $24, $25, $26, $27,
        $28, $29
      ) RETURNING *`,
      [
        data.firstName || null, data.lastName || null, data.email || null, data.phone || null, data.notes || null,
        data.customerType || 'particulier', data.companyName || null, data.address || null,
        data.city || null, data.birthday || null, data.preferredContact || 'phone', data.allergies || null,
        data.ice || null, data.ifFiscal || null, data.rc || null, data.rcVille || null,
        data.tp || null, data.cnss || null, data.formeJuridique || null,
        data.associationRecepisse || null, data.president || null, data.contactRole || null,
        num(data.creditLimit), num(data.remisePct), num(data.delaiPaiementJours), bool(data.tvaExonere),
        data.billingFrequency === 'per_delivery' ? 'per_delivery' : 'monthly',
        num(data.parentCustomerId), num(data.payerCustomerId),
      ]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', notes: 'notes',
      customerType: 'customer_type', companyName: 'company_name', address: 'address',
      city: 'city', birthday: 'birthday', preferredContact: 'preferred_contact', allergies: 'allergies',
      ice: 'ice', ifFiscal: 'if_fiscal', rc: 'rc', rcVille: 'rc_ville',
      tp: 'tp', cnss: 'cnss', formeJuridique: 'forme_juridique',
      associationRecepisse: 'association_recepisse', president: 'president', contactRole: 'contact_role',
      creditLimit: 'credit_limit', remisePct: 'remise_pct', delaiPaiementJours: 'delai_paiement_jours',
      tvaExonere: 'tva_exonere', billingFrequency: 'billing_frequency',
      parentCustomerId: 'parent_customer_id', payerCustomerId: 'payer_customer_id',
    };
    const nullable = new Set([
      'firstName', 'lastName',
      'email', 'phone', 'notes', 'companyName', 'address', 'city', 'birthday', 'allergies',
      'ice', 'ifFiscal', 'rc', 'rcVille', 'tp', 'cnss', 'formeJuridique',
      'associationRecepisse', 'president', 'contactRole',
      'creditLimit', 'remisePct', 'delaiPaiementJours',
      'parentCustomerId', 'payerCustomerId',
    ]);
    const boolKeys = new Set(['tvaExonere']);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) {
        let v: unknown = data[key];
        if (key === 'billingFrequency') v = v === 'per_delivery' ? 'per_delivery' : 'monthly';
        else if (boolKeys.has(key)) v = v === true || v === 'true' || v === 'on' || v === '1';
        else if (nullable.has(key) && v === '') v = null;
        fields.push(`${col} = $${i++}`); values.push(v);
      }
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id);

    const result = await db.query(
      `UPDATE customers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  /** Partenaire payeur effectif (phase 4.2) : suit payer_customer_id en chaîne
   *  (une filiale peut pointer vers le siège) jusqu'au client qui paie, avec
   *  garde anti-cycle. Rend le client lui-même s'il n'a pas de payeur distinct. */
  async resolvePayer(client: Pick<import('pg').PoolClient, 'query'>, customerId: string): Promise<string> {
    let current = customerId;
    const seen = new Set<string>([current]);
    for (let hop = 0; hop < 10; hop++) {
      const next = (await client.query(`SELECT payer_customer_id FROM customers WHERE id = $1`, [current])).rows[0]?.payer_customer_id as string | null | undefined;
      if (!next || seen.has(next)) break; // pas de payeur distinct, ou cycle détecté
      seen.add(next);
      current = next;
    }
    return current;
  },

  /** Patterns de format des identifiants légaux du pays (pack pays,
   *  identifier_types). Aligne la fiche client sur le référentiel fournisseurs :
   *  { MA_ICE: '^[0-9]{15}$', MA_IF: '^[0-9]{1,8}$', ... }. */
  async identifierPatterns(country = 'MA'): Promise<Record<string, string>> {
    const r = await db.query(
      `SELECT code, pattern FROM identifier_types WHERE country_code = $1 AND pattern IS NOT NULL AND is_active`,
      [country]
    );
    const out: Record<string, string> = {};
    for (const row of r.rows) out[row.code as string] = row.pattern as string;
    return out;
  },

  /** Doublons probables (phase 4.3) : même ICE (exact) ou même nom/raison
   *  sociale. Miroir de supplierRepository.findDuplicates — on SIGNALE au lieu
   *  de laisser l'index unique produire une erreur brute. */
  async findDuplicates(params: { name?: string; ice?: string; excludeId?: string }) {
    const matches: Array<{ id: string; name: string; reason: string }> = [];
    const label = (row: Record<string, unknown>) =>
      (row.company_name as string) || `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '(client)';
    if (params.ice && params.ice.trim()) {
      const r = await db.query(
        `SELECT id, company_name, first_name, last_name FROM customers
          WHERE ice = $1 AND ($2::uuid IS NULL OR id <> $2)`,
        [params.ice.trim(), params.excludeId ?? null]
      );
      for (const row of r.rows) matches.push({ id: row.id as string, name: label(row), reason: 'ICE' });
    }
    if (params.name && params.name.trim().length >= 2) {
      const r = await db.query(
        `SELECT id, company_name, first_name, last_name FROM customers
          WHERE (lower(company_name) = lower($1) OR lower(trim(first_name || ' ' || last_name)) = lower($1))
            AND ($2::uuid IS NULL OR id <> $2)`,
        [params.name.trim(), params.excludeId ?? null]
      );
      for (const row of r.rows) if (!matches.some(m => m.id === row.id)) matches.push({ id: row.id as string, name: label(row), reason: 'nom' });
    }
    return matches;
  },

  async stats(id: string) {
    const [ordersRes, salesRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS count,
          COALESCE(SUM(total), 0) AS total_amount,
          MAX(created_at) AS last_date
        FROM orders WHERE customer_id = $1`, [id]),
      db.query(
        `SELECT COUNT(*)::int AS count,
          COALESCE(SUM(total), 0) AS total_amount,
          MAX(created_at) AS last_date
        FROM sales WHERE customer_id = $1`, [id]),
    ]);

    const orderHistory = await db.query(
      `SELECT id, order_number, total, status, payment_method, created_at
      FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]);

    const salesHistory = await db.query(
      `SELECT s.id, s.sale_number, s.total, s.payment_method, s.created_at,
        json_agg(json_build_object('name', p.name, 'quantity', si.quantity, 'unit_price', si.unit_price)) AS items
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.customer_id = $1
      GROUP BY s.id
      ORDER BY s.created_at DESC LIMIT 20`, [id]);

    return {
      orders: { ...ordersRes.rows[0], history: orderHistory.rows },
      sales: { ...salesRes.rows[0], history: salesHistory.rows },
    };
  },

  async globalStats() {
    const result = await db.query(
      `SELECT
        COUNT(*)::int AS total_clients,
        COALESCE(SUM(loyalty_points), 0)::int AS total_loyalty_points,
        COALESCE(SUM(total_spent), 0) AS total_ca_clients
      FROM customers`
    );
    const bestClient = await db.query(
      `SELECT id, first_name, last_name, total_spent, loyalty_points
      FROM customers ORDER BY total_spent DESC LIMIT 1`
    );
    return { ...result.rows[0], best_client: bestClient.rows[0] || null };
  },

  async delete(id: string) {
    await db.query('DELETE FROM customers WHERE id = $1', [id]);
  },
};
