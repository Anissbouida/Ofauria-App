/**
 * asyncHandler — garde-fou F-037.
 *
 * Les handlers de routes sont async. Sans asyncHandler, une erreur levee dans un
 * handler (ex. vente refusee pour DLV/DDE atteinte, portant statusCode 409)
 * devient une « unhandled rejection » : Express 4 ne l'attrape pas, le middleware
 * d'erreur n'est jamais appele et la requete reste PENDANTE (la caisse tourne
 * indefiniment). asyncHandler route le rejet vers next(err) -> reponse propre.
 *
 * On verifie ici le contrat exact dont depend le correctif : une promesse rejetee
 * est transmise a next avec l'erreur intacte (statusCode + code preserves).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

describe('asyncHandler (F-037 — pas de requete pendante)', () => {
  it('transmet une erreur async a next() avec statusCode et code intacts', async () => {
    const err = Object.assign(new Error('Vente refusee : DLV atteinte'), {
      statusCode: 409,
      code: 'DLV_EXPIREE',
    });
    const handler = asyncHandler(async () => { throw err; });
    const next = vi.fn();

    await handler({} as Request, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0][0] as Error & { statusCode?: number; code?: string };
    expect(forwarded).toBe(err);
    expect(forwarded.statusCode).toBe(409);
    expect(forwarded.code).toBe('DLV_EXPIREE');
  });

  it('ne touche pas a next() quand le handler reussit', async () => {
    const handler = asyncHandler(async (_req, res) => {
      (res as unknown as { ok: boolean }).ok = true;
    });
    const next = vi.fn();
    const res = {} as Response;

    await handler({} as Request, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { ok: boolean }).ok).toBe(true);
  });
});
