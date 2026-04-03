export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  BAKER: 'baker',
  PASTRY_CHEF: 'pastry_chef',
  VIENNOISERIE: 'viennoiserie',
  SALESWOMAN: 'saleswoman',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  manager: 'Gérant',
  cashier: 'Caissier',
  baker: 'Boulanger',
  pastry_chef: 'Pâtissier',
  viennoiserie: 'Viennoiserie',
  saleswoman: 'Vendeuse',
};
