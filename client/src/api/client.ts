import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ofauria_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Send user's local timezone to the server
  config.headers['X-Timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ofauria_token');
      localStorage.removeItem('ofauria_user');
      // Don't redirect if already on login page (prevents infinite reload loop)
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
