/**
 * F-003 — Un BC non chiffre ne peut plus etre envoye.
 *
 * total_amount est calcule sur COALESCE(prix, 0) : un BC sans prix valait 0 et
 * passait sous tout plafond d'approbation. Le controleur send() refuse desormais
 * (409 PO_UNPRICED) tant qu'une ligne n'a pas de prix unitaire.
 *
 * Repos du chemin de garde mockes ; controleur importe apres pose de l'env.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';

vi.mock('../repositories/purchase-order.repository.js', () => ({
  purchaseOrderRepository: { findById: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));

const PO = '55555555-5555-4555-8555-555555555555';
const UID = '44444444-4444-4444-8444-444444444444';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeRes() {
  const json = vi.fn();
  const res: any = { status: vi.fn(() => ({ json })), json };
  return { res, json };
}

let purchaseOrderController: any, purchaseOrderRepository: any, db: any;

beforeAll(async () => {
  ({ purchaseOrderController } = await import('../controllers/purchase-order.controller.js'));
  ({ purchaseOrderRepository } = await import('../repositories/purchase-order.repository.js'));
  ({ db } = await import('../config/database.js'));
});

beforeEach(() => { vi.clearAllMocks(); });

describe('F-003 — send refuse un BC non chiffre', () => {
  it('une ligne sans prix -> 409 PO_UNPRICED, pas d envoi', async () => {
    purchaseOrderRepository.findById.mockResolvedValue({ id: PO, status: 'en_attente', total_amount: '0' });
    db.query.mockResolvedValue({ rows: [{ n: 2 }] });     // 2 lignes non chiffrees
    const req: any = { params: { id: PO }, user: { userId: UID, storeId: UID } };
    const { res, json } = fakeRes();
    await purchaseOrderController.send(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'PO_UNPRICED' }),
    }));
  });

  it('un BC qui n est pas en attente est refuse avant la verification des prix', async () => {
    purchaseOrderRepository.findById.mockResolvedValue({ id: PO, status: 'envoye' });
    const req: any = { params: { id: PO }, user: { userId: UID, storeId: UID } };
    const { res } = fakeRes();
    await purchaseOrderController.send(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(db.query).not.toHaveBeenCalled();
  });
});
