/**
 * Calcul de paie mensuelle marocaine — fonction PURE (aucun acces base).
 *
 * Le repository charge les donnees (employe, pointage, bareme, rubriques),
 * appelle computeMonthlyPayslip(), puis enregistre le resultat. Tout le
 * calcul est ici pour etre teste sur des cas chiffres.
 *
 * Enchainement (art. 57-73 CGI, regles CNSS/AMO) :
 *   brut       = base + anciennete + HS + doubles shifts - absences + gains
 *   base CNSS  = brut - parts exonerees - gains non soumis CNSS
 *   brut imp.  = brut - parts exonerees - gains non soumis IR
 *   CNSS sal.  = min(base CNSS, plafond) x taux ; AMO / CIMR sur base CNSS
 *   frais pro  = brut imp. x (35 % si brut imp. annuel <= seuil, sinon 25 %),
 *                plafonnes (plafond annuel / 12)
 *   RNI        = brut imp. - frais pro - CNSS - AMO - CIMR
 *   IR         = bareme(RNI x 12) / 12 - charges de famille / 12
 *   net        = brut - CNSS - AMO - CIMR - IR - retenues
 * Un salarie non declare n'a ni cotisations ni IR (net = brut - retenues).
 */

export interface IrBracket { upTo: number | null; rate: number; deduction: number }

export interface TaxScale {
  id?: string;
  cnssPlafond: number;
  cnssRateEmployee: number;
  cnssRateEmployer: number;
  amoRateEmployee: number;
  amoRateEmployer: number;
  allocFamilialesRate: number;
  taxeFpRate: number;
  fraisProRateBas: number;
  fraisProRateHaut: number;
  fraisProSeuilAnnuel: number;
  fraisProPlafondAnnuel: number;
  deductionFamilleAnnuelle: number;
  maxPersonnesCharge: number;
  irBrackets: IrBracket[];
}

export interface RubriqueInput {
  rubriqueId: string;
  label: string;
  kind: 'gain' | 'retenue';
  amount: number;
  soumisCnss: boolean;
  soumisIr: boolean;
  plafondExonerationMensuel: number | null;
  source: 'fixe' | 'manuel';
}

export interface PayslipInput {
  monthlySalary: number;
  /** Base journaliere : salaire / baseDays (26 au Maroc). */
  baseDays: number;
  /** Jours couverts par un pointage reel (present/retard/repos + 0,5 x demi-journee + doubles). */
  coveredDays: number;
  doubleDays: number;
  overtimeHours: number;
  seniorityYears: number;
  nbDependents: number;
  /** Taux CIMR salarial en % (0 = non affilie). Meme taux cote patronal. */
  cimrRate: number;
  isDeclared: boolean;
  lines: RubriqueInput[];
}

export interface PayslipLine extends RubriqueInput {
  exemptAmount: number;
  cnssAmount: number;
  irAmount: number;
}

export interface PayslipResult {
  baseSalary: number;
  workedDays: number;
  absentDays: number;
  absenceDeduction: number;
  seniorityRate: number;
  seniorityBonus: number;
  overtimeAmount: number;
  extraShiftAmount: number;
  gainsTotal: number;
  retenuesTotal: number;
  grossSalary: number;
  baseCnss: number;
  brutImposable: number;
  cnssEmployee: number;
  amoEmployee: number;
  cimrEmployee: number;
  fraisPro: number;
  netImposable: number;
  irGross: number;
  familyDeduction: number;
  irNet: number;
  netSalary: number;
  cnssEmployer: number;
  amoEmployer: number;
  cimrEmployer: number;
  allocFamiliales: number;
  taxeFp: number;
  totalChargesPatron: number;
  lines: PayslipLine[];
}

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Prime d'anciennete (Code du travail art. 350-352), en fraction. */
export function seniorityRate(years: number): number {
  if (years < 2) return 0;
  if (years < 5) return 0.05;
  if (years < 12) return 0.10;
  if (years < 20) return 0.15;
  if (years < 25) return 0.20;
  return 0.25;
}

