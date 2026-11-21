/**
 * Recherche insensible à la casse ET aux accents (scénario 1, constat 122) : « eclair »
 * trouve « Éclair au chocolat », « creme » trouve « Crème pâtissière ». Même règle que
 * SearchSelect, partagée par les listes.
 */
export const foldText = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Vrai si `needle` (déjà saisi par l'utilisateur) figure dans l'un des textes. */
export function textIncludes(needle: string, ...haystacks: (string | null | undefined)[]): boolean {
  const q = foldText(needle).trim();
  if (!q) return true;
  return haystacks.some((h) => foldText(h).includes(q));
}
