/**
 * Scénarios réalistes — GESTION DES UTILISATEURS / DROITS (tests purs, sans base).
 *
 * On joue des parcours « admin + rôles métier » (gérant, caissier, magasinier,
 * chefs) à travers les briques d'autorisation réelles :
 *   - authorize(...)              : garde par groupe de rôles (role.middleware.ts) ;
 *   - rôles multiples (mig 335)   : baseRoles sur le jeton ;
 *   - effectiveScope/scopeStoreFilter : portée des données (access-rules.ts) ;
 *   - getCategoryRole / getRoleCategorySlugs : routage catégorie -> chef (roles.ts) ;
 *   - authorizeModule             : droits par module (module.middleware.ts), avec
 *                                   effectiveRights/enforcementMode simulés.
 *
 * Seule la LECTURE des droits en base est simulée (vi.mock access-rights.js) : la
 * règle de décision (hasRight) reste la vraie. Les assertions décrivent le
 * comportement ATTENDU correct ; tout écart réel est signalé en CONSTAT.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// env posé avant tout import de module serveur (sinon env.ts/config lève à l'import).
process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

// La lecture des droits est simulée ; la logique de décision reste réelle.
vi.mock('../services/access-rights.js', () => ({
  effectiveRights: vi.fn(),
  enforcementMode: vi.fn(),
}));

import { authorize } from '../middleware/role.middleware.js';
import { authorizeModule } from '../middleware/module.middleware.js';
import { effectiveScope, scopeStoreFilter } from '../services/access-rules.js';
import type { EffectiveRights } from '../services/access-rules.js';
import { effectiveRights } from '../services/access-rights.js';
import {
  ROLES,
  ROLE_GROUPS,
  getCategoryRole,
  getRoleCategorySlugs,
} from '@ofauria/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Helpers de simulation req/res/next ──────────────────────────────────
function fakeCtx(user: any) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res: any = { status, json };
  const next = vi.fn();
  const req: any = { user };
  return { req, res, next, status, json };
}

/** Joue authorize(...groupe) pour un jeton donné. */
function runAuthorize(groupe: readonly string[], user: any) {
  const { req, res, next, status, json } = fakeCtx(user);
  authorize(...(groupe as any))(req, res, next);
  return { next, status, json, res };
}

