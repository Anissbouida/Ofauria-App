/**
 * Plan comptable modifiable (mig 429) : créer, modifier, désactiver ou
 * supprimer un compte depuis l'application, sans migration.
 *
 * Règles (CGNC) :
 *   - code de 4 à 10 chiffres, classe 1 à 8 ; rubrique = 2 premiers chiffres,
 *     poste = 3 premiers ; parent = compte existant au plus long préfixe ;
 *   - nature et sens proposés d'après la classe (amortissements et provisions
 *     d'actif 28/29/39/59 au crédit), modifiables tant que le compte est vierge ;
 *   - collectif (tiers) : comptes 34xx (clients) et 44xx (fournisseurs) ;
 *     TVA : 3455x (récupérable) et 4455x (facturée) ;
 *   - compte mouvementé : seuls le libellé, la TVA et l'état changent (garde
 *     en base) ; désactivation refusée si son solde n'est pas nul ou s'il est
 *     encore utilisé par un paramétrage actif ; suppression réservée aux
 *     comptes jamais utilisés.
 * Toute modification est tracée dans le journal de paramétrage (mig 328).
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

type Actor = { userId: string };
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'result';
export type AccountInput = {
  code: string; label: string;
  accountType?: AccountType | null; normalSide?: 'D' | 'C' | null;
  isCollective?: boolean; auxiliaryKind?: 'supplier' | 'customer' | null;
  tvaRate?: number | null; tvaDirection?: 'collected' | 'deductible' | null;
};

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const TVA_RATES = [7, 10, 14, 20];

/** Nature proposée d'après le code (conventions du plan existant). */
export function defaultType(code: string): AccountType {
  const c = Number(code[0]);
  if (c === 1) return code.startsWith('119') ? 'result' : /^1[4-8]/.test(code) ? 'liability' : 'equity';
  if (c === 2 || c === 3) return 'asset';
  if (c === 5) return code.startsWith('55') ? 'liability' : 'asset';
  if (c === 4) return 'liability';
  if (c === 6) return 'expense';
  if (c === 7) return 'revenue';
  return 'result';
}
/** Sens proposé : actif et charges au débit, sauf amortissements et provisions d'actif. */
export function defaultSide(code: string, type: AccountType): 'D' | 'C' {
  if (/^(28|29|39|59)/.test(code)) return 'C';
  return type === 'asset' || type === 'expense' ? 'D' : 'C';
}

/** Ce qui utilise un compte : écritures, solde, paramétrages, sous-comptes. */
async function usage(c: PoolClient | typeof db, id: string) {
  const a = (await c.query(`SELECT id, code FROM accounts WHERE id = $1`, [id])).rows[0];
  if (!a) throw fail('Compte introuvable', 404);
  const r = (await c.query(
    `SELECT
       (SELECT count(*) FROM journal_entry_lines WHERE account_id = $1)::int AS lines,
       (SELECT COALESCE(sum(jel.debit - jel.credit), 0) FROM journal_entry_lines jel
          JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = $1 AND je.status IN ('posted', 'reversed'))::float8 AS balance,
       (SELECT count(*) FROM accounts WHERE parent_id = $1)::int AS children,
       (SELECT count(*) FROM account_auxiliaries WHERE account_id = $1)::int AS auxiliaries`,
    [id])).rows[0];
  // Paramétrages actifs qui pointent sur le compte (bloquent la désactivation).
  const refs = (await c.query(
    `SELECT 'Catégories de charges' AS what, count(*)::int AS n FROM expense_categories
      WHERE (account_id = $1 OR asset_depreciation_account_id = $1) AND is_active
     UNION ALL SELECT 'Catégories de recettes', count(*)::int FROM revenue_categories WHERE account_id = $1 AND is_active
     UNION ALL SELECT 'Comptes de trésorerie', count(*)::int FROM treasury_accounts WHERE account_code = $2 AND is_active
     UNION ALL SELECT 'Profils de comptabilisation', count(*)::int FROM posting_profiles WHERE account_code = $2 AND is_active
     UNION ALL SELECT 'Types de retenue à la source', count(*)::int FROM withholding_tax_types WHERE account_id = $1 AND is_active
     UNION ALL SELECT 'Journaux (contrepartie)', count(*)::int FROM journals WHERE default_counterpart_account_id = $1 AND is_active
     UNION ALL SELECT 'Immobilisations en cours', count(*)::int FROM fixed_assets
      WHERE (asset_account_id = $1 OR depreciation_account_id = $1 OR expense_account_id = $1) AND status <> 'disposed'
     UNION ALL SELECT 'Modèles d''écritures', count(*)::int FROM journal_entry_template_lines WHERE account_id = $1`,
    [id, a.code])).rows.filter((x: { n: number }) => x.n > 0) as { what: string; n: number }[];
  // Références historiques (bloquent la suppression seulement).
  const history = (await c.query(
    `SELECT (SELECT count(*) FROM bank_statements WHERE account_id = $1)::int
          + (SELECT count(*) FROM budget_lines WHERE account_id = $1)::int
          + (SELECT count(*) FROM prepaid_charges WHERE charge_account_code = $2)::int
          + (SELECT count(*) FROM fixed_assets WHERE asset_account_id = $1 OR depreciation_account_id = $1 OR expense_account_id = $1)::int AS n`,
    [id, a.code])).rows[0].n as number;
  return { lines: r.lines as number, balance: Math.round(r.balance * 100) / 100, children: r.children as number,
           auxiliaries: r.auxiliaries as number, references: refs, history };
}

