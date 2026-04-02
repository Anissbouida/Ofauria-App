export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  CASHIER: 'cashier',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  manager: 'Gérant',
  cashier: 'Caissier',
};
