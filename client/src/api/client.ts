import axios from 'axios';

// En mode web, utilise le proxy Vite (/api/v1)
// En mode mobile (Capacitor), utilise l'URL complète du serveur via VITE_API_URL
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  // OWASP A02-5 : envoyer le cookie HttpOnly d'auth avec chaque requete.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  // Legacy fallback : si un token traine dans localStorage (vieille session),
  // on l'envoie en Bearer. Retire apres migration complete.
  const legacyToken = localStorage.getItem('ofauria_token');
  if (legacyToken) {
    config.headers.Authorization = `Bearer ${legacyToken}`;
  }
  // Send user's local timezone to the server
  config.headers['X-Timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Plus de tokens en localStorage, mais on nettoie les legacy au cas ou.
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
