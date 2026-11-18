/**
 * M5-04 — placement à rebours d'une étape dans les plages ouvertes d'un poste.
 */
import { describe, it, expect } from 'vitest';
import { placeBackward } from '../services/retro-calendar.js';

const h = (hours: number) => Date.UTC(2026, 10, 18, 0, 0) + hours * 3_600_000;

describe('Rétro-planning sur calendrier (M5-04)', () => {
  it('sans calendrier : placement continu (comportement d\'avant)', () => {
    expect(placeBackward(h(7), 90, null)).toEqual({ startMs: h(5.5), endMs: h(7) });
  });

  it('fin dans une plage : la durée tient avant l\'heure demandée', () => {
    expect(placeBackward(h(7), 60, [{ s: h(4), e: h(12) }])).toEqual({ startMs: h(6), endMs: h(7) });
  });

  it('heure demandée hors plage : l\'étape finit à la fermeture précédente', () => {
    // Poste ouvert 4 h – 6 h ; vitrine à 7 h → cuisson finie à 6 h.
    expect(placeBackward(h(7), 60, [{ s: h(4), e: h(6) }])).toEqual({ startMs: h(5), endMs: h(6) });
  });

  it('durée plus longue qu\'une plage : répartie sur la plage précédente', () => {
    // Plages 20 h – 22 h la veille et 4 h – 5 h ; 2 h 30 à finir avant 5 h.
    expect(placeBackward(h(5), 150, [{ s: h(-4), e: h(-2) }, { s: h(4), e: h(5) }])).toEqual({ startMs: h(-3.5), endMs: h(5) });
  });

  it('pas assez de plages dans l\'horizon : null', () => {
    expect(placeBackward(h(7), 300, [{ s: h(4), e: h(6) }])).toBeNull();
  });
});
