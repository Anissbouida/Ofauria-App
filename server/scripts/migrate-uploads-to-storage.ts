// G0-04 (plan d'action 2026-11) — reprise des anciens fichiers de /uploads.
//
// Les fichiers téléversés avant G0-04 étaient écrits sur le disque du serveur
// (dossier uploads/) et leur URL enregistrée en base sous la forme /uploads/...
// Sur Cloud Run ce disque est vidé à chaque révision : la plupart sont perdus.
//
// Ce script, PAR DÉFAUT EN LECTURE SEULE, dresse le rapport de rattrapage :
//   - URL dont le fichier est encore présent sur le disque local (reprenables) ;
//   - URL dont le fichier est absent (perdus : à téléverser à nouveau).
//
// Avec --apply (après accord), il copie les fichiers présents dans le stockage
// objet (table files) et remplace leur URL par /api/v1/files/<id>. Les URL
// perdues ne sont jamais modifiées.
//
// Usage (depuis server/) :
//   npx tsx scripts/migrate-uploads-to-storage.ts            # rapport seul
//   npx tsx scripts/migrate-uploads-to-storage.ts --apply    # reprise
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
const APPLY = process.argv.includes('--apply');
const UPLOADS = path.resolve(here, '../../uploads');

const { db } = await import('../src/config/database.js');
const { storeFile, DOCUMENT_MIMES } = await import('../src/services/storage.service.js');
type OwnerType = Parameters<typeof storeFile>[0]['ownerType'];

const TARGETS: { table: string; col: string; owner: OwnerType; label: string; storeCol: string | null }[] = [
  { table: 'invoices', col: 'attachment_url', owner: 'invoice', label: 'Factures fournisseurs', storeCol: 'store_id' },
  { table: 'payments', col: 'check_attachment_url', owner: 'payment', label: 'Pièces de règlement', storeCol: null },
  { table: 'product_losses', col: 'photo_url', owner: 'loss', label: 'Photos de pertes', storeCol: 'store_id' },
  { table: 'complaints', col: 'photo_url', owner: 'complaint', label: 'Photos de réclamations', storeCol: null },
  { table: 'maintenance_interventions', col: 'photo_url', owner: 'maintenance', label: 'Photos de maintenance', storeCol: null },
  { table: 'products', col: 'image_url', owner: 'product', label: 'Images de produits', storeCol: null },
];

let present = 0, lost = 0, moved = 0, rejected = 0;
for (const t of TARGETS) {
  const rows = (await db.query(
    `SELECT id, ${t.col} AS url${t.storeCol ? `, ${t.storeCol} AS store_id` : ''} FROM ${t.table} WHERE ${t.col} LIKE '/uploads/%' ORDER BY id`)).rows;
  const missing: string[] = [];
  let ok = 0;
  for (const r of rows) {
    const rel = String(r.url).replace(/^\/uploads\//, '');
    const file = path.resolve(UPLOADS, rel);
    if (!file.startsWith(UPLOADS + path.sep) || !fs.existsSync(file)) { missing.push(`${r.id}  ${r.url}`); continue; }
    ok++;
    if (!APPLY) continue;
    try {
      const stored = await storeFile({
        buffer: fs.readFileSync(file), originalName: path.basename(file), ownerType: t.owner, ownerId: r.id,
        storeId: r.store_id ?? null, allowed: DOCUMENT_MIMES,
      });
      await db.query(`UPDATE ${t.table} SET ${t.col} = $2 WHERE id = $1`, [r.id, stored.url]);
      moved++;
    } catch (e) {
      rejected++;
      console.log(`  ✗ ${t.table} ${r.id} : ${(e as Error).message}`);
    }
  }
  present += ok; lost += missing.length;
  console.log(`\n${t.label} (${t.table}.${t.col}) : ${rows.length} URL héritée(s) — ${ok} présente(s), ${missing.length} perdue(s)`);
  for (const m of missing.slice(0, 50)) console.log(`  à téléverser à nouveau : ${m}`);
  if (missing.length > 50) console.log(`  … ${missing.length - 50} autres`);
}

console.log(`\nTotal : ${present} fichier(s) présent(s) sur le disque, ${lost} perdu(s).`);
console.log(APPLY ? `Reprise : ${moved} copié(s) dans le stockage, ${rejected} refusé(s).` : 'Rapport seul (aucune écriture). Relancer avec --apply pour reprendre les fichiers présents.');
await db.pool.end();
