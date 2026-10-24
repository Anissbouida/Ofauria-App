/**
 * Prévision de la demande — calcul pur (aucun accès base), testé dans
 * __tests__/demand-forecast.test.ts. Le repository fournit l'historique
 * (v_demand_daily), les événements et la marge ; cette fonction décide.
 *
 * Méthode, dans l'ordre :
 *   1. Base = moyenne pondérée des 6 derniers mêmes jours de semaine (poids 6..1,
 *      le plus récent pèse le plus). Repli : moyenne journalière des 28 derniers
 *      jours si moins de 2 mêmes jours connus.
 *   2. Rupture : un jour fini à 0 invendu = demande non servie → observation +10 %.
 *   3. Tendance : 14 derniers jours / 28 précédents, bornée [0,9 ; 1,1].
 *   4. Événement : si la date cible est dans un événement, soit on dispose de
 *      mêmes jours dans un événement du même type (base calculée sur eux, sans
 *      majoration), soit on applique uplift_pct à la base normale.
 *   5. Marge de sécurité (majoration production catégorie / globale).
 *   6. Saisie manuelle : remplace tout.
 */

export type EventKind = 'ramadan' | 'fete' | 'vacances' | 'evenement' | 'fermeture';

export interface DemandObservation {
  /** YYYY-MM-DD */
  date: string;
  sold: number;
  /** Reste en fin de journée ; null = inconnu (pas de correction de rupture). */
  unsold: number | null;
}

export interface ForecastEvent {
  date_start: string;
  date_end: string;
  kind: EventKind;
  label: string;
  uplift_pct: number;
}

export interface ForecastContext {
  /** YYYY-MM-DD */
  targetDate: string;
  /** Événements applicables au produit (magasin + catégorie déjà filtrés). */
  events: ForecastEvent[];
  /** Marge de sécurité en % (5 = +5 %). */
  markupPct: number;
  /** Saisie manuelle pour la date cible, si elle existe. */
  override?: number | null;
  options?: Partial<ForecastOptions>;
}

export interface ForecastOptions {
  sameDayWeeks: number;
  /** false = quantités décimales (article au poids) : arrondi au centième. */
  integer: boolean;
  stockoutUplift: number;
  trendMin: number;
  trendMax: number;
}

export const DEFAULT_FORECAST_OPTIONS: ForecastOptions = {
  sameDayWeeks: 6,
  integer: true,
  stockoutUplift: 0.10,
  trendMin: 0.9,
  trendMax: 1.1,
};

export type ForecastMethod =
  | 'meme_jour'       // moyenne pondérée des mêmes jours de semaine
  | 'evenement'       // mêmes jours d'un événement du même type
  | 'moyenne'         // repli : moyenne journalière récente
  | 'ferme'           // jour de fermeture
  | 'insuffisant'     // pas assez d'historique
  | 'manuel';         // saisie manuelle

export type ForecastConfidence = 'haute' | 'moyenne' | 'faible';

export interface ForecastResult {
  qty: number;
  /** Quantité calculée avant saisie manuelle (= qty sans override). */
  computed_qty: number;
  base: number;
  method: ForecastMethod;
  factors: { tendance: number; evenement: number; marge: number };
  /** Nombre d'observations retenues pour la base. */
  n_obs: number;
  /** Nombre de ces observations corrigées pour rupture. */
  n_stockout: number;
  confidence: ForecastConfidence;
  event_label: string | null;
  explanation: string;
}

const DAY_MS = 86_400_000;
const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Parse YYYY-MM-DD en minuit UTC : seul le jour compte, jamais l'heure locale. */
function toUtc(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}

function dayDiff(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
}

