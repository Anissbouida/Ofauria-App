// Backfill du coût standard (unit_cost) en CMUP depuis le stock réel.
//
// Contexte : la refonte CMUP (lots A/B/C) fait évoluer le coût standard
// UNIQUEMENT à la prochaine réception. Les valeurs déjà en base gardent donc
// leur ancien « dernier prix » jusque-là. Ce script réaligne ces valeurs sur
// la moyenne pondérée du stock réellement présent, une bonne fois.
//
// Sources de coût « réel » :
//   - Ingrédients : moyenne pondérée des lots en stock (ingredient_lots,
//     quantity_remaining × unit_cost sur les lots actifs). C'est le stock
//     physique et son coût d'achat réel.
//   - Consommables : pas de lots (stock simple). On reconstruit en FIFO la
//     valeur des unités encore en stock à partir des réceptions les plus
//     récentes journalisées (packaging_stock_transactions.unit_cost).
//
// Sécurité :
//   - DRY-RUN par défaut : calcule et affiche le comparatif avant/après,
//     n'écrit RIEN (ROLLBACK). Il faut --apply pour écrire (COMMIT).
//   - Affiche la base cible : à lancer sur STAGING d'abord, jamais à l'aveugle
//     en prod. Changer le coût standard déplace tous les prix/marges calculés.
//
// Usage (depuis server/) :
//   npx tsx scripts/backfill-unit-cost-cmup.ts            # simulation
//   npx tsx scripts/backfill-unit-cost-cmup.ts --apply    # écrit réellement
//   npm run backfill:cmup -w server                       # simulation (racine)
import { db } from '../src/config/database.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const APPLY = process.argv.includes('--apply');
const EPS = 0.0001;

type Change = {
  kind: 'ingrédient' | 'consommable';
  name: string;
  stock: number;
  oldCost: number;
  newCost: number | null; // null = pas de nouvelle valeur calculable
  source: string;         // 'lots' | 'fifo-réceptions' | 'partiel' | 'inchangé'
};

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const pct = (oldV: number, newV: number) =>
  oldV > 0 ? ((newV - oldV) / oldV) * 100 : newV > 0 ? Infinity : 0;

