/**
 * Migration ponctuelle du store_id d'un (ou plusieurs) bon(s) de commande.
 *
 * Cas d'usage : un utilisateur a cree un BC quand il etait sur un POS,
 * puis il a ete deplace vers un autre POS. Le BC garde l'ancien store_id
 * et n'apparait plus dans la liste filtree par store_id du nouveau POS.
 *
 * Usage :
 *   # Migrer UN BC vers un store cible (via id du BC)
 *   npx tsx server/scripts/migrate-bc-store.ts --bc <BC_UUID> --to <STORE_UUID>
 *
 *   # Migrer TOUS les BC d'un utilisateur vers son store actuel
 *   npx tsx server/scripts/migrate-bc-store.ts --user <USER_UUID>
 *
 *   # Migrer TOUS les BC d'un utilisateur vers un store cible explicite
 *   npx tsx server/scripts/migrate-bc-store.ts --user <USER_UUID> --to <STORE_UUID>
 *
 *   # Dry-run : afficher ce qui serait modifie sans rien ecrire
 *   ajouter --dry-run a n'importe quelle commande
 *
 * Le script tourne en transaction. Si une verification echoue, ROLLBACK.
 */

import { db } from '../src/config/database.js';

interface Args {
  bcId?: string;
  userId?: string;
  toStoreId?: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bc') args.bcId = argv[++i];
    else if (a === '--user') args.userId = argv[++i];
    else if (a === '--to') args.toStoreId = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Argument inconnu : ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage :
  --bc <BC_UUID> --to <STORE_UUID>            Migrer un BC precis vers un store
  --user <USER_UUID>                          Migrer tous les BC de ce user vers son store actuel
  --user <USER_UUID> --to <STORE_UUID>        Migrer tous les BC de ce user vers un store cible
  --dry-run                                   Simuler (aucun UPDATE)
`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveTargetStore(userId: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const res = await db.query(`SELECT store_id FROM users WHERE id = $1`, [userId]);
  const row = res.rows[0];
  if (!row) throw new Error(`Utilisateur ${userId} introuvable`);
  if (!row.store_id) throw new Error(`User ${userId} n'a pas de store_id (admin global) — fournir --to`);
  return row.store_id;
}

async function previewByBc(bcId: string): Promise<void> {
  const res = await db.query(
    `SELECT po.id, po.order_number, po.status, po.store_id,
            s.name AS store_name, u.first_name || ' ' || u.last_name AS created_by_name
     FROM purchase_orders po
     LEFT JOIN stores s ON s.id = po.store_id
     LEFT JOIN users u  ON u.id = po.created_by
     WHERE po.id = $1`,
    [bcId]
  );
  if (!res.rows[0]) throw new Error(`BC ${bcId} introuvable`);
  const r = res.rows[0];
  console.log(`BC ${r.order_number} (${r.id})`);
  console.log(`  status        : ${r.status}`);
  console.log(`  cree par      : ${r.created_by_name ?? '?'}`);
  console.log(`  store actuel  : ${r.store_name ?? '(aucun)'} [${r.store_id ?? 'NULL'}]`);
}

async function previewByUser(userId: string): Promise<number> {
  const res = await db.query(
    `SELECT po.id, po.order_number, po.status, po.store_id,
            s.name AS store_name
     FROM purchase_orders po
     LEFT JOIN stores s ON s.id = po.store_id
     WHERE po.created_by = $1
     ORDER BY po.created_at DESC`,
    [userId]
  );
  console.log(`${res.rowCount ?? 0} BC trouve(s) pour user ${userId} :`);
  for (const r of res.rows) {
    console.log(`  - ${r.order_number} | status=${r.status} | store=${r.store_name ?? '(aucun)'} [${r.store_id ?? 'NULL'}]`);
  }
  return res.rowCount ?? 0;
}

async function verifyStoreExists(storeId: string): Promise<string> {
  const res = await db.query(`SELECT name FROM stores WHERE id = $1`, [storeId]);
  if (!res.rows[0]) throw new Error(`Store ${storeId} introuvable`);
  return res.rows[0].name;
}

async function main() {
  const args = parseArgs();

  if (!args.bcId && !args.userId) {
    console.error('Erreur : fournir --bc ou --user');
    printHelp();
    process.exit(1);
  }

  for (const id of [args.bcId, args.userId, args.toStoreId]) {
    if (id && !UUID_RE.test(id)) {
      console.error(`Erreur : ${id} n'est pas un UUID valide`);
      process.exit(1);
    }
  }

  if (args.bcId && !args.toStoreId) {
    console.error('Erreur : --bc necessite --to <STORE_UUID>');
    process.exit(1);
  }

  console.log(args.dryRun ? '═══ DRY RUN (aucune ecriture) ═══' : '═══ MIGRATION ═══');
  console.log('');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (args.bcId) {
      await previewByBc(args.bcId);
      const targetName = await verifyStoreExists(args.toStoreId!);
      console.log(`\nCible : ${targetName} [${args.toStoreId}]`);

      if (!args.dryRun) {
        const upd = await client.query(
          `UPDATE purchase_orders SET store_id = $1, updated_at = NOW()
           WHERE id = $2 AND store_id IS DISTINCT FROM $1
           RETURNING id, order_number, store_id`,
          [args.toStoreId, args.bcId]
        );
        console.log(`\n${upd.rowCount} ligne(s) mise(s) a jour.`);
      }
    } else if (args.userId) {
      const count = await previewByUser(args.userId);
      if (count === 0) {
        console.log('Rien a migrer.');
        await client.query('ROLLBACK');
        process.exit(0);
      }
      const target = await resolveTargetStore(args.userId, args.toStoreId);
      const targetName = await verifyStoreExists(target);
      console.log(`\nCible : ${targetName} [${target}]`);

      if (!args.dryRun) {
        const upd = await client.query(
          `UPDATE purchase_orders SET store_id = $1, updated_at = NOW()
           WHERE created_by = $2 AND store_id IS DISTINCT FROM $1
           RETURNING id, order_number, store_id`,
          [target, args.userId]
        );
        console.log(`\n${upd.rowCount} ligne(s) mise(s) a jour :`);
        for (const r of upd.rows) console.log(`  - ${r.order_number}`);
      }
    }

    if (args.dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry-run : ROLLBACK effectue.');
    } else {
      await client.query('COMMIT');
      console.log('\nCOMMIT effectue.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nErreur — ROLLBACK :', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
