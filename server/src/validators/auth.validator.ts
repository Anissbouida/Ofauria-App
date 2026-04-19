import { z } from 'zod';

// OWASP A07-4 : politique de mot de passe pour NOUVEAUX comptes / reset.
// Le login n'impose pas la politique (sinon les anciens comptes sont bloques).
const strongPassword = z.string()
  .min(12, 'Minimum 12 caracteres')
  .max(128, 'Maximum 128 caracteres')
  .regex(/[A-Z]/, 'Au moins une majuscule')
  .regex(/[a-z]/, 'Au moins une minuscule')
  .regex(/[0-9]/, 'Au moins un chiffre')
  .regex(/[^A-Za-z0-9]/, 'Au moins un caractere special');

// Laxiste au login — un user legacy avec password court doit pouvoir se connecter.
export const loginSchema = z.object({
  email: z.string().email('Email invalide').max(255),
  password: z.string().min(1, 'Mot de passe requis').max(128),
});

// Strict a la creation.
export const registerSchema = z.object({
  email: z.string().email('Email invalide').max(255),
  password: strongPassword,
  firstName: z.string().min(1, 'Prenom requis').max(100),
  lastName: z.string().min(1, 'Nom requis').max(100),
  // Roles : liste complete (shared/constants/roles.ts). Le middleware authorize
  // fera les verifications supplementaires.
  role: z.enum(['admin', 'manager', 'cashier', 'saleswoman', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale']),
});

// OWASP A07-1 : PIN minimum 6 chiffres (10^6 combinaisons = 11.5 jours
// de brute-force a 1 req/s, acceptable avec lockout + rate limit actifs).
// A terme, passer a 8 chiffres est recommande (migration coordonnee UI).
export const pinLoginSchema = z.object({
  pinCode: z.string().regex(/^\d{6,10}$/, 'PIN numerique de 6 a 10 chiffres'),
});
