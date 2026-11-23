import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { invalidateWorkshops } from '../services/workshops.js';
import { invalidateProcessRefs } from '../services/process-referentials.js';
import { sectorRepository } from './sector.repository.js';

/**
 * Spécialisations (plan d'exécution multi-industries, étape 2, mig 633).
 *
 * Une spécialisation est un paquet CUMULABLE rattaché à un profil (boulangerie, pâtisserie,
 * viennoiserie… pour le profil Boulangerie & Pâtisserie) : un atelier, des types d'étape,
 * des capacités. L'activer n'ajoute que ce qui manque, n'écrase rien. La désactiver ne
 * supprime rien : l'atelier et les données restent, la spécialisation n'est plus cochée.
 *
 * Les métiers vivaient jusqu'ici dans les rôles (baker, pastry_chef…) ; la spécialisation
 * les porte désormais comme donnée, sans toucher aux droits (étape 3).
 */

export type SpecializationContent = {
  workshop?: { code: string; label: string; aliases?: string[] };
  step_types?: { code: string; label: string; metadata?: Record<string, unknown> }[];
  features?: string[];
};

export type Specialization = {
  code: string; sector_pack: string; label: string; description: string | null; sort_order: number;
  content: SpecializationContent; enabled: boolean; enabled_at: string | null;
  /** Le profil courant de la société propose-t-il cette spécialisation (lui ou un parent) ? */
  offered: boolean;
};

export type SpecializationResult = { workshops: number; stepTypes: number; features: string[] };

export const specializationRepository = {
  async list(): Promise<Specialization[]> {
    const current = await sectorRepository.current();
    const lineage = new Set(current.lineage ?? [current.code]);
    const { rows } = await db.query(
      `SELECT s.code, s.sector_pack, s.label, s.description, s.sort_order, s.content,
              (c.code IS NOT NULL) AS enabled, c.enabled_at
         FROM sector_specializations s
         LEFT JOIN company_specializations c ON c.code = s.code
        ORDER BY s.sort_order, s.label`);
    return rows.map(r => ({ ...r, offered: lineage.has(r.sector_pack) })) as Specialization[];
  },

  async active(): Promise<string[]> {
    const { rows } = await db.query(`SELECT code FROM company_specializations ORDER BY code`);
    return rows.map(r => r.code as string);
  },

  /** Active une spécialisation : atelier, types d'étape et capacités manquants seulement. */
  async enable(code: string, userId?: string | null): Promise<{ error: string } | SpecializationResult> {
    const { rows } = await db.query(`SELECT code, label, sector_pack, content FROM sector_specializations WHERE code = $1`, [code]);
    const spec = rows[0];
    if (!spec) return { error: 'Spécialisation inconnue' };
    const content = (spec.content ?? {}) as SpecializationContent;
    const result: SpecializationResult = { workshops: 0, stepTypes: 0, features: [] };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, userId);
      if (content.workshop) {
        const codes = [...new Set([content.workshop.code, ...(content.workshop.aliases ?? [])])];
        const exists = await client.query(`SELECT 1 FROM production_workshops WHERE code = ANY($1::text[]) LIMIT 1`, [codes]);
        if (!exists.rows[0]) {
          const order = (await client.query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM production_workshops`)).rows[0].n;
          await client.query(
            `INSERT INTO production_workshops (code, label, is_default, is_active, sort_order, updated_by, updated_at)
             VALUES ($1, $2, false, true, $3, $4, now()) ON CONFLICT (code) DO NOTHING`,
            [content.workshop.code, content.workshop.label, order, userId ?? null]);
          result.workshops = 1;
        } else {
          await client.query(
            `UPDATE production_workshops SET is_active = true, updated_by = $2, updated_at = now()
              WHERE code = ANY($1::text[]) AND NOT is_active`, [codes, userId ?? null]);
        }
      }
      for (const [i, t] of (content.step_types ?? []).entries()) {
        const r = await client.query(
          `INSERT INTO ref_entries (table_id, code, label, display_order, metadata)
           VALUES ('production_step_types', $1, $2, $3, $4)
           ON CONFLICT (table_id, code) DO NOTHING RETURNING id`,
          [t.code, t.label, 300 + i * 10, JSON.stringify(t.metadata ?? {})]);
        if (r.rows[0]) result.stepTypes++;
      }
      await client.query(
        `INSERT INTO company_specializations (code, enabled_by) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [code, userId ?? null]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
      invalidateWorkshops();
      invalidateProcessRefs();
    }

    // Capacités : par la voie normale (dépendances, version de configuration).
    const act = await sectorRepository.activation();
    const known = new Set(act.catalog.map(f => f.key));
    const missing = (content.features ?? []).filter(f => known.has(f) && !act.features.has(f));
    if (missing.length) {
      const r = await sectorRepository.applyAdjustments({ features: Object.fromEntries(missing.map(f => [f, true])) }, userId);
      if (!('error' in r)) result.features = missing;
    }
    return result;
  },

  /** Désactive une spécialisation : rien n'est supprimé (atelier, données, capacités). */
  async disable(code: string): Promise<{ error: string } | { ok: true }> {
    const { rows } = await db.query(`DELETE FROM company_specializations WHERE code = $1 RETURNING code`, [code]);
    if (!rows[0]) return { error: 'Spécialisation non active' };
    return { ok: true };
  },
};
