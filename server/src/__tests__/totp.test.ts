/**
 * G6-01 — TOTP : vecteurs de test de la RFC 6238 (annexe B, HMAC-SHA1, clé ASCII
 * « 12345678901234567890 », 8 chiffres), base32, tolérance d'un pas, chiffrement du secret,
 * codes de secours.
 */
import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, totpAt, verifyTotp, encryptSecret, decryptSecret, generateBackupCodes, hashBackupCode, generateSecret } from '../services/totp.js';

const KEY = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP (G6-01)', () => {
  it('vecteurs RFC 6238 (SHA1, 8 chiffres)', () => {
    const cases: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];
    for (const [t, code] of cases) expect(totpAt('', t, 8, 30, KEY)).toBe(code);
  });

  it('base32 aller-retour', () => {
    expect(base32Encode(KEY)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(KEY)).toBe(true);
  });

  it('vérification avec un pas de tolérance, refus hors fenêtre et des codes mal formés', () => {
    const s = generateSecret();
    const t = 1_800_000_000;
    expect(verifyTotp(s, totpAt(s, t), t)).toBe(true);
    expect(verifyTotp(s, totpAt(s, t - 30), t)).toBe(true);
    expect(verifyTotp(s, totpAt(s, t - 90), t)).toBe(false);
    expect(verifyTotp(s, '12345', t)).toBe(false);
    expect(verifyTotp(s, 'abcdef', t)).toBe(false);
  });

  it('secret chiffré, codes de secours hachés', () => {
    const s = generateSecret();
    const enc = encryptSecret(s);
    expect(enc).not.toContain(s);
    expect(decryptSecret(enc)).toBe(s);
    const { codes, hashes } = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashes[0]).toBe(hashBackupCode(codes[0].toUpperCase()));
  });
});
