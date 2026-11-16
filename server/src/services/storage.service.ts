import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * G0-04 (plan d'action 2026-11) — stockage des fichiers téléversés.
 *
 * Le contenu ne vit plus sur le disque du serveur (éphémère sur Cloud Run) mais
 * dans un stockage objet, derrière une interface à deux pilotes :
 *   - `local` (développement, tests) : dossier STORAGE_LOCAL_DIR, hors de /uploads ;
 *   - `gcs`   (production) : bucket PRIVÉ STORAGE_BUCKET, via l'API JSON de Cloud
 *     Storage et le jeton du compte de service de Cloud Run (aucune dépendance).
 *
 * Chaque fichier a une ligne dans `files` (mig 521). Il est lu par
 * GET /api/v1/files/:id, authentifié, qui renvoie le contenu en flux : aucune
 * URL publique n'existe.
 *
 *   STORAGE_DRIVER = local | gcs   (défaut : local)
 *   STORAGE_BUCKET = nom du bucket (obligatoire si gcs)
 *   STORAGE_LOCAL_DIR = dossier du pilote local (défaut : <dépôt>/storage)
 */

export interface StorageDriver {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** URL signée de courte durée, ou null si le pilote sert le contenu par le serveur. */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;
}

// ─── Pilote local ────────────────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));

export function localDriver(root = process.env.STORAGE_LOCAL_DIR || path.resolve(here, '../../../storage')): StorageDriver {
  const full = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('Clé de stockage invalide');
    return p;
  };
  return {
    async put(key, data) {
      const p = full(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, data);
    },
    async get(key) {
      try { return await fs.readFile(full(key)); } catch { return null; }
    },
    async delete(key) {
      await fs.rm(full(key), { force: true });
    },
    async signedUrl() { return null; },
  };
}

// ─── Pilote Cloud Storage (API JSON, jeton du serveur de métadonnées) ──
let cachedToken: { value: string; expiresAt: number } | null = null;
async function gcpAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!r.ok) throw new Error(`Jeton du compte de service indisponible (${r.status})`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export function gcsDriver(bucket = process.env.STORAGE_BUCKET || ''): StorageDriver {
  if (!bucket) throw new Error('STORAGE_BUCKET doit être défini quand STORAGE_DRIVER=gcs');
  const obj = (key: string) => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`;
  const auth = async () => ({ Authorization: `Bearer ${await gcpAccessToken()}` });
  return {
    async put(key, data, mime) {
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
      const r = await fetch(url, { method: 'POST', headers: { ...(await auth()), 'Content-Type': mime }, body: new Uint8Array(data) });
      if (!r.ok) throw new Error(`Écriture dans le bucket refusée (${r.status})`);
    },
    async get(key) {
      const r = await fetch(`${obj(key)}?alt=media`, { headers: await auth() });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Lecture du bucket refusée (${r.status})`);
      return Buffer.from(await r.arrayBuffer());
    },
    async delete(key) {
      const r = await fetch(obj(key), { method: 'DELETE', headers: await auth() });
      if (!r.ok && r.status !== 404) throw new Error(`Suppression dans le bucket refusée (${r.status})`);
    },
    // Signer une URL demande la clé privée du compte de service : le contenu est
    // servi en flux par la route authentifiée, ce qui tient la même promesse.
    async signedUrl() { return null; },
  };
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) {
    const kind = process.env.STORAGE_DRIVER || 'local';
    if (kind !== 'gcs' && process.env.NODE_ENV === 'production') {
      // Disque éphémère sur Cloud Run : les fichiers disparaîtraient à la prochaine révision.
      logger.warn('[storage] STORAGE_DRIVER=local en production : les fichiers téléversés ne survivront pas à un redéploiement. Définir STORAGE_DRIVER=gcs et STORAGE_BUCKET.');
    }
    driver = kind === 'gcs' ? gcsDriver() : localDriver();
  }
  return driver;
}
/** Tests : substitue le pilote. */
export function setStorageDriver(d: StorageDriver | null) { driver = d; }

