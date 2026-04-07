export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  BAKER: 'baker',
  PASTRY_CHEF: 'pastry_chef',
  VIENNOISERIE: 'viennoiserie',
  BELDI_SALE: 'beldi_sale',
  SALESWOMAN: 'saleswoman',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Reusable role groups for authorization */
export const ROLE_GROUPS = {
  /** Admin only */
  ADMIN: [ROLES.ADMIN] as Role[],
  /** Admin + Manager */
  ADMIN_MANAGER: [ROLES.ADMIN, ROLES.MANAGER] as Role[],
  /** Roles that operate the cash register and handle sales */
  SALES: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER, ROLES.SALESWOMAN] as Role[],
  /** Roles that operate the cash register */
  CASH: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER] as Role[],
  /** Chefs + managers who handle production */
  PRODUCTION: [ROLES.ADMIN, ROLES.MANAGER, ROLES.BAKER, ROLES.PASTRY_CHEF, ROLES.VIENNOISERIE, ROLES.BELDI_SALE] as Role[],
  /** Chef roles only (no admin/manager) */
  CHEFS: [ROLES.BAKER, ROLES.PASTRY_CHEF, ROLES.VIENNOISERIE, ROLES.BELDI_SALE] as Role[],
  /** Store-facing staff (admin, manager, cashier, saleswoman) */
  STORE_STAFF: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER, ROLES.SALESWOMAN] as Role[],
} as const;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  manager: 'Gérant',
  cashier: 'Caissier',
  baker: 'Boulanger',
  pastry_chef: 'Pâtissier',
  viennoiserie: 'Viennoiserie',
  beldi_sale: 'Beldi & Salé',
  saleswoman: 'Vendeuse',
};

/**
 * Maps production roles to the category slugs they are responsible for.
 * Roles not listed here (admin, manager, cashier, saleswoman) see ALL categories.
 */
export const ROLE_CATEGORY_SLUGS: Partial<Record<Role, string[]>> = {
  baker: ['baguette', 'baguette-tradition', 'pain-rond', 'pain-sandwich'],
  viennoiserie: ['viennoiseries'],
  pastry_chef: ['patisserie-classique', 'patisserie-premium', 'gateaux-cookies', 'les-boites', 'macaron', 'pieces-portions', 'plateau-sale-sucre', 'sachet-mini'],
  beldi_sale: ['beldi', 'sale', 'sale-soiree'],
};

/** Returns the category slugs a role can see, or null if the role sees everything */
export function getRoleCategorySlugs(role: string): string[] | null {
  return ROLE_CATEGORY_SLUGS[role as Role] || null;
}

/** Returns the chef role responsible for a given category slug, or 'general' if none */
export function getCategoryRole(slug: string): string {
  for (const [role, slugs] of Object.entries(ROLE_CATEGORY_SLUGS)) {
    if (slugs?.includes(slug)) return role;
  }
  return 'general';
}

/** Label map for assigned_role on sub-requests */
export const ASSIGNED_ROLE_LABELS: Record<string, string> = {
  baker: 'Boulanger',
  pastry_chef: 'Patissier',
  viennoiserie: 'Viennoiserie',
  beldi_sale: 'Beldi & Sale',
  general: 'General',
};
