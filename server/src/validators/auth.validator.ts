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
  // Roles editables (table roles, mig 330) : format du code ici, existence
  // verifiee par la cle etrangere users.role -> roles.code.
  role: z.string().regex(/^[a-z][a-z0-9_]{1,29}$/, 'Role invalide'),
});

// G0-06 : la connexion par PIN désigne d'abord le compte (tuile), puis le PIN.
// Le serveur ne compare qu'un hachage. Les PIN de 4 chiffres antérieurs restent
// acceptés À LA CONNEXION (sinon ces comptes seraient bloqués) ; le verrouillage
// du compte après 5 échecs borne l'essai des 10 000 combinaisons.
export const pinLoginSchema = z.object({
  userId: z.string().uuid('Choisissez votre nom'),
  pinCode: z.string().regex(/^\d{4,10}$/, 'PIN numerique de 4 a 10 chiffres'),
});

/** Tout NOUVEAU PIN : 6 à 10 chiffres. */
export const NEW_PIN_RE = /^\d{6,10}$/;
export const NEW_PIN_MIN_LENGTH = 6;

/** Le mot de passe respecte-t-il la politique en vigueur ? (comptes antérieurs) */
export const meetsPasswordPolicy = (password: string) => strongPassword.safeParse(password).success;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis').max(128),
  newPassword: strongPassword,
});
