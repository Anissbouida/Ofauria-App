/**
 * Correctifs P1 — gardes de controleur (tests unitaires, repos mockes).
 *
 *   F-026  POST /sales/checkout refuse en 400 une quantite non entiere (la colonne
 *          sale_items.quantity est un INTEGER ; un decimal cassait l'INSERT).
 *   F-048  salaryAdvanceController.create plafonne l'avance au salaire mensuel
 *          (equivalent) diminue des avances en cours, comme le self-service.
 *
 * On mocke uniquement les repositories du chemin de la garde ; les controleurs
 * sont importes dynamiquement apres avoir pose l'env (sinon env.ts leve a l'import).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

vi.mock('../repositories/product.repository.js', () => ({ productRepository: { findById: vi.fn() } }));
vi.mock('../repositories/sales-channel.repository.js', () => ({ salesChannelRepository: { findDefault: vi.fn() } }));
vi.mock('../repositories/employee.repository.js', () => ({
  employeeRepository: { findById: vi.fn() },
  attendanceRepository: { findLastActiveEmployee: vi.fn() },
  scheduleRepository: {}, leaveRepository: {}, payrollRepository: {},
}));
vi.mock('../repositories/salary-advance.repository.js', () => ({
  salaryAdvanceRepository: { outstandingByEmployee: vi.fn(), create: vi.fn() },
}));

const UID = '44444444-4444-4444-8444-444444444444';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeRes() {
  const json = vi.fn();
  const res: any = { status: vi.fn(() => ({ json })), json };
  return { res, json };
}

let saleController: any, salaryAdvanceController: any, orderController: any;
let productRepository: any, salesChannelRepository: any;
let employeeRepository: any, salaryAdvanceRepository: any;

beforeAll(async () => {
  ({ saleController } = await import('../controllers/sale.controller.js'));
  ({ salaryAdvanceController } = await import('../controllers/employee.controller.js'));
  ({ orderController } = await import('../controllers/order.controller.js'));
  ({ productRepository } = await import('../repositories/product.repository.js'));
  ({ salesChannelRepository } = await import('../repositories/sales-channel.repository.js'));
  ({ employeeRepository } = await import('../repositories/employee.repository.js'));
  ({ salaryAdvanceRepository } = await import('../repositories/salary-advance.repository.js'));
});

beforeEach(() => { vi.clearAllMocks(); });

describe('F-026 — checkout refuse une quantite non entiere', () => {
  it('quantite 1,5 sur un produit unitaire -> 400 (pas de requete pendante)', async () => {
    salesChannelRepository.findDefault.mockResolvedValue({ id: 'chan' });
    productRepository.findById.mockResolvedValue({ id: UID, name: 'Croissant', sale_unit: 'unit', price: '5' });
    const req: any = { body: { items: [{ productId: UID, quantity: 1.5 }], paymentMethod: 'cash' }, user: { userId: UID, storeId: UID } };
    const { res, json } = fakeRes();
    await saleController.checkout(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(json.mock.calls[0][0].error.message).toMatch(/entier/i);
  });
});

describe('F-048 — plafond de l avance (gerant)', () => {
  it('50 000 DH pour une payee a 600 DH/sem -> 409 (plafond ~2600)', async () => {
    employeeRepository.findById.mockResolvedValue({ pay_frequency: 'weekly', weekly_salary: '600', monthly_salary: null });
    salaryAdvanceRepository.outstandingByEmployee.mockResolvedValue([{ outstanding: '0' }]);
    const req: any = { body: { employeeId: UID, amount: 50000 }, user: { userId: UID, storeId: UID } };
    const { res } = fakeRes();
    await salaryAdvanceController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(salaryAdvanceRepository.create).not.toHaveBeenCalled();
  });

  it('avance dans le plafond -> 201 et creation effective', async () => {
    employeeRepository.findById.mockResolvedValue({ pay_frequency: 'monthly', monthly_salary: '6000' });
    salaryAdvanceRepository.outstandingByEmployee.mockResolvedValue([{ outstanding: '0' }]);
    salaryAdvanceRepository.create.mockResolvedValue({ id: 'adv1', amount: 2000 });
    const req: any = { body: { employeeId: UID, amount: 2000 }, user: { userId: UID, storeId: UID } };
    const { res } = fakeRes();
    await salaryAdvanceController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(salaryAdvanceRepository.create).toHaveBeenCalledTimes(1);
  });

  it('avance qui epuise le plafond restant (avances en cours) -> 409', async () => {
    employeeRepository.findById.mockResolvedValue({ pay_frequency: 'monthly', monthly_salary: '6000' });
    salaryAdvanceRepository.outstandingByEmployee.mockResolvedValue([{ outstanding: '5500' }]); // reste 500
    const req: any = { body: { employeeId: UID, amount: 1000 }, user: { userId: UID, storeId: UID } };
    const { res } = fakeRes();
    await salaryAdvanceController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('F-040 — avance de commande vs total', () => {
  it('avance (30) superieure au total (16) -> 400', async () => {
    productRepository.findById.mockResolvedValue({ id: UID, name: 'Cake', price: '8' });
    const req: any = {
      body: { customerName: 'Mme X', pickupDate: '2026-03-01', items: [{ productId: UID, quantity: 2 }], advanceAmount: 30, paymentMethod: 'cash' },
      user: { userId: UID, storeId: UID },
    };
    const { res, json } = fakeRes();
    await orderController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.message).toMatch(/supérieure au total/i);
  });

  it('avance negative -> 400', async () => {
    productRepository.findById.mockResolvedValue({ id: UID, name: 'Cake', price: '8' });
    const req: any = {
      body: { customerName: 'Mme X', pickupDate: '2026-03-01', items: [{ productId: UID, quantity: 1 }], advanceAmount: -5, paymentMethod: 'cash' },
      user: { userId: UID, storeId: UID },
    };
    const { res } = fakeRes();
    await orderController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
