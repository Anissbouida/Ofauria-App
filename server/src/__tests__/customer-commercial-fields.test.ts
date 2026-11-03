import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  create: vi.fn(async (d: Record<string, unknown>) => ({ id: 'c1', ...d })),
  update: vi.fn(async (id: string, d: Record<string, unknown>) => ({ id, ...d })),
  findById: vi.fn(async () => ({
    id: 'c1', customer_type: 'particulier', credit_limit: null, remise_pct: '0.00',
    delai_paiement_jours: null, tva_exonere: false, billing_frequency: 'monthly',
  })),
}));
vi.mock('../repositories/customer.repository.js', () => ({ customerRepository: repo }));
vi.mock('../repositories/receivables.repository.js', () => ({ receivablesRepository: {} }));

const { customerController } = await import('../controllers/customer.controller.js');

function call(fn: 'create' | 'update', role: string, body: Record<string, unknown>) {
  const res = { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  const req = { user: { userId: 'u', role }, params: { id: 'c1' }, body } as never;
  return customerController[fn](req, res as never).then(() => res);
}

describe('Conditions commerciales du client réservées à la direction (O2C L0, G-CR-04)', () => {
  beforeEach(() => { repo.create.mockClear(); repo.update.mockClear(); });

  it('la caisse crée un particulier, pas un professionnel ni un plafond', async () => {
    expect((await call('create', 'cashier', { firstName: 'Ali', creditLimit: '', remisePct: '', tvaExonere: false, billingFrequency: 'monthly' })).statusCode).toBe(201);
    expect((await call('create', 'cashier', { firstName: 'Ali', customerType: 'professionnel' })).statusCode).toBe(403);
    expect((await call('create', 'cashier', { firstName: 'Ali', creditLimit: 5000 })).statusCode).toBe(403);
    expect((await call('create', 'manager', { firstName: 'Ali', customerType: 'professionnel', creditLimit: 5000 })).statusCode).toBe(201);
  });

  it('la caisse modifie les coordonnées en renvoyant les valeurs inchangées, pas le plafond', async () => {
    const same = { phone: '0600', customerType: 'particulier', creditLimit: '', remisePct: '0', tvaExonere: false, billingFrequency: 'monthly' };
    expect((await call('update', 'saleswoman', same)).statusCode).toBe(200);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect((await call('update', 'cashier', { ...same, creditLimit: '9000' })).statusCode).toBe(403);
    expect((await call('update', 'cashier', { ...same, customerType: 'revendeur' })).statusCode).toBe(403);
    expect((await call('update', 'cashier', { ...same, tvaExonere: true })).statusCode).toBe(403);
    expect((await call('update', 'admin', { ...same, creditLimit: '9000' })).statusCode).toBe(200);
  });
});
