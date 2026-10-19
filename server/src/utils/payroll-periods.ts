/**
 * Bornes de la quinzaine calendaire contenant `iso` : 1-15 ou 16-fin de mois
 * (cf. biweekly-payroll.repository.ts). Calcul en UTC pour eviter les
 * decalages de fuseau.
 */
export function biweeklyBounds(iso: string): { start: string; end: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= 15
    ? { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15` }
    : { start: `${y}-${pad(m)}-16`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
}
