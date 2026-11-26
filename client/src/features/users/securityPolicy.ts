import { useQuery } from '@tanstack/react-query';
import { usersApi, type SecurityPolicy } from '../../api/users.api';

/**
 * Politique de sécurité côté écran (refonte Utilisateurs, lot 8) : mêmes valeurs par défaut que le
 * serveur (services/security-policy.ts) tant que la politique n'est pas chargée.
 */
export const POLICY_DEFAULTS: SecurityPolicy = {
  passwordMinLength: 12, passwordMaxAgeDays: 0, lockoutThreshold: 5, lockoutMinutes: 15,
  mfaGraceDays: 0, pinMinLength: 6, idleMinutes: 15, dormantDays: 60,
};

export function useSecurityPolicy(): SecurityPolicy {
  const { data } = useQuery({ queryKey: ['security-policy'], queryFn: usersApi.securityPolicy, retry: false, staleTime: 60_000 });
  return data?.policy ?? POLICY_DEFAULTS;
}

/** Mot de passe conforme : longueur de la politique et quatre familles de caractères. */
export const strongPasswordOk = (p: string, min: number) =>
  p.length >= min && p.length <= 128 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

export const passwordRule = (min: number) => `${min} caractères au moins, avec majuscule, minuscule, chiffre et caractère spécial`;

export const pinOk = (pin: string, min: number) => new RegExp(`^\\d{${min},10}$`).test(pin);

/** « Chrome · Windows » à partir de l'agent du navigateur ; poste de caisse ou inconnu sinon. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'Appareil inconnu';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /okhttp|Dart|Capacitor/i.test(ua) ? 'Application' : 'Navigateur';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'système inconnu';
  return `${browser} · ${os}`;
}

export const METHOD_LABELS: Record<string, string> = {
  password: 'Mot de passe', pin: 'Code PIN', passkey: 'Passkey', oidc: 'Connexion externe',
};
