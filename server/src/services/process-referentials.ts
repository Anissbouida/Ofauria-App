import type { Request, Response, NextFunction } from 'express';
import { db } from '../config/database.js';

/**
 * Référentiels du procédé de fabrication (mig 513, plan Production générique P4) :
 * types d'étape, types d'équipement, paramètres de relevé. Remplacent les listes
 * figées (ETAPE_TYPES, CCP_STEP_TYPES, enum des équipements et des paramètres).
 * Éditables dans Paramètres › Référentiels ; cache court (une modification y est
 * visible en moins de 30 s).
 */
export type ProcessRefTable = 'production_step_types' | 'production_equipment_types' | 'process_reading_params' | 'scrap_reasons';

export type ProcessRefEntry = { code: string; label: string; color: string | null; isActive: boolean; metadata: Record<string, unknown> };

const CACHE_MS = 30_000;
let cache: { at: number; byTable: Map<string, ProcessRefEntry[]> } | null = null;

async function load(): Promise<Map<string, ProcessRefEntry[]>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.byTable;
  const { rows } = await db.query(
    `SELECT table_id, code, label, color, is_active, metadata FROM ref_entries
      WHERE table_id IN ('production_step_types', 'production_equipment_types', 'process_reading_params', 'scrap_reasons')
        AND code IS NOT NULL
      ORDER BY display_order, label`);
  const byTable = new Map<string, ProcessRefEntry[]>();
  for (const r of rows) {
    const list = byTable.get(r.table_id) ?? [];
    list.push({ code: r.code, label: r.label, color: r.color ?? null, isActive: r.is_active, metadata: r.metadata ?? {} });
    byTable.set(r.table_id, list);
  }
  cache = { at: Date.now(), byTable };
  return byTable;
}

export function invalidateProcessRefs() { cache = null; }

export async function processRefs(table: ProcessRefTable): Promise<ProcessRefEntry[]> {
  return (await load()).get(table) ?? [];
}

/** Codes inconnus ou inactifs parmi `values` (les valeurs vides sont ignorées). */
export async function unknownCodes(table: ProcessRefTable, values: (string | null | undefined)[]): Promise<string[]> {
  const active = new Set((await processRefs(table)).filter(e => e.isActive).map(e => e.code));
  return [...new Set(values.filter((v): v is string => !!v && !active.has(v)))];
}

/** Types d'étape « point critique » : l'étape ne se clôture pas sans relevé. */
export async function ccpStepTypes(): Promise<Set<string>> {
  return new Set((await processRefs('production_step_types')).filter(e => e.metadata.ccp === true).map(e => e.code));
}

/** Libellé + unité d'un paramètre de relevé. */
export async function readingParamMeta(code: string): Promise<{ label: string; unit: string }> {
  const e = (await processRefs('process_reading_params')).find(x => x.code === code);
  return { label: e?.label ?? code, unit: typeof e?.metadata.unit === 'string' ? e.metadata.unit : '' };
}

/** Message d'erreur commun : code absent du référentiel. */
export const unknownCodeMessage = (what: string, codes: string[]) =>
  `${what} inconnu${codes.length > 1 ? 's' : ''} : ${codes.join(', ')} (Paramètres › Référentiels)`;

/**
 * Garde de route : refuse (400) un corps dont les types d'étape ne sont pas dans le
 * référentiel. Le validateur zod (synchrone) ne vérifie que la forme.
 */
export function requireStepTypes(pick: (body: any) => (string | null | undefined)[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bad = await unknownCodes('production_step_types', pick(req.body));
      if (bad.length) { res.status(400).json({ success: false, error: { message: unknownCodeMessage("Type d'étape", bad) } }); return; }
      next();
    } catch (err) { next(err); }
  };
}

/**
 * Motifs de rebut (M6-03) : un code est accepté s'il est actif dans « scrap_reasons »,
 * directement ou comme ancien code (metadata.legacy) d'un motif actif, et, si un domaine
 * est donné, si le motif est déclaré pour ce domaine.
 */
export async function scrapReasonAllowed(code: string, domain?: string | null): Promise<boolean> {
  const hit = (await processRefs('scrap_reasons')).find(e => e.isActive
    && (e.code === code || (Array.isArray(e.metadata.legacy) && (e.metadata.legacy as string[]).includes(code))));
  if (!hit) return false;
  const domains = Array.isArray(hit.metadata.domains) ? hit.metadata.domains as string[] : [];
  return !domain || domains.length === 0 || domains.includes(domain);
}

/** Middleware : refuse en 400 un motif de rebut inconnu (au lieu d'une erreur base en 500). */
export const requireScrapReason = (pick: (body: any) => { code?: string | null; domain?: string | null }) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const { code, domain } = pick(req.body ?? {});
    if (code && !(await scrapReasonAllowed(code, domain))) {
      res.status(400).json({ success: false, error: { message: `Motif de rebut inconnu ou non prévu pour cet usage : ${code}` } });
      return;
    }
    next();
  };
