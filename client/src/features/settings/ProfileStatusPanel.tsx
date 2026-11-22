import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, AlertCircle, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import { SectionHeader } from '../../components/ds';

/**
 * Configuration du profil d'industrie (C-03) : une tuile par couche avec son état et l'écran
 * où la régler, et l'avancement global. Lecture seule ; « par défaut » n'est pas une erreur :
 * la valeur du profil s'applique.
 */
type LayerState = 'configured' | 'default' | 'todo';
interface ProfileLayer { key: string; label: string; state: LayerState; detail: string; to: string }
interface ProfileStatus { sector: { code: string; label: string }; layers: ProfileLayer[]; configured: number; total: number }

const STATE: Record<LayerState, { label: string; color: string; icon: typeof Circle }> = {
  configured: { label: 'Configuré', color: 'var(--ds-success)', icon: CheckCircle2 },
  default: { label: 'Par défaut', color: 'var(--ds-muted)', icon: Circle },
  todo: { label: 'À compléter', color: 'var(--ds-warning)', icon: AlertCircle },
};

export default function ProfileStatusPanel() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['profile-status'],
    queryFn: () => api.get('/settings/profile-status').then(r => r.data.data as ProfileStatus),
  });
  if (!data) return null;
  const pct = data.total ? Math.round(data.configured / data.total * 100) : 0;
  const todo = data.layers.filter(l => l.state === 'todo').length;

  return (
    <section className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12 }} aria-label="Configuration du profil">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <SectionHeader title={`Configuration du profil « ${data.sector.label} »`} />
          <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
            {data.configured} couche(s) réglée(s) sur {data.total}{todo ? ` · ${todo} à compléter` : ''}. « Par défaut » : la valeur du profil s'applique.
          </div>
        </div>
        <div style={{ minWidth: 160 }} aria-label={`Avancement ${pct} %`}>
          <div style={{ height: 6, background: 'var(--ds-sep)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ds-accent)' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ds-muted)', textAlign: 'right', marginTop: 2 }}>{pct} %</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
        {data.layers.map(l => {
          const st = STATE[l.state];
          const Icon = st.icon;
          return (
            <button key={l.key} type="button" onClick={() => navigate(l.to)}
              style={{ textAlign: 'left', border: '1px solid var(--ds-sep)', borderRadius: 12, padding: '9px 12px',
                background: 'var(--ds-card)', color: 'var(--ds-ink)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              aria-label={`${l.label} : ${st.label}. ${l.detail}`}>
              <Icon size={16} style={{ color: st.color, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 500, fontSize: '0.8125rem' }}>{l.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: st.color }}>{st.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.detail}</span>
              </span>
              <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
