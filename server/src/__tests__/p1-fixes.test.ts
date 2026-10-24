/**
 * Correctifs P1 — durcissement des entrees API (tests unitaires purs).
 *
 *   F-002  POST /purchase-orders : un schema zod rejette en 400 les types/formes
 *          invalides (quantityOrdered:"abc", ligne sans article...) au lieu de
 *          laisser l'INSERT echouer en 500.
 *   F-008  validateUuidParams refuse en 400 un :id non-UUID avant d'atteindre
 *          Postgres (sinon 22P02 -> requete pendante faute d'asyncHandler).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { createPurchaseOrderSchema } from '../validators/purchase-order-action.validator.js';

const ING = '11111111-1111-4111-8111-111111111111';
const PKG = '22222222-2222-4222-8222-222222222222';
const SUP = '33333333-3333-4333-8333-333333333333';

describe('F-002 — createPurchaseOrderSchema', () => {
  it('accepte un BC bien forme (prix optionnel)', () => {
    const r = createPurchaseOrderSchema.safeParse({
      supplierId: SUP, expectedDeliveryDate: '2026-03-01',
      items: [{ ingredientId: ING, quantityOrdered: 25, unitPrice: 4.8 }, { ingredientId: ING, quantityOrdered: 10 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejette une quantite non numerique (ex. "abc") -> plus de 500 Postgres', () => {
    const r = createPurchaseOrderSchema.safeParse({
      supplierId: SUP, items: [{ ingredientId: ING, quantityOrdered: 'abc' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejette une quantite <= 0', () => {
    const r = createPurchaseOrderSchema.safeParse({ supplierId: SUP, items: [{ ingredientId: ING, quantityOrdered: 0 }] });
    expect(r.success).toBe(false);
  });

  it('rejette un fournisseur non-UUID et une liste vide', () => {
    expect(createPurchaseOrderSchema.safeParse({ supplierId: 'x', items: [{ ingredientId: ING, quantityOrdered: 1 }] }).success).toBe(false);
    expect(createPurchaseOrderSchema.safeParse({ supplierId: SUP, items: [] }).success).toBe(false);
  });

  it('rejette une ligne qui porte a la fois (ou aucun de) ingredient et consommable', () => {
    expect(createPurchaseOrderSchema.safeParse({ supplierId: SUP, items: [{ ingredientId: ING, packagingId: PKG, quantityOrdered: 1 }] }).success).toBe(false);
    expect(createPurchaseOrderSchema.safeParse({ supplierId: SUP, items: [{ quantityOrdered: 1 }] }).success).toBe(false);
  });

  it('accepte une ligne consommable (packagingId) seule', () => {
    expect(createPurchaseOrderSchema.safeParse({ supplierId: SUP, items: [{ packagingId: PKG, quantityOrdered: 5, unitPrice: 2 }] }).success).toBe(true);
  });
});

describe('F-008 — validateUuidParams', () => {
  const run = (paramValue: string) => {
    const req = { params: { id: paramValue } } as unknown as Request;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
    const next = vi.fn();
    validateUuidParams('id')(req, res, next as NextFunction);
    return { res, next, json };
  };

  it('refuse un :id non-UUID en 400 sans appeler next', () => {
    const { res, next } = run('not-a-uuid');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('laisse passer un :id UUID valide', () => {
    const { res, next } = run(SUP);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
