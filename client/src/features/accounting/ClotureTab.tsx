import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, LockOpen, ShieldCheck, CalendarCheck } from 'lucide-react';
import { fiscalPeriodsApi } from '../../api/ledger.api';
import type { FiscalPeriod } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const STATUS_META: Record<string, { label: string; bg: string; color: string; icon: typeof Lock }> = {
  open:   { label: 'Ouverte',    bg: '#E1F5EE', color: '#085041', icon: LockOpen },
  closed: { label: 'Clôturée',   bg: '#FAEEDA', color: '#633806', icon: Lock },
  locked: { label: 'Verrouillée', bg: '#FCEBEB', color: '#791F1F', icon: ShieldCheck },
};

export default function ClotureTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ['ledger-fiscal-periods', year],
    queryFn: () => fiscalPeriodsApi.list(year),
    enabled: isAdmin,
  });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'open' | 'closed' | 'locked' }) =>
      fiscalPeriodsApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-fiscal-periods'] });
      notify.success('Période mise à jour');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la mise à jour');
    },
  });

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>La clôture est réservée à l'administrateur ou au gérant.</p>
      </div>
    );
  }

  const confirmAndRun = (id: string, status: 'open' | 'closed' | 'locked', label: string) => {
    if (status === 'locked' && !window.confirm('Verrouiller définitivement cette période ? Aucune correction ne sera plus possible (même par extourne).')) return;
    mutation.mutate({ id, status });
  };

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="odoo-search-input" style={{ minWidth: 100 }}>
          {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ flex: 1 }} />
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginBottom: 12 }}>
        <strong>Ouverte</strong> : écritures libres. <strong>Clôturée</strong> : plus de nouvelle écriture ;
        toute correction passe par une extourne automatique en période ouverte. <strong>Verrouillée</strong> :
        verrou définitif post-validation expert-comptable.
      </p>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Période</th>
                <th style={{ width: 200 }}>Dates</th>
                <th style={{ width: 130 }}>Statut</th>
                <th style={{ width: 280, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(periods as FiscalPeriod[]).map(p => {
                const meta = STATUS_META[p.status];
                const Icon = meta.icon;
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{MONTH_NAMES[p.month - 1]} {p.year}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                      {String(p.start_date).slice(0, 10)} → {String(p.end_date).slice(0, 10)}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.6875rem', padding: '3px 8px', borderRadius: 999, background: meta.bg, color: meta.color, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon size={11} /> {meta.label}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {p.status === 'open' && (
                          <button className="odoo-btn-secondary" disabled={mutation.isPending}
                            onClick={() => confirmAndRun(p.id, 'closed', 'Clôturer')}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Lock size={12} /> Clôturer
                          </button>
                        )}
                        {p.status === 'closed' && (
                          <>
                            <button className="odoo-btn-secondary" disabled={mutation.isPending}
                              onClick={() => confirmAndRun(p.id, 'open', 'Rouvrir')}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <LockOpen size={12} /> Rouvrir
                            </button>
                            <button className="odoo-btn-secondary" disabled={mutation.isPending}
                              onClick={() => confirmAndRun(p.id, 'locked', 'Verrouiller')}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#791F1F' }}>
                              <ShieldCheck size={12} /> Verrouiller
                            </button>
                          </>
                        )}
                        {p.status === 'locked' && (
                          <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>
                            Verrou définitif
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
