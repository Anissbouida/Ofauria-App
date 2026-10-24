import { z } from 'zod';

/**
 * Fournisseur — validation d'entrée (refonte Achats D1, G-D1-01).
 *
 * Règle d'or : une chaîne vide venue d'un formulaire devient NULL, jamais ''.
 * Les identifiants légaux (ICE, IF, RC…) ne sont PAS des colonnes : ce sont des
 * lignes typées `supplier_identifiers` dont le type vient du pack pays
 * (`identifier_types`). Le format exact est contrôlé en base par le type ; ici on
 * ne vérifie que la forme générale.
 */
const emptyToNull = (max: number) =>
  z.string().trim().max(max).transform(v => (v === '' ? null : v)).nullable().optional();

export const VAT_REGIMES = ['assujetti', 'non_assujetti', 'exonere'] as const;
export const LEGAL_FORMS = ['SARL', 'SARL AU', 'SA', 'SAS', 'SNC', 'personne_physique', 'auto_entrepreneur', 'cooperative', 'association', 'autre'] as const;

const identifierSchema = z.object({
  typeCode: z.string().trim().min(2).max(20).regex(/^[A-Z]{2}_[A-Z0-9_]{1,16}$/, 'Type d\'identifiant invalide'),
  value: z.string().trim().min(1, 'Valeur requise').max(60),
  qualifier: emptyToNull(60),
});

const supplierBase = z.object({
  name: z.string().trim().min(2, 'Le nom doit faire au moins 2 caractères').max(200),
  legalName: emptyToNull(200),
  legalForm: z.enum(LEGAL_FORMS).nullable().optional(),
  vatRegime: z.enum(VAT_REGIMES).optional(),
  parentSupplierId: z.string().uuid().nullable().optional(),
  contactName: emptyToNull(100),
  phone: emptyToNull(20),
  email: z.string().trim().max(255).transform(v => (v === '' ? null : v)).nullable().optional()
    .refine(v => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email invalide'),
  address: emptyToNull(2000),
  city: emptyToNull(100),
  notes: emptyToNull(5000),
  /** Liste complète des identifiants : remplace l'existant (absent = inchangé). */
  identifiers: z.array(identifierSchema).max(20).optional(),
});

export const createSupplierSchema = supplierBase;

export const updateSupplierSchema = supplierBase.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
