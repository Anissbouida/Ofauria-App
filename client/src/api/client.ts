import axios from 'axios';

// En mode web, utilise le proxy Vite (/api/v1)
// En mode mobile (Capacitor), utilise l'URL complète du serveur via VITE_API_URL
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1';

const api = axios.create({
  baseURL,
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

/**
 * Préfixe une URL relative (ex: /uploads/...) avec l'URL du serveur.
 * En mode web (proxy Vite), retourne l'URL telle quelle.
 * En mode mobile (Capacitor), préfixe avec VITE_API_URL.
 */
export function serverUrl(path: string): string {
  if (!path) return path;
  if (path.startsWith('http')) return path;
  const base = import.meta.env.VITE_API_URL || '';
  return `${base}${path}`;
}

export default api;
