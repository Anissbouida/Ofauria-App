/**
 * Date civile (AAAA-MM-JJ) d'une valeur DATE lue en base, sans passer par UTC (G0-28).
 *
 * node-pg rend une colonne DATE comme un objet Date à MINUIT HEURE LOCALE du serveur.
 * `toISOString()` la convertit en UTC : à l'est de Greenwich (Casablanca, UTC+1) minuit
 * local est encore la veille en UTC, et la date recule d'un jour. On lit donc les
 * composantes locales.
 */
export function localIsoDate(value: Date | string): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
