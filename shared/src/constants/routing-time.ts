/**
 * Temps et coût prévus d'une opération de gamme (M5-01, mig 566). Même calcul que la
 * fonction SQL fn_routing_op_minutes, qui fait foi pour les gammes enregistrées ; cette
 * version sert l'aperçu en direct de l'éditeur (M8-05). Un test en base vérifie la parité.
 *   main-d'œuvre = réglage + durée fixe + quantité / quantité de base × MO unitaire  (arrondi 0,01 min)
 *   coût         = taux horaire du poste × minutes / 60                               (arrondi 0,01)
 */
export interface RoutingOpTimeInput {
  setupMin?: number | null; durationMin?: number | null; laborMinPerUnit?: number | null;
  machineMinPerUnit?: number | null; baseQuantity?: number | null;
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function routingOpMinutes(op: RoutingOpTimeInput, qty: number): { labor: number; machine: number } {
  const base = n(op.baseQuantity) > 0 ? n(op.baseQuantity) : 1;
  const q = n(qty);
  return {
    labor: r2(n(op.setupMin) + n(op.durationMin) + q / base * n(op.laborMinPerUnit)),
    machine: r2(n(op.setupMin) + q / base * n(op.machineMinPerUnit)),
  };
}

export const routingOpCost = (hourlyCost: number, laborMinutes: number) => r2(n(hourlyCost) * n(laborMinutes) / 60);
