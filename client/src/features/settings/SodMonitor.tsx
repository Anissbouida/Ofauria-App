import { useState } from 'react';
import { DataPanel } from '../../components/ds';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { purchasingSettingsApi } from '../../api/purchasing-settings.api';
import { StatusTag } from '../../components/ui/StatusTag';

/**
 * Suivi de la séparation des tâches (lot L2 P2P, mig 442). Affiché au-dessus des
 * réglages Achats : les 4 règles en vigueur et, en mode « Observer », les
 * manquements journalisés (ce que « Bloquer » refuserait). Lecture seule — le
 * mode se change via le réglage « Séparation des tâches (achats) » juste en dessous.
 * `compact` (refonte des pages de règles) : une pastille par règle avec ses écarts,
 * le tableau détaillé sur demande.
 */
export default function SodMonitor({ compact = false }: { compact?: boolean }) {
  const [detail, setDetail] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['purchasing-sod'], queryFn: purchasingSettingsApi.getSod, staleTime: 30_000 });
  const rules = data?.rules ?? [];
  const violations = data?.violations ?? [];
  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  if (!rules.length) return null; // migration non appliquée : rien à montrer

  const fmt = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const table = (
    <DataPanel label="Manquements journalisés">
      <table className="odoo-table ds-dense">
        <thead><tr><th>Règle</th><th>Acteur</th><th className="ds-num">Occurrences</th><th className="ds-num">Documents</th><th>Dernier</th></tr></thead>
        <tbody>
          {violations.map((v, i) => (
            <tr key={i}>
              <td className="ds-strong">{rules.find(r => r.code === v.rule_code)?.label ?? v.rule_code}</td>
              <td>{v.actor}</td>
              <td className="ds-num">{v.occurrences}</td>
              <td className="ds-num">{v.documents}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmt(v.last_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );

  if (compact) {
    const countOf = (code: string) => violations.filter(v => v.rule_code === code).reduce((n, v) => n + Number(v.occurrences), 0);
    return (
      <div className="odoo-sod-compact">
        <div className="odoo-sod-chips">
          {rules.map(r => {
            const n = countOf(r.code);
            return (
              <span key={r.code} className={`odoo-sod-chip${n ? ' warn' : ''}${r.is_active ? '' : ' off'}`} title={r.is_active ? 'Règle active' : 'Règle inactive'}>
                {r.label} : <strong>{n ? `${n} écart${n > 1 ? 's' : ''}` : 'aucun écart'}</strong>
              </span>
            );
          })}
        </div>
        {violations.length > 0 && (
          <button type="button" className="odoo-sod-more" onClick={() => setDetail(!detail)}>
            {detail ? 'Masquer le détail' : 'Voir le détail des 90 derniers jours'}
          </button>
        )}
        {detail && table}
      </div>
    );
  }

  return (
    <section className="ds-panel" style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} style={{ color: 'var(--ds-accent)' }} />
        <div style={{ fontWeight: 600 }}>Séparation des tâches — suivi</div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {rules.map(r => (
          <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: '0.8125rem' }}>
            <span style={{ color: 'var(--ds-ink)' }}>{r.label}</span>
            <StatusTag tone={r.is_active ? 'done' : 'cancelled'} label={r.is_active ? 'Active' : 'Inactive'} />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ds-muted)' }}>
          Manquements journalisés (90 derniers jours)
        </div>
        {violations.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)', margin: 0 }}>
            Aucun manquement journalisé. En mode « Observer », une action enfreignant une règle apparaîtra ici (sans être bloquée).
          </p>
        ) : table}
      </div>
    </section>
  );
}
