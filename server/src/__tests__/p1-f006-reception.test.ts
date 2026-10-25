/**
 * F-006 — Le magasinier peut consulter un BC et confirmer sa reception.
 *
 * Les routes GET /purchase-orders/:id et POST /purchase-orders/:id/confirm-delivery
 * etaient gardees par authorize(...ROLE_GROUPS.ADMIN_MANAGER) : le magasinier,
 * qui recoit pourtant physiquement la livraison, recevait un 403 « Acces
 * interdit ». Elles sont desormais gardees par ROLE_GROUPS.WAREHOUSE
 * (admin + gerant + magasinier). La creation / validation / annulation des BC
 * reste reservee a ADMIN_MANAGER.
 *
 * Test de la politique d'autorisation (middleware authorize, pur, sans DB) :
 * c'est la garde que ces deux routes appliquent maintenant.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import { authorize } from '../middleware/role.middleware.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

/** Joue le middleware avec un utilisateur (role principal ou baseRoles multiples). */
function run(roles: string[], user: { role?: string; baseRoles?: string[] }) {
  const req = { user } as unknown as AuthRequest;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  const next = vi.fn();
  authorize(...(roles as never[]))(req, res, next as NextFunction);
  return { status, next };
}

describe('F-006 — reception BC : garde WAREHOUSE', () => {
  it('WAREHOUSE laisse passer le magasinier (consultation + reception)', () => {
    const { status, next } = run(ROLE_GROUPS.WAREHOUSE, { role: ROLES.MAGASINIER });
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('WAREHOUSE laisse toujours passer admin et gerant (pas de regression)', () => {
    expect(run(ROLE_GROUPS.WAREHOUSE, { role: ROLES.ADMIN }).next).toHaveBeenCalledTimes(1);
    expect(run(ROLE_GROUPS.WAREHOUSE, { role: ROLES.MANAGER }).next).toHaveBeenCalledTimes(1);
  });

  it('WAREHOUSE refuse les roles non concernes (caissier, boulanger)', () => {
    for (const role of [ROLES.CASHIER, ROLES.BAKER]) {
      const { status, next } = run(ROLE_GROUPS.WAREHOUSE, { role });
      expect(status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('l ancienne garde ADMIN_MANAGER refusait le magasinier (le bug corrige)', () => {
    const { status, next } = run(ROLE_GROUPS.ADMIN_MANAGER, { role: ROLES.MAGASINIER });
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('roles multiples (mig 335) : magasinier parmi les baseRoles suffit', () => {
    const { status, next } = run(ROLE_GROUPS.WAREHOUSE, { role: ROLES.CASHIER, baseRoles: [ROLES.CASHIER, ROLES.MAGASINIER] });
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('WAREHOUSE contient bien admin, gerant et magasinier, et pas plus', () => {
    expect([...ROLE_GROUPS.WAREHOUSE].sort()).toEqual([ROLES.ADMIN, ROLES.MAGASINIER, ROLES.MANAGER].sort());
  });
});
