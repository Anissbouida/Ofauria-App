/**
 * Contrôle de la clé d'un RIB marocain (24 chiffres) : le nombre formé par les
 * 24 chiffres doit être divisible par 97. Même règle que ribKeyValid côté
 * serveur (server/src/services/salary-transfer.ts) ; calcul par morceaux pour
 * ne pas dépendre de BigInt.
 */
export function ribKeyValid(rib: string): boolean {
  if (!/^\d{24}$/.test(rib)) return false;
  let rest = 0;
  for (const ch of rib) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 0;
}
