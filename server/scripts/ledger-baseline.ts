/**
 * Jeu de référence du grand livre (plan d'action compta, étape 0).
 *
 * LECTURE SEULE : une transaction `READ ONLY`, aucune écriture. Écrit un fichier JSON
 * (balance par compte, écritures par journal et origine, totaux, rang de chaîne) pour
 * comparer l'état du grand livre avant et après chaque étape du plan.
 *
 *   DATABASE_URL=… npx tsx scripts/ledger-baseline.ts <sortie.json>
 *   npx tsx scripts/ledger-baseline.ts --diff <avant.json> <après.json>
 *
 * Deux exécutions successives sur une base inchangée donnent le même contenu
 * (la date de génération est la seule valeur qui varie ; elle est exclue du diff).
 */
import fs from 'fs';
import pg from 'pg';

type Baseline = {
  generated_at: string;
  database: string;
  entries: number;
  lines: number;
  total_debit: string;
  total_credit: string;
  unbalanced_entries: number;
  last_chain_seq: string | null;
  unsealed_entries: number;
  by_journal_source: Array<{ journal: string; source_kind: string; entries: number; debit: string }>;
  balance: Array<{ account: string; label: string; debit: string; credit: string; lines: number }>;
};

async function snapshot(connectionString: string): Promise<Baseline> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const head = (await client.query(`SELECT current_database() AS db,
        (SELECT count(*) FROM journal_entries) AS entries,
        (SELECT count(*) FROM journal_entry_lines) AS lines,
        (SELECT COALESCE(sum(debit), 0) FROM journal_entry_lines) AS d,
        (SELECT COALESCE(sum(credit), 0) FROM journal_entry_lines) AS c,
        (SELECT count(*) FROM (SELECT journal_entry_id FROM journal_entry_lines GROUP BY 1 HAVING sum(debit) <> sum(credit)) x) AS unbalanced,
        (SELECT max(chain_seq) FROM journal_entries) AS chain,
        (SELECT count(*) FROM journal_entries WHERE chain_seq IS NULL AND status IN ('posted', 'reversed')) AS unsealed`)).rows[0];
    const bySrc = (await client.query(
      `SELECT j.code AS journal, e.source_kind, count(*)::int AS entries, COALESCE(sum(t.d), 0)::text AS debit
         FROM journal_entries e JOIN journals j ON j.id = e.journal_id
         LEFT JOIN (SELECT journal_entry_id, sum(debit) AS d FROM journal_entry_lines GROUP BY 1) t ON t.journal_entry_id = e.id
        GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
    const balance = (await client.query(
      `SELECT a.code AS account, a.label, sum(l.debit)::text AS debit, sum(l.credit)::text AS credit, count(*)::int AS lines
         FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id GROUP BY 1, 2 ORDER BY 1`)).rows;
    await client.query('ROLLBACK');
    return {
      generated_at: new Date().toISOString(), database: head.db,
      entries: Number(head.entries), lines: Number(head.lines),
      total_debit: String(head.d), total_credit: String(head.c),
      unbalanced_entries: Number(head.unbalanced), last_chain_seq: head.chain == null ? null : String(head.chain),
      unsealed_entries: Number(head.unsealed), by_journal_source: bySrc, balance,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

function diff(a: Baseline, b: Baseline): string[] {
  const out: string[] = [];
  for (const k of ['entries', 'lines', 'total_debit', 'total_credit', 'unbalanced_entries', 'last_chain_seq', 'unsealed_entries'] as const) {
    if (a[k] !== b[k]) out.push(`${k} : ${a[k]} → ${b[k]}`);
  }
  const map = (x: Baseline) => new Map(x.balance.map(r => [r.account, r]));
  const ma = map(a), mb = map(b);
  for (const code of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    const ra = ma.get(code), rb = mb.get(code);
    const sa = ra ? `${ra.debit}/${ra.credit}` : 'absent', sb = rb ? `${rb.debit}/${rb.credit}` : 'absent';
    if (sa !== sb) out.push(`compte ${code} (débit/crédit) : ${sa} → ${sb}`);
  }
  const key = (r: Baseline['by_journal_source'][number]) => `${r.journal}/${r.source_kind}`;
  const sa = new Map(a.by_journal_source.map(r => [key(r), r])), sb = new Map(b.by_journal_source.map(r => [key(r), r]));
  for (const k of [...new Set([...sa.keys(), ...sb.keys()])].sort()) {
    const x = sa.get(k)?.entries ?? 0, y = sb.get(k)?.entries ?? 0;
    if (x !== y) out.push(`écritures ${k} : ${x} → ${y}`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--diff') {
    const [a, b] = [args[1], args[2]].map(p => JSON.parse(fs.readFileSync(p, 'utf-8')) as Baseline);
    const d = diff(a, b);
    console.log(d.length ? d.join('\n') : 'Aucun écart.');
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  const target = args[0];
  if (!target) throw new Error('Usage : ledger-baseline.ts <sortie.json> | --diff <avant.json> <apres.json>');
  const snap = await snapshot(url);
  fs.writeFileSync(target, JSON.stringify(snap, null, 2) + '\n');
  console.log(`${snap.database} : ${snap.entries} écritures, ${snap.lines} lignes, débit ${snap.total_debit}, crédit ${snap.total_credit}, ${snap.unbalanced_entries} déséquilibrées, rang ${snap.last_chain_seq} → ${target}`);
}

main().catch(err => { console.error(err); process.exit(1); });
