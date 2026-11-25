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

// Build mobile (Capacitor) : API sur un autre domaine que le WebView.
const IS_MOBILE = !!import.meta.env.VITE_API_URL;

// G0-08 (V13) : sur le web, l'authentification passe par le seul cookie HttpOnly.
// Un ancien jeton resté dans localStorage n'est plus envoyé : il est purgé.
if (!IS_MOBILE) {
  try {
    localStorage.removeItem('ofauria_token');
    localStorage.removeItem('ofauria_user');
  } catch { /* stockage indisponible (navigation privée) */ }
}

api.interceptors.request.use((config) => {
  // Mobile uniquement : le cookie SameSite=Strict est refusé entre domaines, le
  // jeton de session est donc envoyé en Bearer (voir AuthContext).
  if (IS_MOBILE) {
    const token = localStorage.getItem('ofauria_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  // Send user's local timezone to the server
  config.headers['X-Timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '?';
      // Sur mobile : ne PAS hard-reload ni effacer le token. Un 401 sur une
      // requete secondaire (ex: settings, notifications) causait un cycle
      // "login -> deconnexion immediate". On laisse le composant afficher
      // l'erreur ; le vrai logout passe par AuthContext (me() ou /auth/logout).
      if (IS_MOBILE) {
        console.warn('[api] 401', url, '- token conserve (mobile)');
      } else {
        localStorage.removeItem('ofauria_token');
        localStorage.removeItem('ofauria_user');
        // Pages publiques (connexion, lien d'invitation) : pas de renvoi vers la connexion.
        if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/invitation/')) {
          // Constat 121 : la page de connexion dit pourquoi on y revient, et si la dernière
          // action (une écriture) n'a pas été enregistrée — plus de perte silencieuse.
          try {
            const method = String(error.config?.method || 'get').toLowerCase();
            sessionStorage.setItem('kalum_session_expired', method === 'get' ? 'read' : 'write');
          } catch { /* stockage indisponible : la redirection suffit */ }
          window.location.href = '/login';
        }
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
