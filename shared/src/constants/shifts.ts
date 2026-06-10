/**
 * Catalogue des shifts standard du planning hebdomadaire.
 * Les codes correspondent au seed de la migration 151_create_shifts.sql.
 */
export const SHIFT_CODES = {
  SALES_AM:   'SALES_AM',
  SALES_PM:   'SALES_PM',
  PROD_EARLY: 'PROD_EARLY',
  PROD_MID:   'PROD_MID',
  NIGHT:      'NIGHT',
  ADMIN_DAY:  'ADMIN_DAY',
} as const;

export type ShiftCode = (typeof SHIFT_CODES)[keyof typeof SHIFT_CODES];

export const SHIFT_LABELS: Record<ShiftCode, string> = {
  SALES_AM:   'Vente matin 7h-14h',
  SALES_PM:   'Vente après-midi 14h-22h',
  PROD_EARLY: 'Production matin 7h-15h',
  PROD_MID:   'Production mi-journée 10h-18h',
  NIGHT:      'Nuit 22h-06h',
  ADMIN_DAY:  'Administratif 9h-17h',
};

export const SHIFT_SHORT_LABELS: Record<ShiftCode, string> = {
  SALES_AM:   'Vente 7h-14h',
  SALES_PM:   'Vente 14h-22h',
  PROD_EARLY: 'Prod 7h-15h',
  PROD_MID:   'Prod 10h-18h',
  NIGHT:      'Nuit 22h-06h',
  ADMIN_DAY:  'Admin 9h-17h',
};

/** Couleurs Tailwind utilisees dans la grille hebdo. */
export const SHIFT_BADGE_COLORS: Record<ShiftCode, string> = {
  SALES_AM:   'bg-amber-100 text-amber-800 border-amber-200',
  SALES_PM:   'bg-orange-100 text-orange-800 border-orange-200',
  PROD_EARLY: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  PROD_MID:   'bg-teal-100 text-teal-800 border-teal-200',
  NIGHT:      'bg-indigo-100 text-indigo-800 border-indigo-200',
  ADMIN_DAY:  'bg-sky-100 text-sky-800 border-sky-200',
};

/** Heures (HH:MM) statiques utilisees cote frontend pour affichage rapide. */
export const SHIFT_HOURS: Record<ShiftCode, { start: string; end: string }> = {
  SALES_AM:   { start: '07:00', end: '14:00' },
  SALES_PM:   { start: '14:00', end: '22:00' },
  PROD_EARLY: { start: '07:00', end: '15:00' },
  PROD_MID:   { start: '10:00', end: '18:00' },
  NIGHT:      { start: '22:00', end: '06:00' },
  ADMIN_DAY:  { start: '09:00', end: '17:00' },
};