// ──────────────────────────────────────────────────────────────────────────
// 1. authorize(...) — chaque rôle sur chaque groupe
// ──────────────────────────────────────────────────────────────────────────
describe('authorize() — matrice rôle × groupe', () => {
  const groupes: Record<string, readonly string[]> = {
    ADMIN: ROLE_GROUPS.ADMIN,
    ADMIN_MANAGER: ROLE_GROUPS.ADMIN_MANAGER,
    CASH: ROLE_GROUPS.CASH,
    SALES: ROLE_GROUPS.SALES,
    PRODUCTION: ROLE_GROUPS.PRODUCTION,
    CHEFS: ROLE_GROUPS.CHEFS,
    WAREHOUSE: ROLE_GROUPS.WAREHOUSE,
  };
  const tousRoles = Object.values(ROLES);

  // La matrice attendue = le rôle appartient-il au groupe (source de vérité : roles.ts).
  for (const [nomGroupe, groupe] of Object.entries(groupes)) {
    describe(`groupe ${nomGroupe}`, () => {
      for (const role of tousRoles) {
        const attendu = (groupe as string[]).includes(role);
        it(`${role} ${attendu ? 'accède' : 'refusé (403)'}`, () => {
          const { next, status } = runAuthorize(groupe, { userId: 'u1', role });
          if (attendu) {
            expect(next).toHaveBeenCalledOnce();
            expect(status).not.toHaveBeenCalled();
          } else {
            expect(next).not.toHaveBeenCalled();
            expect(status).toHaveBeenCalledWith(403);
          }
        });
      }
    });
  }

  it('sans utilisateur -> 401 (non authentifié)', () => {
    const { req, res, next, status, json } = fakeCtx(undefined);
    authorize(...(ROLE_GROUPS.ADMIN as any))(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ message: 'Non authentifié' }) }),
    );
  });

  it('hors groupe -> 403 avec message « Accès interdit »', () => {
    const { json } = runAuthorize(ROLE_GROUPS.ADMIN, { userId: 'u1', role: ROLES.CASHIER });
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ message: 'Accès interdit' }) }),
    );
  });

  // Quelques parcours métier explicites (lecture humaine de la matrice).
  it('le gérant passe ADMIN_MANAGER, PRODUCTION, CASH, SALES, WAREHOUSE mais pas ADMIN', () => {
    const m = { userId: 'u', role: ROLES.MANAGER };
    expect(runAuthorize(ROLE_GROUPS.ADMIN_MANAGER, m).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, m).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.CASH, m).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.SALES, m).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, m).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.ADMIN, m).status).toHaveBeenCalledWith(403);
  });

  it('le caissier passe CASH/SALES mais ni PRODUCTION ni WAREHOUSE ni ADMIN_MANAGER', () => {
    const c = { userId: 'u', role: ROLES.CASHIER };
    expect(runAuthorize(ROLE_GROUPS.CASH, c).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.SALES, c).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, c).status).toHaveBeenCalledWith(403);
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, c).status).toHaveBeenCalledWith(403);
    expect(runAuthorize(ROLE_GROUPS.ADMIN_MANAGER, c).status).toHaveBeenCalledWith(403);
  });

  it('la vendeuse passe SALES mais pas CASH (ni caisse ni production)', () => {
    const v = { userId: 'u', role: ROLES.SALESWOMAN };
    expect(runAuthorize(ROLE_GROUPS.SALES, v).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.CASH, v).status).toHaveBeenCalledWith(403);
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, v).status).toHaveBeenCalledWith(403);
  });

  it('un chef (boulanger) passe PRODUCTION et CHEFS mais pas WAREHOUSE ni CASH', () => {
    const b = { userId: 'u', role: ROLES.BAKER };
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, b).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.CHEFS, b).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, b).status).toHaveBeenCalledWith(403);
    expect(runAuthorize(ROLE_GROUPS.CASH, b).status).toHaveBeenCalledWith(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Réception BC (F-006) : le magasinier reçoit, le caissier non
// ──────────────────────────────────────────────────────────────────────────
describe('Réception BC (F-006) — WAREHOUSE', () => {
  it('le magasinier confirme la réception (WAREHOUSE accordé)', () => {
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, { userId: 'u', role: ROLES.MAGASINIER }).next).toHaveBeenCalled();
  });
  it('le caissier ne peut pas recevoir un BC (403)', () => {
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, { userId: 'u', role: ROLES.CASHIER }).status).toHaveBeenCalledWith(403);
  });
  it('gérant et admin reçoivent aussi (couverts par WAREHOUSE)', () => {
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, { userId: 'u', role: ROLES.MANAGER }).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, { userId: 'u', role: ROLES.ADMIN }).next).toHaveBeenCalled();
  });
  it('un chef ne reçoit PAS le BC mais accepte la réception BSI (PRODUCTION)', () => {
    // Réception BC = livraison fournisseur (magasinier) ; accept-reception BSI = chef.
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, { userId: 'u', role: ROLES.PASTRY_CHEF }).status).toHaveBeenCalledWith(403);
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, { userId: 'u', role: ROLES.PASTRY_CHEF }).next).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Rôles multiples (mig 335) — baseRoles
// ──────────────────────────────────────────────────────────────────────────
describe('authorize() — rôles multiples (mig 335, baseRoles)', () => {
  it('accordé si UN des baseRoles figure dans le groupe (caissier+magasinier -> WAREHOUSE)', () => {
    const u = { userId: 'u', role: ROLES.CASHIER, baseRoles: [ROLES.CASHIER, ROLES.MAGASINIER] };
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, u).next).toHaveBeenCalled();
    // et toujours accès caisse par l'autre rôle
    expect(runAuthorize(ROLE_GROUPS.CASH, u).next).toHaveBeenCalled();
  });

  it('refusé si AUCUN baseRole ne figure dans le groupe', () => {
    const u = { userId: 'u', role: ROLES.CASHIER, baseRoles: [ROLES.CASHIER, ROLES.SALESWOMAN] };
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, u).status).toHaveBeenCalledWith(403);
    expect(runAuthorize(ROLE_GROUPS.WAREHOUSE, u).status).toHaveBeenCalledWith(403);
  });

  it('baseRoles vide -> repli sur le rôle principal (anciens jetons)', () => {
    const u = { userId: 'u', role: ROLES.MANAGER, baseRoles: [] };
    expect(runAuthorize(ROLE_GROUPS.ADMIN_MANAGER, u).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.ADMIN, u).status).toHaveBeenCalledWith(403);
  });

  it('baseRoles absent -> repli sur le rôle principal', () => {
    const u = { userId: 'u', role: ROLES.BAKER };
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, u).next).toHaveBeenCalled();
  });

  it('cumul chef pâtissier + boulanger : PRODUCTION et CHEFS via l\'un ou l\'autre', () => {
    const u = { userId: 'u', role: ROLES.PASTRY_CHEF, baseRoles: [ROLES.PASTRY_CHEF, ROLES.BAKER] };
    expect(runAuthorize(ROLE_GROUPS.PRODUCTION, u).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.CHEFS, u).next).toHaveBeenCalled();
    expect(runAuthorize(ROLE_GROUPS.ADMIN, u).status).toHaveBeenCalledWith(403);
  });

  it('un rôle admin présent dans baseRoles donne accès à ADMIN', () => {
    const u = { userId: 'u', role: ROLES.MANAGER, baseRoles: [ROLES.MANAGER, ROLES.ADMIN] };
    expect(runAuthorize(ROLE_GROUPS.ADMIN, u).next).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Portée des données — effectiveScope / scopeStoreFilter
// ──────────────────────────────────────────────────────────────────────────
describe('effectiveScope — portée des données par module', () => {
  const rights = (over: Partial<EffectiveRights>): EffectiveRights => ({
    roleCode: 'x', baseRole: 'x', roles: ['x'], baseRoles: ['x'],
    isAdmin: false, source: 'role', rows: [], ...over,
  });
  const row = (module: string, scope?: string) => ({
    module, can_view: true, can_create: false, can_edit: false, can_delete: false,
    config: scope ? { scope } : {},
  });

  it('admin -> « all » quel que soit le module', () => {
    expect(effectiveScope(rights({ isAdmin: true }), 'sales')).toBe('all');
    expect(effectiveScope(rights({ isAdmin: true }), 'inconnu')).toBe('all');
  });

  it('droit sans portée -> « store » (isolation par établissement par défaut)', () => {
    expect(effectiveScope(rights({ rows: [row('sales')] }), 'sales')).toBe('store');
  });

  it('module non couvert par un droit -> défaut « store »', () => {
    expect(effectiveScope(rights({ rows: [row('pos')] }), 'sales')).toBe('store');
  });

  it('config.scope = « own » respecté', () => {
    expect(effectiveScope(rights({ rows: [row('sales', 'own')] }), 'sales')).toBe('own');
  });

  it('config.scope = « all » respecté', () => {
    expect(effectiveScope(rights({ rows: [row('sales', 'all')] }), 'sales')).toBe('all');
  });

  it('plusieurs droits sur le module -> le plus permissif gagne (own < store < all)', () => {
    const r = rights({ rows: [row('sales', 'own'), row('sales', 'all')] });
    expect(effectiveScope(r, 'sales')).toBe('all');
    const r2 = rights({ rows: [row('sales', 'own'), row('sales', 'store')] });
    expect(effectiveScope(r2, 'sales')).toBe('store');
  });

  it('résolution par alias de module (stock <-> economat/inventory)', () => {
    // Un droit sur « economat » couvre le module canonique « stock » et inversement.
    expect(effectiveScope(rights({ rows: [row('economat', 'all')] }), 'stock')).toBe('all');
    expect(effectiveScope(rights({ rows: [row('stock', 'own')] }), 'inventory')).toBe('own');
  });
});

describe('scopeStoreFilter — traduction portée -> filtre de requête', () => {
  it('« all » : aucun filtre', () => {
    expect(scopeStoreFilter('all', 'store-1', 'user-1')).toEqual({});
  });
  it('« store » : limité à l\'établissement', () => {
    expect(scopeStoreFilter('store', 'store-1', 'user-1')).toEqual({ storeId: 'store-1' });
  });
  it('« own » : limité au créateur (createdBy)', () => {
    expect(scopeStoreFilter('own', 'store-1', 'user-1')).toEqual({ createdBy: 'user-1' });
  });
  it('« store » sans storeId -> storeId undefined (le contrôleur n\'ajoute aucune contrainte)', () => {
    expect(scopeStoreFilter('store')).toEqual({ storeId: undefined });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Routage catégorie -> rôle chef (getCategoryRole / getRoleCategorySlugs)
// ──────────────────────────────────────────────────────────────────────────
describe('getCategoryRole — routage catégorie vers le chef responsable', () => {
  it('boulangerie -> baker', () => {
    expect(getCategoryRole('baguette')).toBe('baker');
    expect(getCategoryRole('baguette-tradition')).toBe('baker');
    expect(getCategoryRole('pain-rond')).toBe('baker');
    expect(getCategoryRole('pain-sandwich')).toBe('baker');
  });
  it('viennoiseries -> viennoiserie', () => {
    expect(getCategoryRole('viennoiseries')).toBe('viennoiserie');
  });
  it('pâtisserie / entremets / cake-et-muffins -> pastry_chef (F-023)', () => {
    expect(getCategoryRole('patisserie-classique')).toBe('pastry_chef');
    expect(getCategoryRole('patisserie-premium')).toBe('pastry_chef');
    expect(getCategoryRole('entremets')).toBe('pastry_chef');
    expect(getCategoryRole('cake-et-muffins')).toBe('pastry_chef');
    expect(getCategoryRole('gateaux-cookies')).toBe('pastry_chef');
    expect(getCategoryRole('macaron')).toBe('pastry_chef');
  });
  it('beldi / salé -> beldi_sale', () => {
    expect(getCategoryRole('beldi')).toBe('beldi_sale');
    expect(getCategoryRole('sale')).toBe('beldi_sale');
    expect(getCategoryRole('sale-soiree')).toBe('beldi_sale');
  });
  it('catégorie inconnue -> general (traitée par le gérant)', () => {
    expect(getCategoryRole('categorie-bidon')).toBe('general');
    expect(getCategoryRole('')).toBe('general');
  });
});

describe('getRoleCategorySlugs — catégories visibles par rôle', () => {
  it('un chef ne voit que ses catégories', () => {
    expect(getRoleCategorySlugs('baker')).toEqual(['baguette', 'baguette-tradition', 'pain-rond', 'pain-sandwich']);
    expect(getRoleCategorySlugs('viennoiserie')).toEqual(['viennoiseries']);
    expect(getRoleCategorySlugs('beldi_sale')).toContain('beldi');
  });
  it('admin / gérant / caissier / vendeuse voient TOUT (null)', () => {
    expect(getRoleCategorySlugs('admin')).toBeNull();
    expect(getRoleCategorySlugs('manager')).toBeNull();
    expect(getRoleCategorySlugs('cashier')).toBeNull();
    expect(getRoleCategorySlugs('saleswoman')).toBeNull();
  });
  it('cohérence aller-retour : chaque slug d\'un chef reroute vers ce chef', () => {
    for (const role of ['baker', 'viennoiserie', 'pastry_chef', 'beldi_sale']) {
      for (const slug of getRoleCategorySlugs(role) ?? []) {
        expect(getCategoryRole(slug)).toBe(role);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. authorizeModule — droits par module (effectiveRights simulé)
// ──────────────────────────────────────────────────────────────────────────
describe('authorizeModule — droits par module', () => {
  const rightsMock = effectiveRights as unknown as ReturnType<typeof vi.fn>;
  const asRole = (rows: Record<string, unknown>[], isAdmin = false) =>
    rightsMock.mockResolvedValue({
      roleCode: 'x', baseRole: 'x', roles: ['x'], baseRoles: ['x'],
      isAdmin, source: isAdmin ? 'admin' : 'role',
      rows: rows.map(r => ({ can_view: false, can_create: false, can_edit: false, can_delete: false, config: {}, ...r })),
    });
  const run = async (role: string, module: any, action: any) => {
    const { req, res, next, status } = fakeCtx({ userId: 'u1', role });
    await authorizeModule(module, action)(req as any, res as any, next);
    return { next, status };
  };
  beforeEach(() => rightsMock.mockReset());

  it('admin : toujours autorisé, sans lecture des droits', async () => {
    const { next } = await run('admin', 'employees', 'delete');
    expect(next).toHaveBeenCalledOnce();
    expect(rightsMock).not.toHaveBeenCalled();
  });

  it('rôle AVEC le module accordé : passe (view/edit) mais pas l\'action non accordée (create)', async () => {
    asRole([{ module: 'employees', can_view: true, can_edit: true }]);
    expect((await run('manager', 'employees', 'view')).next).toHaveBeenCalled();
    expect((await run('manager', 'employees', 'edit')).next).toHaveBeenCalled();
    const create = await run('manager', 'employees', 'create');
    expect(create.next).not.toHaveBeenCalled();
    expect(create.status).toHaveBeenCalledWith(403);
  });

  it('rôle SANS le module : refusé (403)', async () => {
    asRole([{ module: 'pos', can_view: true, can_create: true, can_edit: true, can_delete: true }]);
    expect((await run('cashier', 'employees', 'view')).status).toHaveBeenCalledWith(403);
  });

  it('résolution par alias : un droit « economat » autorise le module « stock »', async () => {
    asRole([{ module: 'economat', can_view: true }]);
    expect((await run('magasinier', 'stock', 'view')).next).toHaveBeenCalled();
  });
});
