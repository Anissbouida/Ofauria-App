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

/**
 * Maps production roles to the category slugs they are responsible for.
 * Roles not listed here (admin, manager, cashier, saleswoman) see ALL categories.
 */
export const ROLE_CATEGORY_SLUGS: Partial<Record<Role, string[]>> = {
  baker: ['baguette', 'baguette-tradition', 'beldi', 'pain-rond', 'pain-sandwich'],
  viennoiserie: ['viennoiseries'],
  pastry_chef: ['patisserie-classique', 'patisserie-premium', 'gateaux-cookies', 'les-boites', 'macaron', 'pieces-portions', 'plateau-sale-sucre', 'sachet-mini'],
};

/** Returns the category slugs a role can see, or null if the role sees everything */
export function getRoleCategorySlugs(role: string): string[] | null {
  return ROLE_CATEGORY_SLUGS[role as Role] || null;
}
