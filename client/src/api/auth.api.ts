import api from './client';
import type { LoginRequest, LoginResponse } from '@ofauria/shared';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

/** Passkey enregistrée (écran « Mes passkeys », mig 705). */
export type Passkey = { id: string; label: string; createdAt: string; lastUsedAt: string | null; synced: boolean; rpId: string };

/** Le navigateur sait-il utiliser les passkeys ? (jamais dans l'application mobile). */
export const passkeysSupported = () => !import.meta.env.VITE_API_URL && browserSupportsWebAuthn();

/** Annulation par l'utilisateur (fenêtre Face ID fermée, délai dépassé) : pas une erreur à afficher. */
export const passkeyCancelled = (e: unknown) => (e as { name?: string })?.name === 'NotAllowedError' || (e as { name?: string })?.name === 'AbortError';

export const authApi = {
  login: (data: LoginRequest) => api.post<{ success: boolean; data: LoginResponse }>('/auth/login', data).then(r => r.data.data!),
  /** G6-01 : second facteur. */
  verifyMfa: (mfaToken: string, code: string, rememberDevice = false) => api.post<{ success: boolean; data: LoginResponse }>('/auth/mfa/verify', { mfaToken, code, rememberDevice }).then(r => r.data.data!),
  // G0-06 : le compte est choisi sur une tuile, puis le PIN est saisi.
  pinUsers: () => api.get('/auth/pin-users').then(r => r.data.data) as Promise<{ id: string; firstName: string; lastInitial: string }[]>,
  pinLogin: (userId: string, pinCode: string) => api.post<{ success: boolean; data: LoginResponse }>('/auth/pin-login', { userId, pinCode }).then(r => r.data.data!),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data.data as { token?: string; mustChangePassword: boolean }),
  logout: () => api.post('/auth/logout').then(r => r.data),
  usersList: () => api.get('/auth/users-list').then(r => r.data.data) as Promise<{ id: string; firstName: string; lastName: string; role: string }[]>,
  me: () => api.get('/auth/me').then(r => r.data.data),
  /** Invitation d'un nouveau compte (refonte Utilisateurs, lot 3) : routes publiques. */
  invitation: (token: string) => api.get(`/auth/invitations/${encodeURIComponent(token)}`).then(r => r.data.data) as Promise<{ status: 'valid' | 'expired' | 'used' | 'revoked' | 'unknown'; email?: string; firstName?: string; expiresAt?: string; message?: string }>,
  acceptInvitation: (token: string, password: string) => api.post(`/auth/invitations/${encodeURIComponent(token)}/accept`, { password }).then(r => r.data.data as { email: string }),
  register: (data: Record<string, string>) => api.post('/auth/register', data).then(r => r.data.data),

  /**
   * Passkeys (mig 705). Connexion : sans mfaToken = sans mot de passe ; avec mfaToken = second
   * facteur après le mot de passe. Le navigateur affiche Face ID / Touch ID / Windows Hello.
   */
  loginWithPasskey: async (mfaToken?: string, rememberDevice = false): Promise<LoginResponse> => {
    const { options, ticket } = (await api.post('/auth/passkeys/login/options', mfaToken ? { mfaToken } : {})).data.data;
    const response = await startAuthentication({ optionsJSON: options });
    return (await api.post('/auth/passkeys/login/verify', { ticket, response, rememberDevice })).data.data;
  },
  passkeys: () => api.get('/auth/passkeys').then(r => r.data.data as Passkey[]),
  addPasskey: async (label?: string): Promise<Passkey> => {
    const { options, ticket } = (await api.post('/auth/passkeys/register/options', {})).data.data;
    const response = await startRegistration({ optionsJSON: options });
    return (await api.post('/auth/passkeys/register/verify', { ticket, response, ...(label ? { label } : {}) })).data.data;
  },
  renamePasskey: (id: string, label: string) => api.patch(`/auth/passkeys/${id}`, { label }).then(r => r.data.data as Passkey),
  removePasskey: (id: string) => api.delete(`/auth/passkeys/${id}`).then(r => r.data.data),
};
