import type { Response, NextFunction } from 'express';
import { db } from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { hasPermission } from './permissions.js';
import { workshopsOf, workshopLabel } from './workshops.js';

/**
 * Atelier d'une fiche technique (scénario 1, constat 106, mig 620).
 *
 * Un chef ne modifie que les fiches de ses ateliers, comme pour les ordres de
 * fabrication (M2-06) ; « production.all_workshops » (administrateur, gérant) lève
 * la restriction. Atelier d'une fiche : celui de la catégorie de son produit (ou du
 * produit qu'elle remplace), à défaut celui de sa catégorie de production ; sans
 * l'un ni l'autre, la fiche est commune (préparations de base) et reste modifiable
 * par tout chef.
 */

const WORKSHOP_OF = `
  SELECT w.code
    FROM (SELECT $1::uuid AS product_id, $2::uuid AS category_id) x
    LEFT JOIN products p ON p.id = x.product_id
    LEFT JOIN production_workshop_categories pc ON pc.category_id = p.category_id
    LEFT JOIN production_workshop_recipe_categories rc ON rc.recipe_category_id = x.category_id
    JOIN production_workshops w ON w.code = COALESCE(pc.workshop_code, rc.workshop_code) AND w.is_active`;

/** Atelier d'un produit et d'une catégorie de fiche ; null = fiche commune. */
export async function workshopFor(productId: string | null, categoryId: string | null): Promise<string | null> {
  if (!productId && !categoryId) return null;
  return (await db.query(WORKSHOP_OF, [productId, categoryId])).rows[0]?.code ?? null;
}

type RecipeKeys = { productId: string | null; categoryId: string | null };

async function recipeKeys(recipeId: string): Promise<RecipeKeys | null> {
  const r = (await db.query(
    `SELECT COALESCE(product_id, alternative_for_product_id) AS product_id, category_id FROM recipes WHERE id = $1`,
    [recipeId])).rows[0];
  return r ? { productId: r.product_id, categoryId: r.category_id } : null;
}

/** Atelier d'une fiche ; null = fiche commune ou inconnue. */
export async function recipeWorkshop(recipeId: string): Promise<string | null> {
  const k = await recipeKeys(recipeId);
  return k ? workshopFor(k.productId, k.categoryId) : null;
}

type User = { userId: string; role: string; baseRoles?: string[] };

/** Ateliers dont l'utilisateur peut modifier les fiches ; 'all' = tous. */
export async function editableWorkshops(user: User): Promise<string[] | 'all'> {
  if (await hasPermission(user, 'production.all_workshops')) return 'all';
  return workshopsOf(user);
}

/** Vrai si l'utilisateur peut modifier la fiche. */
export async function canEditRecipe(user: User, recipeId: string): Promise<boolean> {
  const scope = await editableWorkshops(user);
  if (scope === 'all') return true;
  const ws = await recipeWorkshop(recipeId);
  return !ws || scope.includes(ws);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asId = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);

/** Fiche visée par la requête : paramètre :recipeId / :id, ou ligne rattachée. */
export type RecipeLocator = 'recipe' | 'format' | 'substitute' | 'output' | 'none';

async function locate(req: AuthRequest, by: RecipeLocator): Promise<string | null> {
  const p = req.params as Record<string, string | undefined>;
  const via = async (sql: string, v: unknown) => {
    const id = asId(v);
    return id ? ((await db.query(sql, [id])).rows[0]?.recipe_id as string | undefined) ?? null : null;
  };
  switch (by) {
    case 'recipe': return asId(p.recipeId ?? p.id);
    case 'format': return via(`SELECT recipe_id FROM recipe_formats WHERE id = $1`, p.formatId);
    case 'substitute': return via(`SELECT recipe_id FROM recipe_line_substitutes WHERE id = $1`, p.subId);
    case 'output': return via(`SELECT recipe_id FROM recipe_outputs WHERE id = $1`, p.outputId);
    default: return null;
  }
}

function forbid(res: Response, message: string) {
  res.status(403).json({ success: false, error: { code: 'WORKSHOP_FORBIDDEN', message } });
}

/**
 * Garde de route : la fiche visée (et, avec `body`, l'atelier où la requête la place :
 * produit ou catégorie envoyés) doit relever d'un atelier de l'utilisateur.
 */
export function recipeWorkshopGuard(by: RecipeLocator, opts: { body?: boolean } = {}) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) { next(); return; }
      const scope = await editableWorkshops(req.user);
      if (scope === 'all') { next(); return; }

      const recipeId = await locate(req, by);
      const current = recipeId ? await recipeKeys(recipeId) : null;
      if (current) {
        const ws = await workshopFor(current.productId, current.categoryId);
        if (ws && !scope.includes(ws)) {
          forbid(res, `Cette fiche relève de l'atelier ${await workshopLabel(ws)} : vous n'en êtes pas membre.`);
          return;
        }
      }
      if (opts.body) {
        const b = (req.body ?? {}) as Record<string, unknown>;
        const productId = 'productId' in b ? asId(b.productId) : current?.productId ?? null;
        const categoryId = 'categoryId' in b ? asId(b.categoryId) : current?.categoryId ?? null;
        const target = await workshopFor(productId, categoryId);
        if (target && !scope.includes(target)) {
          forbid(res, `Cette fiche relèverait de l'atelier ${await workshopLabel(target)} : vous n'en êtes pas membre.`);
          return;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
