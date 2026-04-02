export const UNITS = {
  KG: 'kg',
  G: 'g',
  L: 'l',
  ML: 'ml',
  UNIT: 'unit',
} as const;

export type Unit = (typeof UNITS)[keyof typeof UNITS];

export const UNIT_LABELS: Record<Unit, string> = {
  kg: 'Kilogramme',
  g: 'Gramme',
  l: 'Litre',
  ml: 'Millilitre',
  unit: 'Unité',
};
