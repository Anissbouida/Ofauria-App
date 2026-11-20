import { describe, it, expect, vi } from 'vitest';
import { probeSession, isSessionRejected, httpStatusOf } from './sessionProbe';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const networkError = () => new Error('Network Error');
const noSleep = () => Promise.resolve();

describe('Vérification de la session au démarrage (constat 56)', () => {
  it('lit le statut HTTP d\'une erreur axios', () => {
    expect(httpStatusOf(httpError(500))).toBe(500);
    expect(httpStatusOf(networkError())).toBeNull();
    expect(httpStatusOf(null)).toBeNull();
  });

  it('seuls 401 et 403 disent « pas de session »', () => {
    expect(isSessionRejected(httpError(401))).toBe(true);
    expect(isSessionRejected(httpError(403))).toBe(true);
    expect(isSessionRejected(httpError(500))).toBe(false);
    expect(isSessionRejected(httpError(502))).toBe(false);
    expect(isSessionRejected(networkError())).toBe(false);
  });

  it('rend l\'utilisateur du premier coup', async () => {
    const me = vi.fn().mockResolvedValue({ id: 'u1' });
    expect(await probeSession(me, { sleep: noSleep })).toEqual({ id: 'u1' });
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('API en redémarrage : réessaie puis rend l\'utilisateur, sans déconnecter', async () => {
    const me = vi.fn()
      .mockRejectedValueOnce(httpError(500))
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue({ id: 'u1' });
    const sleep = vi.fn(noSleep);
    expect(await probeSession(me, { sleep, delayMs: 10 })).toEqual({ id: 'u1' });
    expect(me).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('401 : pas de session, sans réessayer', async () => {
    const me = vi.fn().mockRejectedValue(httpError(401));
    expect(await probeSession(me, { sleep: noSleep })).toBeNull();
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('serveur injoignable jusqu\'au bout : rend null après le dernier essai', async () => {
    const me = vi.fn().mockRejectedValue(httpError(502));
    expect(await probeSession(me, { attempts: 3, sleep: noSleep })).toBeNull();
    expect(me).toHaveBeenCalledTimes(3);
  });
});
