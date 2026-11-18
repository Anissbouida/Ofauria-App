import api from './client';
import type { LoginRequest, LoginResponse } from '@ofauria/shared';

export const authApi = {
  login: (data: LoginRequest) => api.post<{ success: boolean; data: LoginResponse }>('/auth/login', data).then(r => r.data.data!),
  /** G6-01 : second facteur. */
  verifyMfa: (mfaToken: string, code: string) => api.post<{ success: boolean; data: LoginResponse }>('/auth/mfa/verify', { mfaToken, code }).then(r => r.data.data!),
  // G0-06 : le compte est choisi sur une tuile, puis le PIN est saisi.
  pinUsers: () => api.get('/auth/pin-users').then(r => r.data.data) as Promise<{ id: string; firstName: string; lastInitial: string }[]>,
  pinLogin: (userId: string, pinCode: string) => api.post<{ success: boolean; data: LoginResponse }>('/auth/pin-login', { userId, pinCode }).then(r => r.data.data!),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data.data as { token?: string; mustChangePassword: boolean }),
  logout: () => api.post('/auth/logout').then(r => r.data),
  usersList: () => api.get('/auth/users-list').then(r => r.data.data) as Promise<{ id: string; firstName: string; lastName: string; role: string }[]>,
  me: () => api.get('/auth/me').then(r => r.data.data),
  register: (data: Record<string, string>) => api.post('/auth/register', data).then(r => r.data.data),
};