function dow(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

function eventsOn(date: string, events: ForecastEvent[]): ForecastEvent[] {
  const t = toUtc(date);
  return events.filter(e => toUtc(e.date_start) <= t && t <= toUtc(e.date_end));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function average(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function coefficientOfVariation(values: number[]): number {
  const m = average(values);
  if (values.length < 2 || m === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance) / m;
}

export function forecastProduct(history: DemandObservation[], ctx: ForecastContext): ForecastResult {
  const opt = { ...DEFAULT_FORECAST_OPTIONS, ...ctx.options };
  const target = ctx.targetDate;
  const targetEvents = eventsOn(target, ctx.events);
  const marge = 1 + (ctx.markupPct || 0) / 100;

  const withOverride = (r: ForecastResult): ForecastResult => {
    if (ctx.override == null) return r;
    return {
      ...r,
      qty: ctx.override,
      method: 'manuel',
      explanation: `Saisie manuelle (${ctx.override}) — calcul : ${r.computed_qty}`,
    };
  };

  // Jour de fermeture : rien à produire.
  const closing = targetEvents.find(e => e.kind === 'fermeture');
  if (closing) {
    return withOverride({
      qty: 0, computed_qty: 0, base: 0, method: 'ferme',
      factors: { tendance: 1, evenement: 0, marge },
      n_obs: 0, n_stockout: 0, confidence: 'haute', event_label: closing.label,
      explanation: `Fermé : ${closing.label}`,
    });
  }

  // Événement de la cible : celui au plus fort effet (en valeur absolue).
  const targetEvent = targetEvents
    .slice()
    .sort((a, b) => Math.abs(b.uplift_pct) - Math.abs(a.uplift_pct))[0] ?? null;

  // Historique antérieur à la cible, classé du plus récent au plus ancien.
  const past = history
    .filter(h => dayDiff(target, h.date) > 0)
    .sort((a, b) => toUtc(b.date) - toUtc(a.date));

  const kindOf = (date: string): EventKind | null => {
    const evs = eventsOn(date, ctx.events);
    if (evs.some(e => e.kind === 'fermeture')) return 'fermeture';
    return evs[0]?.kind ?? null;
  };

  const adjusted = (h: DemandObservation) =>
    h.unsold === 0 ? h.sold * (1 + opt.stockoutUplift) : h.sold;

  // Jours « normaux » = hors tout événement : base de la tendance et du repli.
  const normalDays = past.filter(h => kindOf(h.date) === null);
  const targetDow = dow(target);
  const sameDow = (list: DemandObservation[]) =>
    list.filter(h => dow(h.date) === targetDow).slice(0, opt.sameDayWeeks);

  // 1+4. Choix des observations de base.
  let method: ForecastMethod = 'meme_jour';
  let obs = sameDow(normalDays);
  let eventFactor = targetEvent ? 1 + targetEvent.uplift_pct / 100 : 1;

  if (targetEvent) {
    const sameKind = sameDow(past.filter(h => kindOf(h.date) === targetEvent.kind));
    if (sameKind.length >= 2) {
      // L'historique de l'événement contient déjà son effet : pas de double majoration.
      obs = sameKind;
      method = 'evenement';
      eventFactor = 1;
    }
  }

  let base: number;
  if (obs.length >= 2) {
    const weights = obs.map((_, i) => opt.sameDayWeeks - i);
    const totalW = weights.reduce((s, w) => s + w, 0);
    base = obs.reduce((s, h, i) => s + adjusted(h) * weights[i], 0) / totalW;
  } else {
    const recent = normalDays.filter(h => dayDiff(target, h.date) <= 28);
    if (recent.length >= 3) {
      method = 'moyenne';
      obs = recent;
      base = average(recent.map(adjusted));
    } else {
      return withOverride({
        qty: 0, computed_qty: 0, base: 0, method: 'insuffisant',
        factors: { tendance: 1, evenement: eventFactor, marge },
        n_obs: past.length, n_stockout: 0, confidence: 'faible',
        event_label: targetEvent?.label ?? null,
        explanation: 'Historique insuffisant',
      });
    }
  }

  // 3. Tendance : 14 derniers jours vs 28 précédents (jours normaux uniquement).
  const last14 = normalDays.filter(h => dayDiff(target, h.date) <= 14).map(h => h.sold);
  const prev28 = normalDays
    .filter(h => { const d = dayDiff(target, h.date); return d > 14 && d <= 42; })
    .map(h => h.sold);
  let tendance = 1;
  if (last14.length >= 3 && prev28.length >= 3 && average(prev28) > 0) {
    tendance = Math.min(opt.trendMax, Math.max(opt.trendMin, average(last14) / average(prev28)));
  }

  const raw = base * tendance * eventFactor * marge;
  const computed = base > 0 ? (opt.integer ? Math.round(raw) : round2(raw)) : 0;

  // Confiance : volume d'observations + régularité.
  const cv = coefficientOfVariation(obs.map(h => h.sold));
  const confidence: ForecastConfidence =
    method !== 'moyenne' && obs.length >= 4 && cv <= 0.35 ? 'haute'
      : obs.length >= 2 && cv <= 0.6 ? 'moyenne'
        : 'faible';

  const nStockout = obs.filter(h => h.unsold === 0).length;
  const parts: string[] = [];
  if (method === 'meme_jour') parts.push(`Moyenne pondérée de ${obs.length} ${DAY_NAMES[targetDow]}(s) : ${round2(base)}`);
  if (method === 'evenement') parts.push(`${obs.length} ${DAY_NAMES[targetDow]}(s) en ${targetEvent!.label} : ${round2(base)}`);
  if (method === 'moyenne') parts.push(`Moyenne de ${obs.length} jours récents : ${round2(base)}`);
  if (nStockout > 0) parts.push(`${nStockout} jour(s) en rupture +${Math.round(opt.stockoutUplift * 100)} %`);
  if (tendance !== 1) parts.push(`tendance ×${round2(tendance)}`);
  if (eventFactor !== 1) parts.push(`${targetEvent!.label} ${targetEvent!.uplift_pct >= 0 ? '+' : ''}${targetEvent!.uplift_pct} %`);
  if (marge !== 1) parts.push(`marge +${ctx.markupPct} %`);

  return withOverride({
    qty: computed,
    computed_qty: computed,
    base: round2(base),
    method,
    factors: { tendance: round2(tendance), evenement: round2(eventFactor), marge: round2(marge) },
    n_obs: obs.length,
    n_stockout: nStockout,
    confidence,
    event_label: targetEvent?.label ?? null,
    explanation: parts.join(' · '),
  });
}

/** Erreur absolue moyenne en % (MAPE), jours à réel nul exclus. */
export function mape(pairs: { forecast: number; actual: number }[]): number | null {
  const valid = pairs.filter(p => p.actual > 0);
  if (!valid.length) return null;
  return round2(100 * average(valid.map(p => Math.abs(p.forecast - p.actual) / p.actual)));
}
