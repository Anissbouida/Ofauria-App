/**
 * Scenarios VENTES POS — gardes de controleur (unitaires, repos mockes).
 *
 * On verifie les refus que la caissiere rencontre AVANT toute ecriture en base,
 * dans saleController.checkout :
 *   - quantite decimale sur un produit unitaire  -> 400 (pas de requete pendante) ;
 *   - remise superieure au sous-total            -> 400 ;
 *   - ventilation mixte incoherente (especes+carte != total) -> 400 ;
 *   - caisse non ouverte                          -> 400 ;
 *   - session en cours de fermeture               -> 409 SESSION_IN_CLOSING ;
 *   - remise valide + caisse ouverte              -> 201 (vente creee, total net).
 *
 * On mocke uniquement les repositories du chemin de la garde ; le controleur
 * est importe dynamiquement apres avoir pose l'env (sinon env.ts leve a l'import).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

vi.mock('../repositories/sale.repository.js', () => ({ saleRepository: { create: vi.fn() } }));
vi.mock('../repositories/product.repository.js', () => ({ productRepository: { findById: vi.fn() } }));
vi.mock('../repositories/product-pricing-tier.repository.js', () => ({ pricingTierRepository: { findMatchingTier: vi.fn() } }));
vi.mock('../repositories/product-channel-pricing.repository.js', () => ({ channelPricingRepository: { findOverride: vi.fn() } }));
vi.mock('../repositories/sales-channel.repository.js', () => ({ salesChannelRepository: { findDefault: vi.fn() } }));
vi.mock('../repositories/cash-register.repository.js', () => ({ cashRegisterRepository: { findOpenSession: vi.fn() } }));
vi.mock('../repositories/product-stock.helper.js', () => ({ getVitrineStock: vi.fn() }));
vi.mock('../repositories/employee.repository.js', () => ({
  attendanceRepository: { findLastActiveEmployee: vi.fn() },
  employeeRepository: {}, scheduleRepository: {}, leaveRepository: {}, payrollRepository: {},
}));

const UID = '55555555-5555-4555-8555-555555555555';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeRes() {
  const json = vi.fn();
  const res: any = { status: vi.fn(() => ({ json })), json };
  return { res, json };
}

let saleController: any;
let saleRepository: any, productRepository: any, pricingTierRepository: any;
let channelPricingRepository: any, salesChannelRepository: any;
let cashRegisterRepository: any, productStockHelper: any, employeeRepo: any;

beforeAll(async () => {
  ({ saleController } = await import('../controllers/sale.controller.js'));
  ({ saleRepository } = await import('../repositories/sale.repository.js'));
  ({ productRepository } = await import('../repositories/product.repository.js'));
  ({ pricingTierRepository } = await import('../repositories/product-pricing-tier.repository.js'));
  ({ channelPricingRepository } = await import('../repositories/product-channel-pricing.repository.js'));
  ({ salesChannelRepository } = await import('../repositories/sales-channel.repository.js'));
  ({ cashRegisterRepository } = await import('../repositories/cash-register.repository.js'));
  productStockHelper = await import('../repositories/product-stock.helper.js');
  ({ attendanceRepository: employeeRepo } = await import('../repositories/employee.repository.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  // Chemin nominal : produit unitaire a 5 DH, stock vitrine abondant, pas d'override.
  salesChannelRepository.findDefault.mockResolvedValue({ id: 'chan' });
  channelPricingRepository.findOverride.mockResolvedValue(null);
  pricingTierRepository.findMatchingTier.mockResolvedValue(null);
  productRepository.findById.mockResolvedValue({ id: UID, name: 'Croissant', sale_unit: 'unit', price: '5' });
  productStockHelper.getVitrineStock.mockResolvedValue(100);
  employeeRepo.findLastActiveEmployee.mockResolvedValue(null);
  cashRegisterRepository.findOpenSession.mockResolvedValue({ id: 'sess', closing_started_at: null });
  saleRepository.create.mockResolvedValue({ id: 'sale-ok' });
});

const req = (body: any): any => ({ body, user: { userId: UID, storeId: UID } });

describe('checkout — quantite decimale sur produit unitaire', () => {
  it('refuse 1,5 piece -> 400 et ne cree aucune vente', async () => {
    const { res, json } = fakeRes();
    await saleController.checkout(req({ items: [{ productId: UID, quantity: 1.5 }], paymentMethod: 'cash' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.message).toMatch(/entier/i);
    expect(saleRepository.create).not.toHaveBeenCalled();
  });
});

describe('checkout — remise', () => {
  it('refuse une remise superieure au sous-total -> 400', async () => {
    const { res, json } = fakeRes();
    await saleController.checkout(
      req({ items: [{ productId: UID, quantity: 2 }], paymentMethod: 'cash', discountAmount: 999 }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.message).toMatch(/remise/i);
    expect(saleRepository.create).not.toHaveBeenCalled();
  });

  it('accepte une remise valide -> 201 avec total net (sous-total - remise)', async () => {
    const { res } = fakeRes();
    // 2 x 5 = 10, remise 2 -> total 8.
    await saleController.checkout(
      req({ items: [{ productId: UID, quantity: 2 }], paymentMethod: 'cash', discountAmount: 2 }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(saleRepository.create).toHaveBeenCalledTimes(1);
    expect(saleRepository.create.mock.calls[0][0]).toMatchObject({ subtotal: 10, discountAmount: 2, total: 8 });
  });
});

describe('checkout — paiement mixte', () => {
  it('refuse une ventilation especes+carte != total -> 400', async () => {
    const { res, json } = fakeRes();
    // 2 x 5 = 10 ; especes 3 + carte 3 = 6 != 10.
    await saleController.checkout(
      req({ items: [{ productId: UID, quantity: 2 }], paymentMethod: 'mixed', cashAmount: 3, cardAmount: 3 }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.message).toMatch(/mixte/i);
    expect(saleRepository.create).not.toHaveBeenCalled();
  });

  it('accepte une ventilation coherente -> 201', async () => {
    const { res } = fakeRes();
    await saleController.checkout(
      req({ items: [{ productId: UID, quantity: 2 }], paymentMethod: 'mixed', cashAmount: 7, cardAmount: 3 }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(saleRepository.create).toHaveBeenCalledTimes(1);
    expect(saleRepository.create.mock.calls[0][0]).toMatchObject({ cashAmount: 7, cardAmount: 3 });
  });
});

describe('checkout — etat de la caisse', () => {
  it('refuse la vente si aucune caisse n\'est ouverte -> 400', async () => {
    cashRegisterRepository.findOpenSession.mockResolvedValue(null);
    const { res, json } = fakeRes();
    await saleController.checkout(req({ items: [{ productId: UID, quantity: 1 }], paymentMethod: 'cash' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.message).toMatch(/caisse/i);
    expect(saleRepository.create).not.toHaveBeenCalled();
  });

  it('refuse la vente si la session est en cours de fermeture -> 409 SESSION_IN_CLOSING', async () => {
    cashRegisterRepository.findOpenSession.mockResolvedValue({ id: 'sess', closing_started_at: new Date().toISOString() });
    const { res, json } = fakeRes();
    await saleController.checkout(req({ items: [{ productId: UID, quantity: 1 }], paymentMethod: 'cash' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0][0].error.code).toBe('SESSION_IN_CLOSING');
    expect(saleRepository.create).not.toHaveBeenCalled();
  });
});
