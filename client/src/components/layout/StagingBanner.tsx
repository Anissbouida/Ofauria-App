import { useEffect, useState } from 'react';
import api from '../../api/client';

/**
 * G3-01 — bandeau « STAGING » : affiché sur toutes les pages quand le serveur tourne avec
 * APP_ENV=staging, pour qu'aucune saisie de test ne soit confondue avec la production.
 * Lu une fois au chargement ; une erreur réseau n'affiche rien.
 */
export default function StagingBanner() {
  const [env, setEnv] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<{ environment: string }>('/env')
      .then(r => { if (alive) setEnv(r.data.environment); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (env !== 'staging') return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
        background: '#b45309', color: '#fff', font: '600 11px/1 system-ui, sans-serif', letterSpacing: '0.08em',
        padding: '4px 12px', borderRadius: '0 0 6px 6px', pointerEvents: 'none',
      }}
    >
      STAGING — données de test, e-mails détournés
    </div>
  );
}