async function withTx<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Contrôles communs à la création et à la modification. */
function validate(p: AccountInput) {
  const code = p.code.trim();
  if (!/^[1-8]\d{3,9}$/.test(code)) throw fail('Code : 4 à 10 chiffres, commençant par la classe (1 à 8)');
  const label = p.label.trim();
  if (label.length < 2) throw fail('Libellé obligatoire');
  const type = p.accountType || defaultType(code);
  const side = p.normalSide || defaultSide(code, type);
  const collective = !!p.isCollective;
  if (collective && !/^(34|44)/.test(code)) throw fail('Seuls les comptes 34xx (clients) et 44xx (fournisseurs) sont collectifs');
  const aux = collective ? (p.auxiliaryKind || (code.startsWith('34') ? 'customer' : 'supplier')) : null;
  let rate = p.tvaRate ?? null, dir = p.tvaDirection ?? null;
  if (rate != null || dir != null) {
    if (!/^(3455|4455)/.test(code)) throw fail('La TVA ne se rattache qu\'aux comptes 3455x (récupérable) et 4455x (facturée)');
    if (rate != null && !TVA_RATES.includes(Number(rate))) throw fail('Taux de TVA : 7, 10, 14 ou 20 %');
    dir = dir || (code.startsWith('3455') ? 'deductible' : 'collected');
    if ((dir === 'deductible') !== code.startsWith('3455')) throw fail('Sens de TVA incohérent avec le compte (3455 récupérable, 4455 facturée)');
  }
  return { code, label: label.slice(0, 200), type, side, collective, aux, rate, dir };
}

export const chartOfAccountsRepository = {
  usage(id: string) {
    return usage(db, id);
  },

  create(p: AccountInput, actor: Actor) {
    return withTx(actor.userId, async c => {
      const v = validate(p);
      if ((await c.query(`SELECT 1 FROM accounts WHERE code = $1`, [v.code])).rows.length) throw fail(`Le compte ${v.code} existe déjà`, 409);
      const parent = (await c.query(
        `SELECT id FROM accounts WHERE $1 LIKE code || '%' AND code <> $1 ORDER BY length(code) DESC LIMIT 1`, [v.code])).rows[0];
      return (await c.query(
        `INSERT INTO accounts (code, label, account_class, rubrique, poste, parent_id, account_type, normal_side,
                               is_collective, auxiliary_kind, tva_rate, tva_direction)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [v.code, v.label, Number(v.code[0]), v.code.slice(0, 2), v.code.slice(0, 3), parent?.id ?? null,
         v.type, v.side, v.collective, v.aux, v.rate, v.dir])).rows[0];
    });
  },

  /** Modification ; sur un compte mouvementé, la base n'accepte que libellé, TVA et état. */
  update(id: string, p: AccountInput, actor: Actor) {
    return withTx(actor.userId, async c => {
      const cur = (await c.query(`SELECT * FROM accounts WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!cur) throw fail('Compte introuvable', 404);
      const v = validate(p);
      if (v.code !== cur.code && (await c.query(`SELECT 1 FROM accounts WHERE code = $1`, [v.code])).rows.length) {
        throw fail(`Le compte ${v.code} existe déjà`, 409);
      }
      const u = await usage(c, id);
      if (v.code !== cur.code && (u.children || u.auxiliaries || u.references.length || u.history)) {
        throw fail(`Compte ${cur.code} déjà rattaché (sous-comptes, tiers ou paramétrages) : son code ne change plus`, 409);
      }
      if (!v.collective && cur.is_collective && u.auxiliaries) throw fail(`Le compte ${cur.code} porte des tiers : il reste collectif`, 409);
      const parent = v.code === cur.code ? { id: cur.parent_id } : (await c.query(
        `SELECT id FROM accounts WHERE $1 LIKE code || '%' AND code <> $1 AND id <> $2 ORDER BY length(code) DESC LIMIT 1`, [v.code, id])).rows[0];
      return (await c.query(
        `UPDATE accounts SET code = $2, label = $3, account_class = $4, rubrique = $5, poste = $6, parent_id = $7,
                account_type = $8, normal_side = $9, is_collective = $10, auxiliary_kind = $11, tva_rate = $12, tva_direction = $13
          WHERE id = $1 RETURNING *`,
        [id, v.code, v.label, Number(v.code[0]), v.code.slice(0, 2), v.code.slice(0, 3), parent?.id ?? null,
         v.type, v.side, v.collective, v.aux, v.rate, v.dir])).rows[0];
    });
  },

  /** Désactivation : solde nul et plus aucun paramétrage actif dessus. Réactivation libre. */
  setActive(id: string, active: boolean, actor: Actor) {
    return withTx(actor.userId, async c => {
      if (!active) {
        const u = await usage(c, id);
        if (u.balance) throw fail(`Solde non nul (${u.balance.toFixed(2)} DH) : soldez le compte avant de le désactiver`, 409);
        if (u.references.length) throw fail(`Encore utilisé par : ${u.references.map(r => `${r.what} (${r.n})`).join(', ')}`, 409);
      }
      const r = (await c.query(`UPDATE accounts SET is_active = $2 WHERE id = $1 RETURNING *`, [id, active])).rows[0];
      if (!r) throw fail('Compte introuvable', 404);
      return r;
    });
  },

  /** Suppression d'un compte jamais utilisé (sinon : désactivation). */
  remove(id: string, actor: Actor) {
    return withTx(actor.userId, async c => {
      const u = await usage(c, id);
      if (u.lines || u.children || u.auxiliaries || u.references.length || u.history) {
        throw fail('Compte déjà utilisé (écritures, sous-comptes, tiers ou paramétrages) : désactivez-le plutôt', 409);
      }
      await c.query(`DELETE FROM accounts WHERE id = $1`, [id]);
      return { id };
    });
  },
};
