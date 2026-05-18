/**
 * Import des chèques fournisseurs depuis un classeur Excel "TALON CHQ".
 *
 * Usage:
 *   npx tsx server/src/scripts/import-cheques-excel.ts --file=/path/file.xlsx
 *   npx tsx server/src/scripts/import-cheques-excel.ts --file=/path/file.xlsx --commit
 *
 * Logique (Option 4 hybride) :
 *   - Tous les cheques (CHQ + EFFET) deviennent des `payments` (method=check / bank).
 *   - 3 cheques cibles font l'objet d'un RAPPROCHEMENT avec les factures importees :
 *       1. ECOMAB cheque 1237397 (20/05) → 9 factures ECOMAB d'avril
 *       2. OVOTEC cheque 1237393 (10/05) → 7 factures OVOTEC d'avril
 *       3. OVOTEC cheque 1237406 (10/06) → 3 factures OVOTEC de mai
 *     Pour ces cas : 1 payment par facture (montant = total_amount), invoice marquee `paid`.
 *   - Autres cheques : 1 payment avec invoice_id=null, type='invoice' (si supplier connu) sinon 'expense'.
 *   - Idempotence : skip si payment avec ce check_number existe deja.
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

// ─── CLI ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fileArg = args.find(a => a.startsWith('--file='))?.slice(7);
const COMMIT = args.includes('--commit');
if (!fileArg) { console.error('Usage: --file=<path.xlsx> [--commit]'); process.exit(1); }

const DEFAULT_STORE_ID = '00000000-0000-0000-0000-000000000001';
const CATEGORY_MATIERES_PREMIERES = '10000000-0000-0000-0000-000000000003';

// ─── Rapprochements explicites cheque → factures importees ───────────────
// Liste des cheques cibles. Pour chacun, on rapprochera toutes les factures
// du fournisseur dont la date est dans la fenetre indiquee.
const RAPPROCHEMENTS: Array<{
  checkNumber: string;
  supplierName: string;       // tel qu'il est dans suppliers (Ecomab / Ovotec)
  fromDate: string; toDate: string; // periode des factures couvertes
  description: string;
}> = [
  {
    checkNumber: '1237397', supplierName: 'Ecomab',
    fromDate: '2026-04-01', toDate: '2026-04-30',
    description: 'Reglement factures ECOMAB Avril 2026 (cheque global)',
  },
  {
    checkNumber: '1237393', supplierName: 'Ovotec',
    fromDate: '2026-04-01', toDate: '2026-04-30',
    description: 'Reglement factures OVOTEC Avril 2026 (cheque global)',
  },
  {
    checkNumber: '1237406', supplierName: 'Ovotec',
    fromDate: '2026-05-01', toDate: '2026-05-31',
    description: 'Reglement factures OVOTEC Mai 2026 (cheque global, ecart probable car cheque couvre des factures hors periode importee)',
  },
];

// ─── Mapping fournisseurs Excel → nom canonique en base ──────────────────
const SUPPLIER_MAP: Record<string, string> = {
  'ECOMAB': 'Ecomab',
  'OVOTEC': 'Ovotec',
  'RICAMAROC': 'Rica Maroc',
  'ZEALOUS': 'Zealous',
  'ZEOLOUS': 'Zealous',
  'MAGNATE': 'Magnate',
  'DYECHEM': 'Dyechem',
  'NEGO-SON': 'Nego-Son',
  'ADEIS': 'Adeis',
  'ORIENTINES': 'Orientines',
  'SOCIETÉ REGIONAL': 'Société Régional',
  'SOCIETE REGIONAL': 'Société Régional',
};

// ─── Couleurs console ────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

// ─── Types ───────────────────────────────────────────────────────────────
interface Cheque {
  type: 'CHQ' | 'EFFET';
  checkNumber: string;
  amount: number;
  date: Date;            // date de reglement
  invoiceDate?: Date;    // date de facture (EFFET only)
  supplierRaw: string;   // tel qu'ecrit dans Excel
  supplierCanonical: string; // apres mapping
  sourceRow: number;
}

// ─── Helpers Excel ───────────────────────────────────────────────────────
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
    const d = new Date(v); return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseCheques(filePath: string): Cheque[] {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const out: Cheque[] = [];
  const seen = new Set<string>();   // dedup par check_number

  // Feuille CHQ : N° CHEQUE | M. CHEQUE | DATE DE REGLEMENT CHEQUE | FOURNISSEUR
  const wsChq = wb.Sheets['CHQ'];
  if (wsChq) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wsChq, { header: 1 });
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      const num = String(r[0]).trim();
      const amount = parseNum(r[1]);
      const date = parseDate(r[2]);
      const supplier = r[3] ? String(r[3]).trim().toUpperCase() : '';
      if (!amount || !date || !supplier) continue; // cheque vide / non emis
      if (seen.has(num)) continue;
      seen.add(num);
      out.push({
        type: 'CHQ', checkNumber: num, amount, date,
        supplierRaw: supplier,
        supplierCanonical: SUPPLIER_MAP[supplier] ?? supplier.charAt(0) + supplier.slice(1).toLowerCase(),
        sourceRow: i + 1,
      });
    }
  }

  // Feuille EFFET : DATE DE FACTURE | DATE DE EFFET | M. EFFET | FOURNISSEUR | N° EFFET
  const wsEffet = wb.Sheets['EFFET'];
  if (wsEffet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wsEffet, { header: 1 });
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      const invDate = parseDate(r[0]);
      const date = parseDate(r[1]);
      const amount = parseNum(r[2]);
      const supplier = r[3] ? String(r[3]).trim().toUpperCase() : '';
      const num = r[4] ? String(r[4]).trim() : '';
      if (!amount || !date || !supplier || !num) continue;
      if (seen.has(num)) continue;
      seen.add(num);
      out.push({
        type: 'EFFET', checkNumber: num, amount, date,
        invoiceDate: invDate ?? undefined,
        supplierRaw: supplier,
        supplierCanonical: SUPPLIER_MAP[supplier] ?? supplier.charAt(0) + supplier.slice(1).toLowerCase(),
        sourceRow: i + 1,
      });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ─── Resolution supplier ─────────────────────────────────────────────────
async function resolveSupplier(client: PoolClient, name: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]
  );
  if (res.rows[0]) return res.rows[0].id;
  const ins = await client.query<{ id: string }>(
    `INSERT INTO suppliers (name, is_active) VALUES ($1, true) RETURNING id`, [name]
  );
  console.log(`  ${C.yellow}+ supplier cree:${C.reset} ${name}`);
  return ins.rows[0].id;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${C.bold}${C.cyan}=== Import cheques Ofauria ===${C.reset}`);
  console.log(`Fichier : ${fileArg}`);
  console.log(`Mode    : ${COMMIT ? `${C.red}${C.bold}COMMIT${C.reset}` : `${C.green}DRY-RUN${C.reset}`}\n`);

  const cheques = parseCheques(fileArg!);
  console.log(`Cheques parses : ${cheques.length} (CHQ + EFFET)\n`);

  const client = await db.getClient();
  await client.query('BEGIN');

  const stats = { paymentsCreated: 0, skipped: 0, rapprochementsApplied: 0, invoicesPaid: 0, suppliersCreated: 0 };
  const lines: string[] = [];

  try {
    for (const chq of cheques) {
      // Idempotence
      const exist = await client.query(
        `SELECT id FROM payments WHERE check_number = $1 LIMIT 1`, [chq.checkNumber]
      );
      if (exist.rows.length > 0) {
        stats.skipped++;
        lines.push(`${C.dim}SKIP   #${chq.checkNumber} ${chq.amount} DH ${chq.supplierRaw} (deja importe)${C.reset}`);
        continue;
      }

      const supplierId = await resolveSupplier(client, chq.supplierCanonical);

      // Rapprochement ?
      const rap = RAPPROCHEMENTS.find(r => r.checkNumber === chq.checkNumber);
      if (rap) {
        const invs = await client.query<{ id: string; invoice_number: string; total_amount: string }>(
          `SELECT id, invoice_number, total_amount FROM invoices
           WHERE supplier_id = $1 AND invoice_date BETWEEN $2 AND $3 AND status = 'pending'
           ORDER BY invoice_date`,
          [supplierId, rap.fromDate, rap.toDate]
        );
        if (invs.rows.length === 0) {
          lines.push(`${C.yellow}WARN   #${chq.checkNumber} aucune facture trouvee pour rapprochement (${rap.supplierName} ${rap.fromDate}..${rap.toDate})${C.reset}`);
          // On cree quand meme 1 payment global
          await client.query(
            `INSERT INTO payments (type, supplier_id, amount, payment_method, payment_date, check_number, check_date, description, store_id, category_id, import_source, import_source_row)
             VALUES ('invoice', $1, $2, 'check', $3, $4, $3, $5, $6, $7, 'TALON_CHQ', $8)`,
            [supplierId, chq.amount, chq.date, chq.checkNumber, rap.description + ' (sans rapprochement)', DEFAULT_STORE_ID, CATEGORY_MATIERES_PREMIERES, chq.sourceRow]
          );
          stats.paymentsCreated++;
          continue;
        }
        // 1 payment par facture. import_source_row=NULL car plusieurs payments partagent la meme ligne Excel.
        const totalFactures = invs.rows.reduce((s, i) => s + parseFloat(i.total_amount), 0);
        for (const inv of invs.rows) {
          const amt = parseFloat(inv.total_amount);
          await client.query(
            `INSERT INTO payments (type, supplier_id, invoice_id, amount, payment_method, payment_date, check_number, check_date, description, store_id, category_id, import_source)
             VALUES ('invoice', $1, $2, $3, 'check', $4, $5, $4, $6, $7, $8, 'TALON_CHQ')`,
            [supplierId, inv.id, amt, chq.date, chq.checkNumber, `Cheque #${chq.checkNumber} - ${rap.description}`, DEFAULT_STORE_ID, CATEGORY_MATIERES_PREMIERES]
          );
          await client.query(
            `UPDATE invoices SET paid_amount = total_amount, status = 'paid' WHERE id = $1`, [inv.id]
          );
          stats.paymentsCreated++;
          stats.invoicesPaid++;
        }
        // Si le cheque est plus gros que la somme des factures rapprochees, on cree un payment "complement"
        const ecart = chq.amount - totalFactures;
        if (Math.abs(ecart) > 0.5) {
          await client.query(
            `INSERT INTO payments (type, supplier_id, amount, payment_method, payment_date, check_number, check_date, description, store_id, category_id, import_source)
             VALUES ('invoice', $1, $2, 'check', $3, $4, $3, $5, $6, $7, 'TALON_CHQ')`,
            [supplierId, ecart, chq.date, chq.checkNumber, `Cheque #${chq.checkNumber} - ecart non rapproche (factures hors periode importee)`, DEFAULT_STORE_ID, CATEGORY_MATIERES_PREMIERES]
          );
          stats.paymentsCreated++;
        }
        stats.rapprochementsApplied++;
        lines.push(`${C.green}MATCH  #${chq.checkNumber} ${chq.amount} DH ${chq.supplierRaw} → ${invs.rows.length} factures (${totalFactures.toFixed(2)} DH${Math.abs(ecart) > 0.5 ? `, ecart ${ecart.toFixed(2)}` : ''})${C.reset}`);
      } else {
        // Cheque simple : 1 payment, type=invoice si supplier connu, sinon expense
        const isKnown = chq.supplierCanonical && chq.supplierCanonical !== chq.supplierRaw.toUpperCase();
        await client.query(
          `INSERT INTO payments (type, supplier_id, amount, payment_method, payment_date, check_number, check_date, description, store_id, category_id, import_source, import_source_row)
           VALUES ($1, $2, $3, $4, $5, $6, $5, $7, $8, $9, $10, $11)`,
          [
            'invoice',                                 // tous traites comme reglement fournisseur
            supplierId, chq.amount,
            chq.type === 'EFFET' ? 'bank' : 'check',   // les EFFET sont des traites bancaires
            chq.date, chq.checkNumber,
            `${chq.type} #${chq.checkNumber} - ${chq.supplierCanonical} (import Excel, non rapproche)`,
            DEFAULT_STORE_ID, CATEGORY_MATIERES_PREMIERES,
            `TALON_CHQ_${chq.type}`,                   // suffixer pour eviter collision CHQ/EFFET sur la meme ligne
            chq.sourceRow,
          ]
        );
        stats.paymentsCreated++;
        lines.push(`${C.cyan}OK     #${chq.checkNumber} ${chq.amount.toFixed(2)} DH ${chq.supplierRaw.padEnd(20)} ${chq.date.toISOString().slice(0, 10)}${C.reset}`);
      }
    }

    // ─── Rapport ─────────────────────────────────────────────────
    console.log(`${C.bold}${C.cyan}── Detail ──${C.reset}`);
    for (const l of lines) console.log(`  ${l}`);
    console.log();
    console.log(`${C.bold}${C.cyan}── Statistiques ──${C.reset}`);
    console.log(`  Paiements crees       : ${C.green}${stats.paymentsCreated}${C.reset}`);
    console.log(`  Rapprochements        : ${C.green}${stats.rapprochementsApplied}${C.reset} / 3 cibles`);
    console.log(`  Factures marquees paid: ${C.green}${stats.invoicesPaid}${C.reset}`);
    console.log(`  Cheques skip (deja)   : ${C.yellow}${stats.skipped}${C.reset}`);
    console.log();

    if (COMMIT) {
      await client.query('COMMIT');
      console.log(`${C.bold}${C.green}✓ COMMIT effectue${C.reset}`);
    } else {
      await client.query('ROLLBACK');
      console.log(`${C.bold}${C.yellow}↩ ROLLBACK (dry-run). Relance avec --commit pour persister.${C.reset}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`${C.red}${C.bold}ERREUR : rollback complet${C.reset}`);
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
