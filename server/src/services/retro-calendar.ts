/**
 * M5-04 (reste) — rétro-planning sur le calendrier des postes (mig 568 / mig 432).
 *
 * Placement à rebours d'une étape de `durationMin` minutes qui doit finir au plus tard à
 * `endMs`, dans les plages ouvertes de son poste (intervalles [s, e[ en ms, jours fermés déjà
 * retirés). L'étape consomme les plages de la plus tardive à la plus ancienne et peut se
 * répartir sur plusieurs (une cuisson de nuit reprend le lendemain matin) :
 *   fin    = premier instant ouvert avant `endMs` ;
 *   début  = instant où la durée est entièrement consommée.
 * Sans plage (poste sans calendrier) : placement continu, comme avant le calendrier.
 * Rend null si la durée ne tient pas dans les plages fournies (horizon trop court).
 */
export type Window = { s: number; e: number };

export function placeBackward(endMs: number, durationMin: number, windows: Window[] | null): { startMs: number; endMs: number } | null {
  const need = Math.max(0, durationMin) * 60_000;
  if (!windows) return { startMs: endMs - need, endMs };
  const open = windows.filter(w => w.e > w.s && w.s < endMs).sort((a, b) => b.e - a.e);
  if (need === 0) {
    const w = open[0];
    if (!w) return null;
    const t = Math.min(endMs, w.e);
    return { startMs: t, endMs: t };
  }
  let remaining = need;
  let end: number | null = null;
  for (const w of open) {
    const hi = Math.min(w.e, endMs);
    if (hi <= w.s) continue;
    if (end === null) end = hi;
    const take = Math.min(remaining, hi - w.s);
    remaining -= take;
    if (remaining <= 0) return { startMs: hi - take, endMs: end };
  }
  return null;
}
