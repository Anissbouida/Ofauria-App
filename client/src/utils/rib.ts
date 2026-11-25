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

/** Chiffres du RIB saisi : espaces et tirets retirés (comme le serveur). */
export const ribDigitsOf = (raw: string | null | undefined) => String(raw ?? '').replace(/[\s-]/g, '');

/**
 * Message d'erreur à afficher pendant la saisie, ou undefined si le champ est
 * vide ou valide. La clé est contrôlée dès le 24e chiffre ; la clé attendue
 * n'est jamais affichée, pour ne pas inciter à corriger la clé au lieu du
 * chiffre mal recopié.
 */
export function ribLiveError(raw: string | null | undefined): string | undefined {
  const d = ribDigitsOf(raw);
  if (!d) return undefined;
  if (!/^\d+$/.test(d)) return 'Le RIB ne doit contenir que des chiffres';
  if (d.length !== 24) return `${d.length}/24 chiffres : le RIB doit compter 24 chiffres`;
  if (!ribKeyValid(d)) return "Clé de contrôle incorrecte : un chiffre est probablement mal recopié, vérifiez avec l'attestation de RIB";
  return undefined;
}

/** Aide sous le champ : compteur, puis confirmation de la clé. */
export function ribHint(raw: string | null | undefined): string {
  const d = ribDigitsOf(raw);
  return d.length === 24 && !ribLiveError(raw) ? '24/24 chiffres · clé de contrôle correcte' : `${d.length}/24 chiffres`;
}
