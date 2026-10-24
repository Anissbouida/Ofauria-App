import { describe, it, expect } from 'vitest';
import { forecastProduct, mape, type DemandObservation } from '../services/demand-forecast.js';

// 2026-10-20 est un mardi.
const TARGET = '2026-10-20';

function daysBefore(n: number): string {
  const d = new Date(Date.parse(`${TARGET}T00:00:00Z`) - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Historique quotidien constant sur `days` jours, invendu non nul (pas de rupture). */
function flat(days: number, sold: number, unsold: number | null = 5): DemandObservation[] {
  return Array.from({ length: days }, (_, i) => ({ date: daysBefore(i + 1), sold, unsold }));
}

describe('forecastProduct', () => {
  it('moyenne pondérée des mêmes jours, sans marge ni tendance', () => {
    const r = forecastProduct(flat(42, 20), { targetDate: TARGET, events: [], markupPct: 0 });
    expect(r.method).toBe('meme_jour');
    expect(r.base).toBe(20);
    expect(r.qty).toBe(20);
    expect(r.n_obs).toBe(6);
    expect(r.confidence).toBe('haute');
  });

  it('le mardi le plus récent pèse le plus', () => {
    // Mardis à J-7 = 60, autres mardis = 0 → 60*6/21 ≈ 17,14
    const history = flat(42, 0, null).map(h => (h.date === daysBefore(7) ? { ...h, sold: 60 } : h));
    const r = forecastProduct(history, { targetDate: TARGET, events: [], markupPct: 0 });
    expect(r.base).toBeCloseTo(17.14, 1);
    expect(r.qty).toBe(17);
  });

  it('applique la marge de sécurité', () => {
    const r = forecastProduct(flat(42, 20), { targetDate: TARGET, events: [], markupPct: 10 });
    expect(r.qty).toBe(22);
  });

  it('majore les jours en rupture (invendu = 0)', () => {
    const r = forecastProduct(flat(42, 20, 0), { targetDate: TARGET, events: [], markupPct: 0 });
    expect(r.base).toBe(22);
    expect(r.n_stockout).toBe(6);
  });

  it('ignore les jours postérieurs ou égaux à la cible', () => {
    const history = [...flat(42, 20), { date: TARGET, sold: 999, unsold: 1 }, { date: '2026-10-27', sold: 999, unsold: 1 }];
    const r = forecastProduct(history, { targetDate: TARGET, events: [], markupPct: 0 });
    expect(r.qty).toBe(20);
  });

  it('tendance bornée à +10 %', () => {
    // 28 jours anciens à 10, 14 jours récents à 100 → ratio 10, borné à 1,15
    const history = flat(42, 10).map((h, i) => (i < 14 ? { ...h, sold: 100 } : h));
    const r = forecastProduct(history, { targetDate: TARGET, events: [], markupPct: 0 });
    expect(r.factors.tendance).toBe(1.1);
  });

  it('événement sans historique comparable : majoration appliquée', () => {
    const r = forecastProduct(flat(42, 20), {
      targetDate: TARGET,
      events: [{ date_start: TARGET, date_end: TARGET, kind: 'fete', label: 'Aïd', uplift_pct: 50 }],
      markupPct: 0,
    });
    expect(r.factors.evenement).toBe(1.5);
    expect(r.qty).toBe(30);
    expect(r.event_label).toBe('Aïd');
  });

  it("événement avec historique du même type : base sur ces jours, pas de double majoration", () => {
    // Ramadan couvrant les 3 derniers mardis + la cible ; ces jours-là = 40
    const ramadan = { date_start: daysBefore(21), date_end: TARGET, kind: 'ramadan' as const, label: 'Ramadan', uplift_pct: 30 };
    const history = flat(42, 20).map(h => (Date.parse(h.date) >= Date.parse(daysBefore(21)) ? { ...h, sold: 40 } : h));
    const r = forecastProduct(history, { targetDate: TARGET, events: [ramadan], markupPct: 0 });
    expect(r.method).toBe('evenement');
    expect(r.factors.evenement).toBe(1);
    expect(r.qty).toBe(40);
  });

  it('les jours d’événement sont exclus de la base normale', () => {
    // Un mardi passé était une fête à 500 : il ne doit pas gonfler la prévision
    const fete = { date_start: daysBefore(7), date_end: daysBefore(7), kind: 'fete' as const, label: 'Fête', uplift_pct: 100 };
    const history = flat(42, 20).map(h => (h.date === daysBefore(7) ? { ...h, sold: 500 } : h));
    const r = forecastProduct(history, { targetDate: TARGET, events: [fete], markupPct: 0 });
    expect(r.qty).toBe(20);
  });

  it('jour de fermeture : 0', () => {
    const r = forecastProduct(flat(42, 20), {
      targetDate: TARGET,
      events: [{ date_start: TARGET, date_end: TARGET, kind: 'fermeture', label: 'Inventaire', uplift_pct: -100 }],
      markupPct: 5,
    });
    expect(r.method).toBe('ferme');
    expect(r.qty).toBe(0);
  });

  it('repli sur la moyenne récente avec un seul mardi connu', () => {
    const history = flat(5, 12); // J-1..J-5 : un seul mardi n'y figure pas → repli
    const r = forecastProduct(history, { targetDate: TARGET, events: [], markupPct: 0 });
    expect(r.method).toBe('moyenne');
    expect(r.qty).toBe(12);
    expect(r.confidence).not.toBe('haute');
  });

  it('historique insuffisant', () => {
    const r = forecastProduct(flat(2, 12), { targetDate: TARGET, events: [], markupPct: 0 });
    expect(r.method).toBe('insuffisant');
    expect(r.qty).toBe(0);
  });

  it('la saisie manuelle remplace le calcul mais le garde', () => {
    const r = forecastProduct(flat(42, 20), { targetDate: TARGET, events: [], markupPct: 0, override: 35 });
    expect(r.method).toBe('manuel');
    expect(r.qty).toBe(35);
    expect(r.computed_qty).toBe(20);
  });
});

describe('mape', () => {
  it('ignore les jours à réel nul', () => {
    expect(mape([{ forecast: 10, actual: 0 }])).toBeNull();
    expect(mape([{ forecast: 12, actual: 10 }, { forecast: 8, actual: 10 }, { forecast: 5, actual: 0 }])).toBe(20);
  });
});
