/**
 * Dimensionnement d'une fabrication en fournées (mig 662).
 *
 * Une fournée = un cadre, une plaque, un moule, une cuve : ce que le format produit en une
 * fois (`yieldPerBatch`, en pièces ou en kilos). Fonction pure, partagée par le serveur
 * (création d'ordre, plans de semi-finis, plans issus d'une commande) et par l'écran de
 * création d'ordre, pour que l'aperçu et l'enregistrement donnent le même chiffre.
 *
 * Exemple : 130 tranches, cadre de 48, fournées entières → 3 fournées, 144 prévues, 14 d'excédent.
 */

export type LotRule = 'partiel' | 'entier';

export interface BatchSizingInput {
  /** Quantité demandée (pièces ou kilos, la même unité que le rendement). */
  requested: number;
  /** Ce que produit une fournée. */
  yieldPerBatch: number;
  /** 'entier' : arrondi à la fournée supérieure. Défaut 'partiel'. */
  rule?: LotRule | null;
  /** Nombre minimal de fournées par ordre. */
  min?: number | null;
  /** Nombre maximal de fournées par ordre : signalé, jamais écrêté. */
  max?: number | null;
}

export interface BatchSizing {
  /** Nombre de fournées à lancer (entier si la règle est 'entier'). */
  batches: number;
  /** Quantité qui sera fabriquée. */
  planned: number;
  /** Excédent prévu par rapport à la demande. */
  surplus: number;
  /** True si la quantité fabriquée diffère de la demande. */
  adjusted: boolean;
  /** True si le nombre de fournées dépasse le maximum du format. */
  overMax: boolean;
}

// Tolérance d'arrondi : 8,7 kg ÷ 2,9 kg vaut 3,0000000000000004 en virgule flottante.
const EPS = 1e-9;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function sizeBatches(input: BatchSizingInput): BatchSizing {
  const requested = input.requested > 0 ? input.requested : 0;
  const y = input.yieldPerBatch > 0 ? input.yieldPerBatch : 0;
  if (requested === 0 || y === 0) {
    return { batches: 0, planned: requested, surplus: 0, adjusted: false, overMax: false };
  }
  const entier = input.rule === 'entier';
  let batches = requested / y;
  if (entier) batches = Math.ceil(batches - EPS);
  if (input.min != null && input.min > 0 && batches < input.min - EPS) {
    batches = entier ? Math.ceil(input.min - EPS) : input.min;
  }
  const planned = round3(batches * y);
  const adjusted = Math.abs(planned - requested) > 0.0005;
  return {
    batches: entier ? batches : round3(batches),
    planned: adjusted ? planned : requested,
    surplus: adjusted ? round3(planned - requested) : 0,
    adjusted,
    overMax: input.max != null && input.max > 0 && batches > input.max + EPS,
  };
}

/** Rendement d'une fournée d'un format : kilos pour un format au kilo, pièces sinon. */
export function formatYieldPerBatch(f: {
  rendement_unite?: string | null; rendement_kg?: number | string | null; nb_par_defaut?: number | string | null;
}): number {
  const kg = f.rendement_kg != null ? Number(f.rendement_kg) : NaN;
  if (f.rendement_unite === 'kg' && kg > 0) return kg;
  const nb = f.nb_par_defaut != null ? Number(f.nb_par_defaut) : NaN;
  return nb > 0 ? nb : 0;
}
