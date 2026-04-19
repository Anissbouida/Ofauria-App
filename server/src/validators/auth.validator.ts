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

// OWASP A07-1 : PIN numerique de 4 a 10 chiffres.
// NOTE TRANSITION : la recommandation est >= 6 chiffres (10^6 combinaisons).
// On accepte temporairement 4 chiffres pour les comptes legacy (Khadija, etc.).
// Le rate limit (5 tentatives/heure) + lockout compte apres 5 echecs (A04-2)
// rendent le brute-force de 10 000 combinaisons long. A reserrer a {6,10}
// une fois tous les comptes migres.
export const pinLoginSchema = z.object({
  pinCode: z.string().regex(/^\d{4,10}$/, 'PIN numerique de 4 a 10 chiffres'),
});
