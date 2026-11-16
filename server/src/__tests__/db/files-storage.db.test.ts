/**
 * G0-04 (plan d'action 2026-11) — stockage des fichiers.
 *
 *  - téléversement puis lecture : le contenu revient à l'identique ;
 *  - un .svg (ou tout contenu qui n'est pas une image/PDF reconnue) est refusé ;
 *  - une facture n'est lisible que par la direction ;
 *  - le fichier d'un autre établissement est refusé ;
 *  - la colonne file_id se déduit de l'URL (déclencheur de la mig 521).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

// PNG 1×1 valide.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

describe.skipIf(!hasTestDb)('Stockage des fichiers (G0-04)', () => {
  const p = () => testPool();
  let svc: typeof import('../../services/storage.service.js');
  let storeA: string, storeB: string, userId: string, productId: string;
  const fileIds: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalum-files-'));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    svc = await import('../../services/storage.service.js');
    svc.setStorageDriver(svc.localDriver(dir));
    storeA = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Fichiers A ${RUN}`])).rows[0].id;
    storeB = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Fichiers B ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','F','S','admin',$2) RETURNING id`, [`files-${RUN}@test.local`, storeA])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,5) RETURNING id`, [`Art fichier ${RUN}`, `art-fichier-${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    svc.setStorageDriver(null);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM files WHERE id = ANY($1)`, [fileIds]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = ANY($1)`, [[storeA, storeB]]).catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    await closeTestPool();
  });

  it('reconnaît le type réel par les premiers octets', () => {
    expect(svc.sniffType(PNG)?.mime).toBe('image/png');
    expect(svc.sniffType(PDF)?.mime).toBe('application/pdf');
    expect(svc.sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(svc.sniffType(SVG)).toBeNull();
    expect(svc.sniffType(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('téléverse puis relit le même contenu', async () => {
    const f = await svc.storeFile({ buffer: PNG, originalName: 'photo.png', ownerType: 'loss', storeId: storeA, uploadedBy: userId });
    fileIds.push(f.id);
    expect(f.url).toBe(`/api/v1/files/${f.id}`);
    const row = await svc.findFile(f.id);
    expect(row?.mime).toBe('image/png');
    expect(Number(row?.size)).toBe(PNG.length);
    expect(row?.sha256).toHaveLength(64);
    const back = await svc.readFile(row!);
    expect(back?.equals(PNG)).toBe(true);
  });

  it('refuse un .svg et un fichier déguisé', async () => {
    await expect(svc.storeFile({ buffer: SVG, originalName: 'logo.svg', ownerType: 'loss' })).rejects.toThrow(/Format/);
    // Extension .png mais contenu SVG : refusé sur le contenu, pas sur le nom.
    await expect(svc.storeFile({ buffer: SVG, originalName: 'photo.png', ownerType: 'loss' })).rejects.toThrow(/Format/);
    // Un PDF n'est pas accepté là où seules les images le sont.
    await expect(svc.storeFile({ buffer: PDF, originalName: 'doc.pdf', ownerType: 'product' })).rejects.toThrow(/Format/);
    const n = (await p().query(`SELECT count(*)::int AS n FROM files WHERE original_name IN ('logo.svg','doc.pdf')`)).rows[0].n;
    expect(n).toBe(0);
  });

  it('une facture n\'est lisible que par la direction', async () => {
    const f = await svc.storeFile({ buffer: PDF, originalName: 'facture.pdf', ownerType: 'invoice', allowed: svc.DOCUMENT_MIMES, storeId: storeA });
    fileIds.push(f.id);
    const row = (await svc.findFile(f.id))!;
    expect(svc.canReadFile({ role: 'admin', storeId: storeA }, row)).toBe(true);
    expect(svc.canReadFile({ role: 'manager', storeId: storeA }, row)).toBe(true);
    expect(svc.canReadFile({ role: 'cashier', storeId: storeA }, row)).toBe(false);
    expect(svc.canReadFile({ role: 'baker', baseRoles: ['baker'], storeId: storeA }, row)).toBe(false);
  });

  it('refuse le fichier d\'un autre établissement', async () => {
    const f = await svc.storeFile({ buffer: PNG, originalName: 'perte.png', ownerType: 'loss', storeId: storeA });
    fileIds.push(f.id);
    const row = (await svc.findFile(f.id))!;
    expect(svc.canReadFile({ role: 'cashier', storeId: storeA }, row)).toBe(true);
    expect(svc.canReadFile({ role: 'cashier', storeId: storeB }, row)).toBe(false);
    expect(svc.canReadFile({ role: 'manager', storeId: storeB }, row)).toBe(false);
    expect(svc.canReadFile({ role: 'admin', storeId: storeB }, row)).toBe(true);
  });

  it('déduit file_id de l\'URL et rattache le fichier à son propriétaire', async () => {
    const f = await svc.storeFile({ buffer: PNG, originalName: 'produit.png', ownerType: 'product' });
    fileIds.push(f.id);
    await p().query(`UPDATE products SET image_url = $2 WHERE id = $1`, [productId, f.url]);
    const prod = (await p().query(`SELECT image_file_id FROM products WHERE id = $1`, [productId])).rows[0];
    expect(prod.image_file_id).toBe(f.id);
    expect((await svc.findFile(f.id))?.owner_id).toBe(productId);
    // Une ancienne URL /uploads ne porte pas de file_id.
    await p().query(`UPDATE products SET image_url = '/uploads/ancien.png' WHERE id = $1`, [productId]);
    expect((await p().query(`SELECT image_file_id FROM products WHERE id = $1`, [productId])).rows[0].image_file_id).toBeNull();
  });
});
