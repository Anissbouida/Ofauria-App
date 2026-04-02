import api from './client';
import type { LoginRequest, LoginResponse } from '@ofauria/shared';

export const authApi = {
  login: (data: LoginRequest) => api.post<{ success: boolean; data: LoginResponse }>('/auth/login', data).then(r => r.data.data!),
  me: () => api.get('/auth/me').then(r => r.data.data),
  register: (data: Record<string, string>) => api.post('/auth/register', data).then(r => r.data.data),
};
