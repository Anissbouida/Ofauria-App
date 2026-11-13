import type { Request, Response, NextFunction } from 'express';
import { db } from '../config/database.js';

/**
 * Unités de mesure libres (mig 515) : la liste vient du référentiel `units`
 * (Paramètres › Référentiels), plus la liste figée historique.
 *
 * Conversions : les vues de coût passent par fn_unit_conv, qui ne connaît que les
 * familles masse (mg/g/kg) et volume (ml/cl/dl/l). Pour une unité ajoutée (mètre,
 * m²…), une ligne de fiche doit donc être saisie DANS l'unité de stock de la
 * matière : sinon le coût serait faux (facteur 1) au lieu d'être converti. Les
 * couples historiques gardent leur comportement d'avant.
 */

/** Unités connues avant le référentiel (celles que fn_unit_conv et les écrans gèrent). */
const LEGACY_UNITS = ['mg', 'g', 'kg', 'ml', 'cl', 'dl', 'l', 'unit'];
const LEGACY = new Set(LEGACY_UNITS);

export type UnitEntry = { code: string; label: string; category: string | null };

const CACHE_MS = 30_000;
let cache: { at: number; units: UnitEntry[] } | null = null;

/** Unités actives du référentiel (ordre d'affichage). */
export async function activeUnits(): Promise<UnitEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.units;
  const { rows } = await db.query(
    `SELECT code, label, metadata->>'category' AS category FROM ref_entries
      WHERE table_id = 'units' AND is_active AND code IS NOT NULL
      ORDER BY display_order, label`);
  cache = { at: Date.now(), units: rows.map(r => ({ code: r.code, label: r.label, category: r.category ?? null })) };
  return cache.units;
}

export function invalidateUnits() { cache = null; }

/** Codes acceptés : référentiel actif + historiques. */
export async function knownUnitCodes(): Promise<Set<string>> {
  return new Set([...LEGACY_UNITS, ...(await activeUnits()).map(u => u.code)]);
}

/**
 * Une ligne saisie en `lineUnit` pour une matière stockée en `stockUnit` : null si
 * le coût sera juste, sinon le message à afficher.
 */
export function lineUnitError(lineUnit: string | null | undefined, stockUnit: string | null | undefined, name?: string): string | null {
  if (!lineUnit || !stockUnit || lineUnit === stockUnit) return null;
  if (LEGACY.has(lineUnit) && LEGACY.has(stockUnit)) return null;
  return `${name ? `« ${name} » : ` : ''}« ${lineUnit} » ne se convertit pas en « ${stockUnit} » (unité de stock). Saisissez la quantité en ${stockUnit}.`;
}

type UnitLine = { unit?: string | null; ingredientId?: string | null };

/**
 * Garde de route : refuse (400) une unité absente du référentiel, ou une ligne de
 * fiche dont l'unité ne se convertit pas dans l'unité de stock de sa matière.
 */
export function requireUnits(pick: (body: any) => UnitLine[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lines = pick(req.body ?? {}).filter(l => !!l.unit);
      if (!lines.length) { next(); return; }
      const fail = (message: string) => res.status(400).json({ success: false, error: { message } });

      const known = await knownUnitCodes();
      const unknown = [...new Set(lines.map(l => l.unit!).filter(u => !known.has(u)))];
      if (unknown.length) { fail(`Unité inconnue : ${unknown.join(', ')} (Paramètres › Référentiels › Unités de mesure)`); return; }

      const ids = [...new Set(lines.map(l => l.ingredientId).filter((x): x is string => !!x))];
      if (ids.length) {
        const { rows } = await db.query(`SELECT id, name, unit FROM ingredients WHERE id = ANY($1::uuid[])`, [ids]);
        const byId = new Map(rows.map(r => [r.id as string, r as { name: string; unit: string }]));
        for (const l of lines) {
          const ing = l.ingredientId ? byId.get(l.ingredientId) : undefined;
          const err = ing ? lineUnitError(l.unit, ing.unit, ing.name) : null;
          if (err) { fail(err); return; }
        }
      }
      next();
    } catch (err) { next(err); }
  };
}

/**
 * Garde de route (modification d'une matière) : changer l'unité de stock rendrait
 * fausses les lignes de fiche saisies dans une unité qui ne s'y convertit pas.
 */
export function requireStockUnitChange() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unit = (req.body ?? {}).unit as string | undefined;
      if (!unit) { next(); return; }
      const { rows } = await db.query(
        `SELECT l.unit FROM (
           SELECT unit FROM recipe_ingredients WHERE ingredient_id = $1
           UNION ALL SELECT unite FROM recipe_components WHERE source_ingredient_id = $1
         ) l GROUP BY l.unit`, [req.params.id]);
      const bad = rows.map(r => r.unit as string | null).filter(u => lineUnitError(u, unit) !== null);
      if (bad.length) {
        res.status(400).json({ success: false, error: { message:
          `Des fiches utilisent cette matière en ${bad.join(', ')}, qui ne se convertit pas en « ${unit} ». Modifiez d'abord ces lignes.` } });
        return;
      }
      next();
    } catch (err) { next(err); }
  };
}