// ─── Type réel du fichier (premiers octets) ──────────────────────────
export type SniffedType = { mime: string; ext: string };

/** Reconnaît PNG, JPEG, WebP, GIF et PDF par leurs premiers octets ; null sinon (dont SVG). */
export function sniffType(buf: Buffer): SniffedType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return { mime: 'image/gif', ext: '.gif' };
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  return null;
}

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const DOCUMENT_MIMES = ['application/pdf', ...IMAGE_MIMES] as const;

export class FileRejectedError extends Error {
  status = 400;
}

// ─── Enregistrement et lecture ───────────────────────────────────────
export type FileOwnerType = 'invoice' | 'product' | 'loss' | 'complaint' | 'maintenance' | 'payment' | 'generic';

export interface StoredFile {
  id: string;
  /** URL à stocker dans la colonne d'URL de l'objet propriétaire. */
  url: string;
  mime: string;
  size: number;
}

export interface FileRow {
  id: string; bucket_key: string; original_name: string; mime: string; size: string;
  sha256: string; owner_type: string; owner_id: string | null; store_id: string | null;
  uploaded_by: string | null; deleted_at: string | null;
}

export const fileUrl = (id: string) => `/api/v1/files/${id}`;

export async function storeFile(input: {
  buffer: Buffer; originalName: string;
  ownerType: FileOwnerType; ownerId?: string | null;
  storeId?: string | null; uploadedBy?: string | null;
  /** Types acceptés pour ce téléversement (défaut : images). */
  allowed?: readonly string[];
}): Promise<StoredFile> {
  const sniffed = sniffType(input.buffer);
  const allowed = input.allowed ?? IMAGE_MIMES;
  if (!sniffed || !allowed.includes(sniffed.mime)) {
    throw new FileRejectedError('Format de fichier non accepté (le contenu ne correspond pas à un format autorisé).');
  }
  const id = crypto.randomUUID();
  const now = new Date();
  const key = `${input.ownerType}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}${sniffed.ext}`;
  const sha = crypto.createHash('sha256').update(input.buffer).digest('hex');
  await storage().put(key, input.buffer, sniffed.mime);
  try {
    await db.query(
      `INSERT INTO files (id, bucket_key, original_name, mime, size, sha256, owner_type, owner_id, store_id, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, key, path.basename(input.originalName || 'fichier').slice(0, 255), sniffed.mime, input.buffer.length, sha,
       input.ownerType, input.ownerId ?? null, input.storeId ?? null, input.uploadedBy ?? null]);
  } catch (err) {
    await storage().delete(key).catch(() => undefined);
    throw err;
  }
  return { id, url: fileUrl(id), mime: sniffed.mime, size: input.buffer.length };
}

export async function findFile(id: string): Promise<FileRow | null> {
  return (await db.query(`SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0] ?? null;
}

export async function readFile(row: Pick<FileRow, 'bucket_key'>): Promise<Buffer | null> {
  return storage().get(row.bucket_key);
}

/**
 * Droit de lecture sur l'objet propriétaire.
 *  - factures fournisseurs et pièces de règlement : direction (admin, gérant) ;
 *  - le reste (photos de produits, de pertes, de réclamations, de maintenance) :
 *    tout utilisateur connecté ;
 *  - un fichier rattaché à un établissement n'est pas lisible depuis un autre,
 *    sauf par l'administrateur.
 */
export function canReadFile(user: { role: string; baseRoles?: string[]; storeId?: string | null }, file: Pick<FileRow, 'owner_type' | 'store_id'>): boolean {
  const roles = new Set([user.role, ...(user.baseRoles ?? [])]);
  const isAdmin = roles.has('admin');
  if ((file.owner_type === 'invoice' || file.owner_type === 'payment') && !isAdmin && !roles.has('manager')) return false;
  if (file.store_id && user.storeId && file.store_id !== user.storeId && !isAdmin) return false;
  return true;
}
