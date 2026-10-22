import { describe, it, expect, vi, beforeEach } from 'vitest';

// Droits effectifs (mig 330) : exceptions de l'utilisateur, sinon droits du role.
// Seule la lecture en base est simulee (sans charger la base ni l'env) ; la regle
// de decision hasRight (access-rules.ts) reste reelle.
vi.mock('../services/access-rights.js', () => ({ effectiveRights: vi.fn() }));

import { biweeklyBounds } from '../utils/payroll-periods.js';
import { markPaidSchema, createAdvanceSchema, createEmployeeSchema } from '../validators/employees.validator.js';
import { authorizeModule } from '../middleware/module.middleware.js';
import { effectiveRights } from '../services/access-rights.js';

describe('biweeklyBounds', () => {
  it('1re quinzaine : 1 -> 15', () => {
    expect(biweeklyBounds('2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-15' });
    expect(biweeklyBounds('2026-10-15')).toEqual({ start: '2026-10-01', end: '2026-10-15' });
  });
  it('2e quinzaine : 16 -> fin de mois (30, 31, fevrier)', () => {
    expect(biweeklyBounds('2026-10-16')).toEqual({ start: '2026-10-16', end: '2026-10-31' });
    expect(biweeklyBounds('2026-11-20')).toEqual({ start: '2026-11-16', end: '2026-11-30' });
    expect(biweeklyBounds('2027-02-28')).toEqual({ start: '2027-02-16', end: '2027-02-28' });
    expect(biweeklyBounds('2028-02-17')).toEqual({ start: '2028-02-16', end: '2028-02-29' });
  });
});

describe('mode de paiement des salaires', () => {
  it('accepte le « Virement » du client (bank)', () => {
    expect(markPaidSchema.parse({ paymentMethod: 'bank' }).paymentMethod).toBe('bank');
  });
  it('normalise bank_transfer/transfer en bank (CHECK des tables de paie)', () => {
    expect(markPaidSchema.parse({ paymentMethod: 'bank_transfer' }).paymentMethod).toBe('bank');
    expect(markPaidSchema.parse({ paymentMethod: 'transfer' }).paymentMethod).toBe('bank');
  });
  it('especes par defaut, traite refusee (absente des CHECK)', () => {
    expect(markPaidSchema.parse({}).paymentMethod).toBe('cash');
    expect(markPaidSchema.safeParse({ paymentMethod: 'traite' }).success).toBe(false);
  });
  it('avance par virement acceptee', () => {
    const r = createAdvanceSchema.parse({ employeeId: '6f1c2b1e-3d0a-4b6a-9d1e-2a7f6c3b9e10', amount: 500, paymentMethod: 'bank' });
    expect(r.paymentMethod).toBe('bank');
  });
});

describe('frequence de paie', () => {
  it('accepte la quinzaine', () => {
    const r = createEmployeeSchema.parse({ firstName: 'A', lastName: 'B', role: 'baker', hireDate: '2026-01-01', payFrequency: 'biweekly' });
    expect(r.payFrequency).toBe('biweekly');
  });
});

describe('authorizeModule', () => {
  const run = async (role: string, action: 'view' | 'create' | 'edit' | 'delete') => {
    const req = { user: { userId: 'u1', role } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await authorizeModule('employees', action)(req, res as never, next);
    return { next, res };
  };
  const rights = effectiveRights as unknown as ReturnType<typeof vi.fn>;
  const asRole = (rows: Record<string, unknown>[], source: 'role' | 'user' = 'role') =>
    rights.mockResolvedValue({ roleCode: 'x', baseRole: 'x', isAdmin: false, source, rows: rows.map(r => ({ config: {}, ...r })) });
  beforeEach(() => rights.mockReset());

  it('admin : toujours autorise, sans lecture des droits', async () => {
    const { next } = await run('admin', 'delete');
    expect(next).toHaveBeenCalled();
    expect(rights).not.toHaveBeenCalled();
  });
  it('gerant sans droits personnalises : droits du role (lecture/edition, pas suppression)', async () => {
    // Reprise mig 330 : Personnel du gerant sans Supprimer.
    asRole([{ module: 'employees', can_view: true, can_create: true, can_edit: true, can_delete: false }]);
    expect((await run('manager', 'edit')).next).toHaveBeenCalled();
    const del = await run('manager', 'delete');
    expect(del.next).not.toHaveBeenCalled();
    expect(del.res.status).toHaveBeenCalledWith(403);
  });
  it('autre role avec le droit « Personnel » accorde : autorise', async () => {
    asRole([{ module: 'employees', can_view: true, can_create: false, can_edit: true, can_delete: false }], 'user');
    expect((await run('cashier', 'view')).next).toHaveBeenCalled();
    expect((await run('cashier', 'edit')).next).toHaveBeenCalled();
    expect((await run('cashier', 'create')).next).not.toHaveBeenCalled();
  });
  it('role sans le module : refuse', async () => {
    asRole([{ module: 'pos', can_view: true, can_create: true, can_edit: true, can_delete: true }]);
    expect((await run('cashier', 'view')).res.status).toHaveBeenCalledWith(403);
  });
});