function printTable(rows: Change[]) {
  const header = ['Type', 'Article', 'Stock', 'Ancien', 'Nouveau', 'Δ%', 'Source'];
  const body = rows.map(c => [
    c.kind,
    c.name.length > 32 ? c.name.slice(0, 31) + '…' : c.name,
    c.stock.toFixed(2),
    c.oldCost.toFixed(4),
    c.newCost == null ? '—' : c.newCost.toFixed(4),
    c.newCost == null ? '—' : (pct(c.oldCost, c.newCost) === Infinity ? '∞' : pct(c.oldCost, c.newCost).toFixed(1)),
    c.source,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map(row => row[i].length)));
  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log(widths.map(w => '─'.repeat(w)).join('  '));
  for (const row of body) console.log(line(row));
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.match(/@([^/]+)\//)?.[1] ?? '(inconnue)';
  console.log(`\nBase cible : ${host}`);
  console.log(APPLY
    ? '*** MODE APPLY : les écritures seront COMMITées ***'
    : 'Mode SIMULATION (dry-run) — aucune écriture. Ajouter --apply pour écrire.\n');

  const client = await db.getClient();
  const changes: Change[] = [];
  try {
    await client.query('BEGIN');

    // ── 1. Ingrédients : moyenne pondérée des lots en stock ──────────────────
    const ingRows = (await client.query(`
      SELECT i.id,
             i.name,
             i.unit_cost::float AS old_cost,
             COALESCE(SUM(l.quantity_remaining), 0)::float AS stock,
             CASE WHEN COALESCE(SUM(l.quantity_remaining), 0) > 0
                  THEN (SUM(l.quantity_remaining * l.unit_cost)
                        / SUM(l.quantity_remaining))::float
                  ELSE NULL END AS new_cost
        FROM ingredients i
        LEFT JOIN ingredient_lots l
          ON l.ingredient_id = i.id
         AND l.status = 'active'
         AND l.quantity_remaining > 0
         AND l.unit_cost IS NOT NULL
       GROUP BY i.id, i.name, i.unit_cost
       ORDER BY i.name
    `)).rows as { id: string; name: string; old_cost: number; stock: number; new_cost: number | null }[];

    for (const row of ingRows) {
      const oldCost = row.old_cost ?? 0;
      const newCost = row.new_cost == null ? null : r4(row.new_cost);
      const change: Change = {
        kind: 'ingrédient', name: row.name, stock: row.stock,
        oldCost, newCost,
        source: newCost == null ? 'inchangé (pas de lot en stock)' : 'lots',
      };
      changes.push(change);
      if (newCost != null && Math.abs(newCost - oldCost) > EPS) {
        await client.query(`UPDATE ingredients SET unit_cost = $1 WHERE id = $2`, [newCost, row.id]);
      }
    }

    // ── 2. Consommables : reconstruction FIFO du stock restant ───────────────
    // Pas de lots : on value les unités encore en stock par les réceptions les
    // plus RÉCENTES (en FIFO, les anciennes sont déjà consommées).
    const pkgRows = (await client.query(`
      SELECT p.id,
             p.name,
             p.unit_cost::float AS old_cost,
             COALESCE((SELECT SUM(s.stock_quantity) FROM packaging_store_stock s
                        WHERE s.packaging_id = p.id), 0)::float AS stock
        FROM packaging_items p
       ORDER BY p.name
    `)).rows as { id: string; name: string; old_cost: number; stock: number }[];

    for (const row of pkgRows) {
      const oldCost = row.old_cost ?? 0;
      if (row.stock <= 0) {
        changes.push({ kind: 'consommable', name: row.name, stock: row.stock, oldCost, newCost: null, source: 'inchangé (stock nul)' });
        continue;
      }
      const receipts = (await client.query(`
        SELECT quantity_change::float AS qty, unit_cost::float AS cost
          FROM packaging_stock_transactions
         WHERE packaging_id = $1
           AND type IN ('reception', 'restock')
           AND unit_cost IS NOT NULL
           AND quantity_change > 0
         ORDER BY created_at DESC
      `, [row.id])).rows as { qty: number; cost: number }[];

      // On couvre le stock restant par les réceptions les plus récentes.
      let covered = 0;
      let value = 0;
      for (const rc of receipts) {
        if (covered >= row.stock) break;
        const take = Math.min(rc.qty, row.stock - covered);
        covered += take;
        value += take * rc.cost;
      }

      if (covered <= 0) {
        // Aucune réception chiffrée dans l'historique : on ne touche pas.
        changes.push({ kind: 'consommable', name: row.name, stock: row.stock, oldCost, newCost: null, source: 'inchangé (pas d\'historique prix)' });
        continue;
      }
      const newCost = r4(value / covered);
      const partial = covered + EPS < row.stock; // historique insuffisant pour tout couvrir
      changes.push({
        kind: 'consommable', name: row.name, stock: row.stock, oldCost, newCost,
        source: partial ? `partiel (${covered.toFixed(1)}/${row.stock.toFixed(1)} couvert)` : 'fifo-réceptions',
      });
      if (Math.abs(newCost - oldCost) > EPS) {
        await client.query(`UPDATE packaging_items SET unit_cost = $1, updated_at = NOW() WHERE id = $2`, [newCost, row.id]);
      }
    }

    // ── 3. Comparatif avant / après ──────────────────────────────────────────
    const moved = changes
      .filter(c => c.newCost != null && Math.abs(c.newCost - c.oldCost) > EPS)
      .sort((a, b) => Math.abs(pct(b.oldCost, b.newCost as number)) - Math.abs(pct(a.oldCost, a.newCost as number)));

    console.log('── Articles dont le coût change ──');
    if (moved.length === 0) console.log('(aucun)');
    else printTable(moved);

    // Impact global sur la valorisation du stock (stock × coût).
    const valOld = changes.reduce((s, c) => s + c.stock * c.oldCost, 0);
    const valNew = changes.reduce((s, c) => s + c.stock * (c.newCost ?? c.oldCost), 0);

    const unchanged = changes.filter(c => c.newCost == null).length;
    console.log('\n── Synthèse ──');
    console.log(`Articles examinés        : ${changes.length} (${ingRows.length} ingrédients, ${pkgRows.length} consommables)`);
    console.log(`Coûts modifiés           : ${moved.length}`);
    console.log(`Inchangés (sans source)  : ${unchanged}`);
    console.log(`Valorisation stock avant : ${valOld.toFixed(2)}`);
    console.log(`Valorisation stock après : ${valNew.toFixed(2)} (Δ ${(valNew - valOld).toFixed(2)})`);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('\n✅ COMMIT — coûts standard mis à jour.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n↩️  ROLLBACK — simulation, rien écrit. Relancer avec --apply pour appliquer.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
