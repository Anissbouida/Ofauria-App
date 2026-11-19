import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { userRoleContext } from './access-rights.js';

/**
 * Ateliers de production (mig 511, plan Production générique, lot P2).
 *
 * Source UNIQUE de « quel atelier fabrique cette catégorie ? » et « à quels ateliers
 * appartient cet utilisateur ? ». Remplace les copies de CHEF_ROLES et de
 * ROLE_CATEGORY_SLUGS / CATEGORY_ROLE_MAP. Le code d'un atelier est ce que porte
 * production_plans.target_role (les 4 ateliers repris = codes des rôles chefs).
 */
export type Workshop = {
  code: string;
  label: string;
  workCenterId: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  categoryIds: number[];
  categorySlugs: string[];
  memberRoles: string[];
  memberUsers: string[];
};

export type WorkshopUser = { userId: string; role: string; baseRoles?: string[] };

// Lu à chaque plan / notification : cache court, vidé à chaque modification.
const CACHE_MS = 30_000;
let cache: { at: number; list: Workshop[] } | null = null;

export async function listWorkshops(): Promise<Workshop[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  const [ws, cats, members] = await Promise.all([
    db.query(`SELECT code, label, work_center_id, is_default, is_active, sort_order FROM production_workshops ORDER BY sort_order, label`),
    db.query(`SELECT wc.workshop_code, c.id, c.slug FROM production_workshop_categories wc JOIN categories c ON c.id = wc.category_id`),
    db.query(`SELECT workshop_code, role_code, user_id FROM production_workshop_members`),
  ]);
  const list: Workshop[] = ws.rows.map(r => ({
    code: r.code, label: r.label, workCenterId: r.work_center_id, isDefault: r.is_default, isActive: r.is_active,
    sortOrder: r.sort_order, categoryIds: [], categorySlugs: [], memberRoles: [], memberUsers: [],
  }));
  const byCode = new Map(list.map(w => [w.code, w]));
  for (const c of cats.rows) {
    const w = byCode.get(c.workshop_code);
    if (w) { w.categoryIds.push(c.id); if (c.slug) w.categorySlugs.push(c.slug); }
  }
  for (const m of members.rows) {
    const w = byCode.get(m.workshop_code);
    if (!w) continue;
    if (m.role_code) w.memberRoles.push(m.role_code); else if (m.user_id) w.memberUsers.push(m.user_id);
  }
  cache = { at: Date.now(), list };
  return list;
}

export function invalidateWorkshops() { cache = null; }

/** Atelier (actif) qui fabrique une catégorie, par slug ; null si aucun. */
export async function workshopForCategorySlug(slug: string | null | undefined): Promise<string | null> {
  if (!slug) return null;
  const w = (await listWorkshops()).find(x => x.isActive && x.categorySlugs.includes(slug));
  return w?.code ?? null;
}

/** Atelier par défaut (reçoit ce qui n'est rattaché à aucun atelier). */
export async function defaultWorkshop(): Promise<string | null> {
  return (await listWorkshops()).find(w => w.isActive && w.isDefault)?.code ?? null;
}

/**
 * Ateliers (actifs) dont l'utilisateur est membre, par rôle ou nominativement.
 *
 * La session ne porte que les rôles de BASE (le jeton met le rôle de base principal dans
 * `role`). Un rôle créé dans Utilisateurs › Rôles — « Chef Beldi », base `beldi_sale` — n'y
 * figure donc pas, alors que l'écran des ateliers le propose comme membre. On compare donc
 * aussi les rôles réellement attribués à l'utilisateur (délégations en cours comprises),
 * lus en base seulement si un atelier a pour membre un rôle absent de la session.
 * Un rôle livré déclaré membre couvre toujours les rôles créés à partir de lui.
 */
export async function workshopsOf(user: WorkshopUser): Promise<string[]> {
  const active = (await listWorkshops()).filter(w => w.isActive);
  const roles = new Set([user.role, ...(user.baseRoles ?? [])]);
  if (active.some(w => w.memberRoles.some(r => !roles.has(r)))) {
    for (const code of (await userRoleContext(user.userId)).roleCodes) roles.add(code);
  }
  return active
    .filter(w => w.memberUsers.includes(user.userId) || w.memberRoles.some(r => roles.has(r)))
    .map(w => w.code);
}

/** Libellé d'un atelier (repli : le code ; null = « Général »). */
export async function workshopLabel(code: string | null | undefined): Promise<string> {
  if (!code) return 'Général';
  return (await listWorkshops()).find(w => w.code === code)?.label ?? code;
}

export type WorkshopInput = {
  label: string;
  workCenterId: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  categoryIds: number[];
  memberRoles: string[];
  memberUsers: string[];
};

/**
 * Crée ou modifie un atelier (transaction, journal du paramétrage). Une catégorie ne
 * relève que d'un atelier : la cocher ici la retire de l'atelier qui la portait.
 */
export async function saveWorkshop(code: string, input: WorkshopInput, userId?: string | null): Promise<void> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await setAuditUser(client, userId);
    if (input.isDefault) await client.query(`UPDATE production_workshops SET is_default = false WHERE is_default AND code <> $1`, [code]);
    await client.query(
      `INSERT INTO production_workshops (code, label, work_center_id, is_default, is_active, sort_order, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, work_center_id = EXCLUDED.work_center_id,
         is_default = EXCLUDED.is_default, is_active = EXCLUDED.is_active, sort_order = EXCLUDED.sort_order,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [code, input.label, input.workCenterId, input.isDefault, input.isActive, input.sortOrder, userId ?? null]);

    const cur = await client.query(`SELECT category_id FROM production_workshop_categories WHERE workshop_code = $1`, [code]);
    const had = new Set<number>(cur.rows.map(r => r.category_id));
    const want = new Set(input.categoryIds);
    for (const id of had) if (!want.has(id)) await client.query(`DELETE FROM production_workshop_categories WHERE category_id = $1`, [id]);
    for (const id of want) {
      if (had.has(id)) continue;
      await client.query(
        `INSERT INTO production_workshop_categories (category_id, workshop_code) VALUES ($1, $2)
         ON CONFLICT (category_id) DO UPDATE SET workshop_code = EXCLUDED.workshop_code`, [id, code]);
    }

    const mem = await client.query(`SELECT role_code, user_id FROM production_workshop_members WHERE workshop_code = $1`, [code]);
    const roles = new Set(input.memberRoles), users = new Set(input.memberUsers);
    for (const m of mem.rows) {
      if (m.role_code && !roles.has(m.role_code)) await client.query(`DELETE FROM production_workshop_members WHERE workshop_code = $1 AND role_code = $2`, [code, m.role_code]);
      if (m.user_id && !users.has(m.user_id)) await client.query(`DELETE FROM production_workshop_members WHERE workshop_code = $1 AND user_id = $2`, [code, m.user_id]);
    }
    const hadRoles = new Set(mem.rows.map(m => m.role_code).filter(Boolean));
    const hadUsers = new Set(mem.rows.map(m => m.user_id).filter(Boolean));
    for (const r of roles) if (!hadRoles.has(r)) await client.query(`INSERT INTO production_workshop_members (workshop_code, role_code) VALUES ($1, $2)`, [code, r]);
    for (const u of users) if (!hadUsers.has(u)) await client.query(`INSERT INTO production_workshop_members (workshop_code, user_id) VALUES ($1, $2)`, [code, u]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    invalidateWorkshops();
  }
}
