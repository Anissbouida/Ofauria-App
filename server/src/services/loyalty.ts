import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';
import { persistEntry, postingAccount } from './journal-generator.service.js';

/**
 * Fidélité (mig 372). Les points sont des mouvements (loyalty_transactions) ; le solde de
 * la fiche client suit par trigger. Les mouvements positifs gardent leurs points encore
 * disponibles (remaining) : on consomme les plus anciens d'abord et ils expirent à leur date.
 *
 * Comptabilité (OD, source 'loyalty') : la valeur des points en circulation est une dette
 * envers les clients (4491).
 *   gain                   D 7129 / C 4491
 *   utilisation, expiration, annulation d'un gain   D 4491 / C 7129
 *   points rendus (vente annulée)                   D 7129 / C 4491
 * L'utilisation est une remise sur le ticket : l'écriture de vente porte déjà D 7129.
 */
type Runner = PoolClient | typeof db;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type LoyaltySettings = {
  enabled: boolean; earn_points: number; earn_per_amount: string; point_value: string;
  min_redeem_points: number; max_redeem_pct: string; expiry_months: number;
};
export type Tier = { code: string; label: string; min_points: number; earn_multiplier: string; color: string | null; is_active: boolean };

export async function getSettings(runner: Runner = db): Promise<LoyaltySettings> {
  const r = await runner.query(`SELECT * FROM loyalty_settings WHERE id`);
  return r.rows[0];
}

export async function listTiers(runner: Runner = db, includeInactive = false): Promise<Tier[]> {
  const r = await runner.query(`SELECT * FROM loyalty_tiers WHERE $1::boolean OR is_active ORDER BY min_points`, [includeInactive]);
  return r.rows;
}

/** Points gagnés sur 12 mois glissants (gains + reprises − annulations) : base du niveau. */
async function points12m(runner: Runner, customerId: string): Promise<number> {
  const r = await runner.query(
    `SELECT COALESCE(SUM(points), 0)::int AS n FROM loyalty_transactions
      WHERE customer_id = $1 AND created_at > now() - interval '12 months'
        AND (kind IN ('earn', 'adjust') AND points > 0 OR kind = 'reverse' AND sale_id IS NOT NULL AND points < 0)`, [customerId]);
  return Math.max(0, r.rows[0].n);
}

export async function tierFor(customerId: string, runner: Runner = db) {
  const [tiers, pts] = await Promise.all([listTiers(runner), points12m(runner, customerId)]);
  const reached = tiers.filter(t => pts >= t.min_points);
  const tier = reached[reached.length - 1] ?? null;
  const next = tiers.find(t => t.min_points > pts) ?? null;
  return { tier, next, points12m: pts };
}

/** Écriture comptable d'un mouvement (sans effet si l'autogénération est coupée). */
async function post(client: PoolClient, tx: { id: string; amount: number; up: boolean; storeId: string | null; label: string }, userId: string | null) {
  if (!FLAGS.LEDGER_AUTOGEN || tx.amount <= 0) return;
  const liability = await postingAccount(client, 'loyalty_liability');
  const cost = await postingAccount(client, 'loyalty_cost');
  // up : la dette augmente (gain, points rendus, ajout) ; sinon elle diminue.
  const [debit, credit] = tx.up ? [cost, liability] : [liability, cost];
  await client.query('SAVEPOINT loyalty_post');
  try {
    await persistEntry(client, {
      journal_code: 'OD', entry_date: new Date().toISOString().slice(0, 10), description: `Fidélité · ${tx.label}`,
      source_kind: 'loyalty', source_id: tx.id, store_id: tx.storeId,
      lines: [
        { account_code: debit, debit: tx.amount, credit: 0, label: tx.label },
        { account_code: credit, debit: 0, credit: tx.amount, label: tx.label },
      ],
    }, { userId });
    await client.query('RELEASE SAVEPOINT loyalty_post');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT loyalty_post');
    // eslint-disable-next-line no-console
    console.error('[ledger] fidélité : écriture non générée', tx.id, e instanceof Error ? e.message : e);
  }
}

