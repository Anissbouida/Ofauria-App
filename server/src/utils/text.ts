/**
 * Normalise un nom pour qu'il commence toujours par une majuscule.
 *
 * - Trim les espaces de bord.
 * - Met la 1re lettre en majuscule (gere les accents : é -> É) et laisse le
 *   reste du libelle inchange (on ne force pas le reste en minuscules pour ne
 *   pas casser les sigles ou marques, ex : "AOP", "BIO").
 * - Renvoie la valeur telle quelle si vide/nullish.
 *
 * Utilise pour les noms de l'Economat (ingredients, emballages) afin qu'ils
 * soient toujours capitalises, quelle que soit la saisie.
 */
export function capitalizeFirst(value: string | null | undefined): string {
  if (value == null) return '';
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
