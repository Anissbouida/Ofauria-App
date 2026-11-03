/**
 * Consolidation multi-établissements (lot Bonus 17), sans accès à la base.
 *
 * Une société, plusieurs établissements (magasins) : chaque écriture porte son
 * établissement, ou aucun (écritures communes du siège). Les flux entre
 * établissements passent par le compte de liaison 1811 (CGNC, rubrique 18) :
 * débiteur chez celui qui a cédé, créditeur chez celui qui a reçu… dans
 * l'ensemble ils se compensent. La consolidation
 *   - présente bilan et CPC par établissement, la liaison en ligne à part
 *     (un établissement seul n'équilibre son bilan qu'avec elle) ;
 *   - élimine les comptes de liaison dans le total combiné ; un solde résiduel
 *     signale une liaison passée d'un seul côté ;
 *   - additionne le reste : le combiné égale la liasse de la société.
 */
import { computeBilan, computeCpc, type AccountBalance } from './liasse.rules.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const LIAISON_PREFIX = '18';
export const isLiaison = (code: string) => code.startsWith(LIAISON_PREFIX);

export type EstablishmentInput = { key: string; label: string; bil: AccountBalance[]; ges: AccountBalance[]; prior: number };

/** Rubriques reprises dans le tableau de consolidation. */
export const ROWS = {
  actif: ['A', 'B', 'C', 'D', 'E', 'T1', 'F', 'G', 'H', 'I', 'T2', 'T3', 'TG'],
  passif: ['K', 'L', 'M', 'N', 'O', 'U1', 'P', 'Q', 'R', 'U2', 'U3', 'UG'],
  cpc: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XII', 'XIII'],
} as const;

export type Column = {
  key: string; label: string;
  actif: Record<string, number>; passif: Record<string, number>; cpc: Record<string, number>;
  liaison: number; result: number; total_actif: number; total_passif: number; ecart: number;
};

function merge(lists: AccountBalance[][]): AccountBalance[] {
  const m = new Map<string, AccountBalance>();
  for (const l of lists) for (const b of l) {
    const cur = m.get(b.code);
    m.set(b.code, cur ? { ...cur, balance: r2(cur.balance + b.balance) } : { ...b });
  }
  return [...m.values()];
}

function column(key: string, label: string, bil: AccountBalance[], ges: AccountBalance[], prior: number): Column & { unmapped: AccountBalance[] } {
  const cpc = computeCpc(ges);
  const bilan = computeBilan(bil.filter(b => !isLiaison(b.code)), cpc.result, prior);
  // Liaison au passif : créditeur (+) quand l'établissement doit au reste de la société.
  const liaison = r2(-bil.filter(b => isLiaison(b.code)).reduce((s, b) => s + b.balance, 0));
  const pick = <T extends { id: string }>(rows: T[], ids: readonly string[], f: (r: T) => number) =>
    Object.fromEntries(ids.map(id => [id, r2(f(rows.find(r => r.id === id)!))]));
  return {
    key, label,
    actif: pick(bilan.actif, ROWS.actif, r => r.net),
    passif: pick(bilan.passif, ROWS.passif, r => r.amount),
    cpc: pick(cpc.lines, ROWS.cpc, r => r.amount),
    liaison, result: cpc.result,
    total_actif: bilan.total_actif, total_passif: r2(bilan.total_passif + liaison),
    ecart: r2(bilan.total_actif - bilan.total_passif - liaison),
    unmapped: [...bilan.unmapped, ...cpc.unmapped],
  };
}

export function consolidate(establishments: EstablishmentInput[]) {
  const columns = establishments.map(e => column(e.key, e.label, e.bil, e.ges, e.prior));
  const combined = column('combined', 'Total combiné',
    merge(establishments.map(e => e.bil)), merge(establishments.map(e => e.ges)),
    r2(establishments.reduce((s, e) => s + e.prior, 0)));
  // La liaison éliminée : le combiné ne porte que l'éventuel résidu (anomalie).
  const residual = combined.liaison;
  const controls: { level: 'error' | 'warning'; message: string }[] = [];
  if (Math.abs(residual) >= 0.01)
    controls.push({ level: 'error', message: `Comptes de liaison non soldés entre établissements : résidu ${residual.toFixed(2)} (une liaison passée d'un seul côté)` });
  for (const c of columns) if (Math.abs(c.ecart) >= 0.01)
    controls.push({ level: 'error', message: `${c.label} : bilan déséquilibré de ${c.ecart.toFixed(2)} après liaison` });
  const sumResults = r2(columns.reduce((s, c) => s + c.result, 0));
  if (Math.abs(sumResults - combined.result) >= 0.01)
    controls.push({ level: 'error', message: `Somme des résultats (${sumResults.toFixed(2)}) différente du résultat combiné (${combined.result.toFixed(2)})` });
  const unmapped = merge(columns.map(c => c.unmapped));
  for (const u of unmapped) controls.push({ level: 'error', message: `Compte ${u.code} ${u.label} sans rubrique (${u.balance.toFixed(2)})` });
  const strip = ({ unmapped: _u, ...c }: Column & { unmapped: AccountBalance[] }) => c;
  return {
    columns: columns.map(strip),
    eliminations: { liaison: r2(-columns.reduce((s, c) => s + c.liaison, 0)) },
    combined: { ...strip(combined), liaison: 0, total_passif: r2(combined.total_passif - residual), liaison_residual: residual },
    controls,
  };
}

/** Écritures d'un transfert entre établissements, sans accès à la base. */
export function transferEntries(p: { amount: number; accountCode: string; fromLabel: string; toLabel: string; label: string }) {
  const a = r2(p.amount);
  return {
    from: [
      { code: '1811', debit: a, credit: 0, label: `${p.label} — vers ${p.toLabel}` },
      { code: p.accountCode, debit: 0, credit: a, label: `${p.label} — sortie` },
    ],
    to: [
      { code: p.accountCode, debit: a, credit: 0, label: `${p.label} — entrée` },
      { code: '1811', debit: 0, credit: a, label: `${p.label} — de ${p.fromLabel}` },
    ],
  };
}