/** Retire des points des lots disponibles, les plus anciens d'abord ; renvoie le nombre retiré. */
async function consume(client: PoolClient, customerId: string, points: number, preferTxId?: string): Promise<number> {
  const open = await client.query(
    `SELECT id, remaining FROM loyalty_transactions WHERE customer_id = $1 AND remaining > 0
      ORDER BY (id = $2::uuid) DESC, expires_at NULLS LAST, created_at FOR UPDATE`, [customerId, preferTxId ?? null]);
  let left = points;
  for (const b of open.rows) {
    if (left <= 0) break;
    const take = Math.min(left, b.remaining);
    await client.query(`UPDATE loyalty_transactions SET remaining = remaining - $2 WHERE id = $1`, [b.id, take]);
    left -= take;
  }
  return points - left;
}

async function insertTx(client: PoolClient, t: {
  customerId: string; kind: string; points: number; amount: number; remaining?: number | null; expiresAt?: string | null;
  saleId?: string | null; note: string; userId: string | null;
}) {
  const r = await client.query(
    `INSERT INTO loyalty_transactions (customer_id, kind, points, amount, remaining, expires_at, sale_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [t.customerId, t.kind, t.points, round2(t.amount), t.remaining ?? null, t.expiresAt ?? null, t.saleId ?? null, t.note.slice(0, 255), t.userId]);
  return r.rows[0];
}

async function expiryDate(client: PoolClient, s: LoyaltySettings): Promise<string | null> {
  if (!s.expiry_months) return null;
  const r = await client.query(`SELECT (now() + make_interval(months => $1::int))::text AS d`, [s.expiry_months]);
  return r.rows[0].d;
}

/** Points que rapporte un montant payé, pour un client donné (niveau compris). */
export async function pointsFor(amount: number, customerId: string, runner: Runner = db) {
  const s = await getSettings(runner);
  if (!s.enabled || amount <= 0) return 0;
  const { tier } = await tierFor(customerId, runner);
  const mult = tier ? Number(tier.earn_multiplier) : 1;
  return Math.floor(Math.floor(amount / Number(s.earn_per_amount)) * s.earn_points * mult);
}

/**
 * Gain sur une vente encaissée (une seule fois par vente). Base = montant payé
 * (après remises et points utilisés).
 */
export async function earnForSale(client: PoolClient, sale: Record<string, any>, userId: string | null) {
  if (!sale.customer_id || sale.payment_status !== 'paid') return null;
  const total = Number(sale.total) || 0;
  // Déjà crédité (et pas annulé depuis, cf. modification d'une vente spéciale) : rien à faire.
  const dup = await client.query(
    `SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'earn' OR kind = 'reverse' AND points < 0), 0)::int AS net
       FROM loyalty_transactions WHERE sale_id = $1`, [sale.id]);
  if (dup.rows[0].net > 0) return null;
  const s = await getSettings(client);
  const points = await pointsFor(total, sale.customer_id, client);
  if (points <= 0) return null;
  const amount = round2(points * Number(s.point_value));
  const tx = await insertTx(client, {
    customerId: sale.customer_id, kind: 'earn', points, amount, remaining: points, expiresAt: await expiryDate(client, s),
    saleId: sale.id, note: `Vente ${sale.sale_number}`, userId,
  });
  await post(client, { id: tx.id, amount, up: true, storeId: sale.store_id ?? null, label: `Points gagnés · vente ${sale.sale_number}` }, userId);
  return tx;
}

/** Contrôle d'une utilisation de points sur un ticket ; renvoie la valeur en DH. */
export async function checkRedeem(runner: Runner, customerId: string, points: number, ticketAmount: number) {
  const s = await getSettings(runner);
  if (!s.enabled) return { error: 'Le programme de fidélité est désactivé' } as const;
  if (!Number.isInteger(points) || points <= 0) return { error: 'Nombre de points invalide' } as const;
  if (points < s.min_redeem_points) return { error: `Minimum ${s.min_redeem_points} points par utilisation` } as const;
  const bal = await runner.query(`SELECT COALESCE(loyalty_points, 0)::int AS n FROM customers WHERE id = $1`, [customerId]);
  if (!bal.rows[0]) return { error: 'Client introuvable' } as const;
  if (points > bal.rows[0].n) return { error: `Solde insuffisant : ${bal.rows[0].n} points` } as const;
  const amount = round2(points * Number(s.point_value));
  const cap = round2(ticketAmount * Number(s.max_redeem_pct) / 100);
  if (amount > cap + 0.001) return { error: `Les points couvrent au plus ${Number(s.max_redeem_pct)} % du ticket (${cap.toFixed(2)} DH)` } as const;
  return { amount };
}

/** Utilisation de points sur une vente (déjà contrôlée par checkRedeem). */
export async function redeemForSale(client: PoolClient, p: { customerId: string; points: number; amount: number; saleId: string; saleNumber: string; storeId: string | null; userId: string }) {
  const taken = await consume(client, p.customerId, p.points);
  if (taken < p.points) throw Object.assign(new Error('Solde de points insuffisant'), { statusCode: 409 });
  const tx = await insertTx(client, { customerId: p.customerId, kind: 'redeem', points: -p.points, amount: p.amount, saleId: p.saleId, note: `Vente ${p.saleNumber}`, userId: p.userId });
  await post(client, { id: tx.id, amount: p.amount, up: false, storeId: p.storeId, label: `Points utilisés · vente ${p.saleNumber}` }, p.userId);
  return tx;
}

/**
 * Annule l'effet fidélité d'une vente : retire `ratio` des points gagnés (retour partiel :
 * part remboursée) ; à ratio = 1 (vente supprimée), rend aussi les points utilisés.
 */
export async function reverseForSale(client: PoolClient, saleId: string, ratio: number, userId: string | null, label: string) {
  const s = await getSettings(client);
  const sale = (await client.query(`SELECT id, sale_number, customer_id, store_id FROM sales WHERE id = $1`, [saleId])).rows[0];
  if (!sale?.customer_id) return;
  const sums = await client.query(
    `SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'earn'), 0)::int AS earned,
            COALESCE(SUM(points) FILTER (WHERE kind = 'reverse' AND points < 0), 0)::int AS already,
            COALESCE(-SUM(points) FILTER (WHERE kind = 'redeem'), 0)::int AS redeemed,
            COALESCE(SUM(points) FILTER (WHERE kind = 'reverse' AND points > 0), 0)::int AS returned,
            (array_agg(id) FILTER (WHERE kind = 'earn'))[1] AS earn_id
       FROM loyalty_transactions WHERE sale_id = $1`, [saleId]);
  const t = sums.rows[0];
  const r = Math.min(1, Math.max(0, ratio));
  const toRemove = Math.min(Math.floor(t.earned * r), t.earned + t.already);
  if (toRemove > 0) {
    const removed = await consume(client, sale.customer_id, toRemove, t.earn_id);
    if (removed > 0) {
      const amount = round2(removed * Number(s.point_value));
      const tx = await insertTx(client, { customerId: sale.customer_id, kind: 'reverse', points: -removed, amount, saleId, note: `${label} · vente ${sale.sale_number}`, userId });
      await post(client, { id: tx.id, amount, up: false, storeId: sale.store_id, label: `Points retirés · ${label} ${sale.sale_number}` }, userId);
    }
  }
  const toGiveBack = r >= 1 ? t.redeemed - t.returned : 0;
  if (toGiveBack > 0) {
    const amount = round2(toGiveBack * Number(s.point_value));
    const tx = await insertTx(client, {
      customerId: sale.customer_id, kind: 'reverse', points: toGiveBack, amount, remaining: toGiveBack, expiresAt: await expiryDate(client, s),
      saleId, note: `Points rendus · ${label} · vente ${sale.sale_number}`, userId,
    });
    await post(client, { id: tx.id, amount, up: true, storeId: sale.store_id, label: `Points rendus · ${label} ${sale.sale_number}` }, userId);
  }
}

/** Ajustement manuel (geste commercial, correction) ; un retrait ne descend pas sous zéro. */
export async function adjust(customerId: string, points: number, note: string, userId: string) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const s = await getSettings(client);
    let applied = points;
    if (points < 0) applied = -(await consume(client, customerId, -points));
    if (applied === 0) { await client.query('ROLLBACK'); return { error: 'Le client n\'a pas de points à retirer' } as const; }
    const amount = round2(Math.abs(applied) * Number(s.point_value));
    const tx = await insertTx(client, {
      customerId, kind: 'adjust', points: applied, amount, remaining: applied > 0 ? applied : null,
      expiresAt: applied > 0 ? await expiryDate(client, s) : null, note, userId,
    });
    // Un ajout crée une dette comme un gain ; un retrait la solde comme une expiration.
    await post(client, { id: tx.id, amount, up: applied > 0, storeId: null, label: `Ajustement · ${note}` }, userId);
    await client.query('COMMIT');
    return { data: tx };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/** Tâche planifiée : expire les points arrivés à échéance. */
export async function expireDue() {
  const client = await db.getClient();
  let n = 0; let pts = 0;
  try {
    await client.query('BEGIN');
    const s = await getSettings(client);
    const due = await client.query(
      `SELECT id, customer_id, remaining FROM loyalty_transactions WHERE remaining > 0 AND expires_at <= now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 2000`);
    for (const b of due.rows) {
      await client.query(`UPDATE loyalty_transactions SET remaining = 0 WHERE id = $1`, [b.id]);
      const amount = round2(b.remaining * Number(s.point_value));
      const tx = await insertTx(client, { customerId: b.customer_id, kind: 'expire', points: -b.remaining, amount, note: 'Points expirés', userId: null });
      await post(client, { id: tx.id, amount, up: false, storeId: null, label: 'Points expirés' }, null);
      n++; pts += b.remaining;
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return { items: n, message: n ? `${pts} point(s) expiré(s) sur ${n} lot(s)` : 'Aucun point à expirer' };
}

/** Fiche fidélité d'un client : solde, valeur, niveau, points qui expirent bientôt, historique. */
export async function customerSummary(customerId: string) {
  const s = await getSettings();
  const c = await db.query(`SELECT id, COALESCE(loyalty_points, 0)::int AS balance FROM customers WHERE id = $1`, [customerId]);
  if (!c.rows[0]) return null;
  const [t, soon, history] = await Promise.all([
    tierFor(customerId),
    db.query(`SELECT COALESCE(SUM(remaining), 0)::int AS n, MIN(expires_at) AS first FROM loyalty_transactions
               WHERE customer_id = $1 AND remaining > 0 AND expires_at <= now() + interval '30 days'`, [customerId]),
    db.query(`SELECT t.*, s.sale_number, concat_ws(' ', u.first_name, u.last_name) AS created_by_name
                FROM loyalty_transactions t LEFT JOIN sales s ON s.id = t.sale_id LEFT JOIN users u ON u.id = t.created_by
               WHERE t.customer_id = $1 ORDER BY t.created_at DESC LIMIT 100`, [customerId]),
  ]);
  const balance = c.rows[0].balance;
  const value = round2(balance * Number(s.point_value));
  const maxPoints = s.enabled && balance >= s.min_redeem_points ? balance : 0;
  return {
    enabled: s.enabled, balance, value, pointValue: Number(s.point_value), minRedeemPoints: s.min_redeem_points, maxRedeemPct: Number(s.max_redeem_pct),
    redeemable: maxPoints, tier: t.tier, nextTier: t.next, points12m: t.points12m,
    expiringSoon: soon.rows[0].n, expiringFirst: soon.rows[0].first, history: history.rows,
  };
}

/** Indicateurs du programme : dette en cours, points émis / utilisés / expirés sur 30 jours, répartition par niveau. */
export async function overview() {
  const s = await getSettings();
  const [bal, month, tiers] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(loyalty_points), 0)::int AS points, COUNT(*) FILTER (WHERE loyalty_points > 0)::int AS members FROM customers`),
    db.query(`SELECT kind, COALESCE(SUM(points), 0)::int AS points, COALESCE(SUM(amount), 0)::numeric(14,2) AS amount
                FROM loyalty_transactions WHERE created_at > now() - interval '30 days' GROUP BY kind`),
    db.query(`WITH p AS (
                SELECT customer_id, SUM(points)::int AS pts FROM loyalty_transactions
                 WHERE created_at > now() - interval '12 months'
                   AND (kind IN ('earn', 'adjust') AND points > 0 OR kind = 'reverse' AND sale_id IS NOT NULL AND points < 0)
                 GROUP BY customer_id)
              SELECT t.code, t.label, COUNT(p.customer_id)::int AS customers
                FROM loyalty_tiers t
                LEFT JOIN p ON p.pts >= t.min_points
                           AND p.pts < COALESCE((SELECT MIN(t2.min_points) FROM loyalty_tiers t2 WHERE t2.is_active AND t2.min_points > t.min_points), 2147483647)
               WHERE t.is_active GROUP BY t.code, t.label, t.min_points ORDER BY t.min_points`),
  ]);
  const byKind = Object.fromEntries(month.rows.map(r => [r.kind, { points: r.points, amount: Number(r.amount) }]));
  return {
    settings: s, outstandingPoints: bal.rows[0].points, outstandingValue: round2(bal.rows[0].points * Number(s.point_value)),
    members: bal.rows[0].members, last30: byKind, tiers: tiers.rows,
  };
}