/** Annees de service revolues a une date (anciennete = depuis l'embauche). */
export function serviceYears(hireDate: string | null | undefined, atDate: string): number | null {
  if (!hireDate) return null;
  const [hy, hm, hd] = hireDate.slice(0, 10).split('-').map(Number);
  const [ay, am, ad] = atDate.slice(0, 10).split('-').map(Number);
  let years = ay - hy;
  if (am < hm || (am === hm && ad < hd)) years--;
  return Math.max(0, years);
}

/** IR annuel du bareme : RNI x taux - somme a deduire, sur la tranche du RNI. */
export function irAnnuel(rniAnnuel: number, brackets: IrBracket[]): number {
  if (rniAnnuel <= 0) return 0;
  const b = brackets.find(x => x.upTo === null || rniAnnuel <= x.upTo) ?? brackets[brackets.length - 1];
  return Math.max(0, rniAnnuel * b.rate - b.deduction);
}

export function computeMonthlyPayslip(input: PayslipInput, scale: TaxScale): PayslipResult {
  const base = input.monthlySalary;
  const dailyRate = base / input.baseDays;

  // ─── Elements du salaire de base (regles pointage existantes) ───
  const absentDays = Math.max(0, input.baseDays - input.coveredDays);
  const absenceDeduction = r2(absentDays * dailyRate);
  const rate = seniorityRate(input.seniorityYears);
  // Anciennete sur le salaire effectivement gagne (base moins absences).
  const seniorityBonus = r2((base - absenceDeduction) * rate);
  const overtimeAmount = r2(input.overtimeHours * (dailyRate / 8));
  const extraShiftAmount = r2(input.doubleDays * dailyRate);
  const salaireFixe = base + seniorityBonus + overtimeAmount + extraShiftAmount - absenceDeduction;

  // ─── Rubriques : part exoneree, part soumise CNSS / IR ───
  const lines: PayslipLine[] = input.lines.map(l => {
    if (l.kind === 'retenue') return { ...l, exemptAmount: 0, cnssAmount: 0, irAmount: 0 };
    const exempt = l.plafondExonerationMensuel === null ? 0 : Math.min(l.amount, l.plafondExonerationMensuel);
    const rest = l.amount - exempt;
    return {
      ...l,
      exemptAmount: r2(exempt),
      cnssAmount: l.soumisCnss ? r2(rest) : 0,
      irAmount: l.soumisIr ? r2(rest) : 0,
    };
  });
  const gains = lines.filter(l => l.kind === 'gain');
  const gainsTotal = r2(gains.reduce((s, l) => s + l.amount, 0));
  const retenuesTotal = r2(lines.filter(l => l.kind === 'retenue').reduce((s, l) => s + l.amount, 0));

  const grossSalary = r2(salaireFixe + gainsTotal);
  const baseCnss = r2(salaireFixe + gains.reduce((s, l) => s + l.cnssAmount, 0));
  const brutImposable = r2(salaireFixe + gains.reduce((s, l) => s + l.irAmount, 0));

  // ─── Cotisations salariales ───
  const declared = input.isDeclared;
  const cnssAssiette = Math.min(Math.max(baseCnss, 0), scale.cnssPlafond);
  const cnssEmployee = declared ? r2(cnssAssiette * scale.cnssRateEmployee) : 0;
  const amoEmployee = declared ? r2(Math.max(baseCnss, 0) * scale.amoRateEmployee) : 0;
  const cimrEmployee = declared ? r2(Math.max(baseCnss, 0) * input.cimrRate / 100) : 0;

  // ─── IR ───
  let fraisPro = 0;
  let irGross = 0;
  let familyDeduction = 0;
  let netImposable = r2(brutImposable - cnssEmployee - amoEmployee - cimrEmployee);
  if (declared && brutImposable > 0) {
    const fpRate = brutImposable * 12 <= scale.fraisProSeuilAnnuel ? scale.fraisProRateBas : scale.fraisProRateHaut;
    fraisPro = r2(Math.min(brutImposable * fpRate, scale.fraisProPlafondAnnuel / 12));
    netImposable = r2(Math.max(0, brutImposable - fraisPro - cnssEmployee - amoEmployee - cimrEmployee));
    irGross = r2(irAnnuel(netImposable * 12, scale.irBrackets) / 12);
    const persons = Math.min(Math.max(input.nbDependents, 0), scale.maxPersonnesCharge);
    familyDeduction = r2(Math.min(persons * scale.deductionFamilleAnnuelle / 12, irGross));
  }
  const irNet = r2(Math.max(0, irGross - familyDeduction));

  const netSalary = r2(grossSalary - cnssEmployee - amoEmployee - cimrEmployee - irNet - retenuesTotal);

  // ─── Charges patronales ───
  const cnssEmployer = declared ? r2(cnssAssiette * scale.cnssRateEmployer) : 0;
  const amoEmployer = declared ? r2(Math.max(baseCnss, 0) * scale.amoRateEmployer) : 0;
  const cimrEmployer = declared ? r2(Math.max(baseCnss, 0) * input.cimrRate / 100) : 0;
  const allocFamiliales = declared ? r2(Math.max(baseCnss, 0) * scale.allocFamilialesRate) : 0;
  const taxeFp = declared ? r2(Math.max(baseCnss, 0) * scale.taxeFpRate) : 0;
  const totalChargesPatron = r2(cnssEmployer + amoEmployer + cimrEmployer + allocFamiliales + taxeFp);

  return {
    baseSalary: base,
    // Jours payes sur la base (doubles comptes a part dans extraShiftAmount).
    workedDays: r2(Math.min(input.coveredDays, input.baseDays)),
    absentDays,
    absenceDeduction,
    seniorityRate: rate,
    seniorityBonus,
    overtimeAmount,
    extraShiftAmount,
    gainsTotal,
    retenuesTotal,
    grossSalary,
    baseCnss,
    brutImposable,
    cnssEmployee,
    amoEmployee,
    cimrEmployee,
    fraisPro,
    netImposable,
    irGross,
    familyDeduction,
    irNet,
    netSalary,
    cnssEmployer,
    amoEmployer,
    cimrEmployer,
    allocFamiliales,
    taxeFp,
    totalChargesPatron,
    lines,
  };
}

