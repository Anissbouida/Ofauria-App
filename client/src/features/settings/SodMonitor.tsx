import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { purchasingSettingsApi } from '../../api/purchasing-settings.api';

/**
 * Suivi de la séparation des tâches (lot L2 P2P, mig 440). Affiché au-dessus des
 * réglages Achats : les 4 règles en vigueur et, en mode « Observer », les
 * manquements journalisés (ce que « Bloquer » refuserait). Lecture seule — le
 * mode se change via le réglage « Séparation des tâches (achats) » juste en dessous.
 */
export default function SodMonitor() {
  const { data, isLoading } = useQuery({ queryKey: ['purchasing-sod'], queryFn: purchasingSettingsApi.getSod, staleTime: 30_000 });
  const rules = data?.rules ?? [];
  const violations = data?.violations ?? [];
  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  if (!rules.length) return null; // migration non appliquée : rien à montrer

  const fmt = (d: string) => new Date(d).toLocaleDateString('fr-FR');

  return (
    <section className="odoo-scope" style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '12px 16px', display: 'grid', gap: 12, background: 'var(--odoo-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} style={{ color: 'var(--theme-accent)' }} />
        <div style={{ fontWeight: 600 }}>Séparation des tâches — suivi</div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {rules.map(r => (
          <div key={r.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: '0.8125rem' }}>
            <span style={{ color: 'var(--odoo-text)' }}>{r.label}</span>
            <span className={`odoo-tag ${r.is_active ? 'odoo-tag-blue' : 'odoo-tag-grey'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--odoo-text-muted)' }}>
          Manquements journalisés (90 derniers jours)
        </div>
        {violations.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 }}>
            Aucun manquement journalisé. En mode « Observer », une action enfreignant une règle apparaîtra ici (sans être bloquée).
          </p>
        ) : (
          <table className="odoo-table">
            <thead><tr><th>Règle</th><th>Acteur</th><th style={{ textAlign: 'right' }}>Occurrences</th><th style={{ textAlign: 'right' }}>Documents</th><th>Dernier</th></tr></thead>
            <tbody>
              {violations.map((v, i) => (
                <tr key={i}>
                  <td>{rules.find(r => r.code === v.rule_code)?.label ?? v.rule_code}</td>
                  <td>{v.actor}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.occurrences}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.documents}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(v.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