/** Convertit une ligne payroll_tax_scales (pg) en TaxScale. */
export function taxScaleFromRow(row: Record<string, unknown>): TaxScale {
  const n = (v: unknown, fallback = 0) => (v === null || v === undefined ? fallback : parseFloat(String(v)));
  const brackets = (typeof row.ir_brackets === 'string' ? JSON.parse(row.ir_brackets) : row.ir_brackets) as IrBracket[];
  return {
    id: row.id as string,
    cnssPlafond: n(row.cnss_plafond),
    cnssRateEmployee: n(row.cnss_rate_employee),
    cnssRateEmployer: n(row.cnss_rate_employer),
    amoRateEmployee: n(row.amo_rate_employee),
    amoRateEmployer: n(row.amo_rate_employer),
    allocFamilialesRate: n(row.alloc_familiales_rate),
    taxeFpRate: n(row.taxe_fp_rate),
    fraisProRateBas: n(row.frais_pro_rate),
    fraisProRateHaut: n(row.frais_pro_rate_haut, n(row.frais_pro_rate)),
    fraisProSeuilAnnuel: n(row.frais_pro_seuil_annuel, Infinity),
    fraisProPlafondAnnuel: n(row.frais_pro_plafond_annuel, n(row.frais_pro_plafond) * 12),
    deductionFamilleAnnuelle: n(row.deduction_famille_annuelle, n(row.deduction_famille) * 12),
    maxPersonnesCharge: n(row.max_personnes_charge, 6),
    irBrackets: brackets,
  };
}
