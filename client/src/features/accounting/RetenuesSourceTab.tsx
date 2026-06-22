import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Settings, Receipt, Calendar, Send, Scale } from 'lucide-react';
import { withholdingApi } from '../../api/withholding.api';
import type { WithholdingType, ToRemitLine } from '../../api/withholding.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';

function n(v: string | number | null): string {
  const num = typeof v === 'string' ? parseFloat(v) : v;
  if (num === null || !Number.isFinite(num)) return '—';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RetenuesSourceTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [view, setView] = useState<'a_reverser' | 'config'>('a_reverser');

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>Les retenues à la source sont réservées à l'administrateur ou au gérant.</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'inline-flex', gap: 2, padding: 2, background: 'var(--theme-bg-secondary)', borderRadius: 8, marginBottom: 12 }}>
        {([
          { key: 'a_reverser' as const, label: 'À reverser à la DGI', icon: Send },
          { key: 'config' as const, label: 'Configuration des taux', icon: Settings },
        ]).map(t => {
          const Icon = t.icon; const active = view === t.key;
          return (
            <button key={t.key} onClick={() => setView(t.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6,
                border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: active ? 600 : 400,
                background: active ? 'var(--theme-bg-card)' : 'transparent',
                color: active ? 'var(--theme-text)' : 'var(--theme-text-muted)',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {view === 'a_reverser' ? <AReverserView /> : <ConfigView />}
    </>
  );
}

function AReverserView() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));
  const [reversing, setReversing] = useState<ToRemitLine | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['withholding-to-remit', startDate, endDate],
    queryFn: () => withholdingApi.toRemit(startDate, endDate),
  });

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="odoo-search-input" style={{ width: 140 }} />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="odoo-search-input" style={{ width: 140 }} />
        </div>
      </div>

      {data && (
        <div className="odoo-stat-grid">
          <div className="odoo-stat-card" style={{ border: `1.5px solid ${data.total_a_reverser > 0 ? '#b71c1c' : '#0e7c3a'}` }}>
            <div className="odoo-stat-card-label"><Scale size={11} style={{ display: 'inline', marginRight: 4 }} />Total à reverser à la DGI</div>
            <div className="odoo-stat-card-value" style={{ color: data.total_a_reverser > 0 ? '#b71c1c' : '#0e7c3a' }}>{n(data.total_a_reverser)}</div>
            <div className="odoo-stat-card-sub">DH · sur la période</div>
          </div>
        </div>
      )}

      {isLoading || !data ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Retenue</th>
                <th style={{ width: 70 }}>Compte</th>
                <th style={{ width: 110, textAlign: 'right' }}>Retenu</th>
                <th style={{ width: 110, textAlign: 'right' }}>Déjà reversé</th>
                <th style={{ width: 110, textAlign: 'right' }}>À reverser</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l: ToRemitLine) => {
                const aReverser = parseFloat(l.a_reverser) || 0;
                return (
                  <tr key={l.code}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{l.label}</div>
                      {l.legal_ref && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{l.legal_ref}</div>}
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{l.account_code}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(l.total_retenu)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>{n(l.total_reverse)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: aReverser > 0 ? '#b71c1c' : 'var(--theme-text-muted)' }}>{n(aReverser)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {aReverser > 0.01 && (
                        <button onClick={() => setReversing(l)} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Send size={12} /> Reverser
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.lines.every((l: ToRemitLine) => Math.abs(parseFloat(l.a_reverser) || 0) < 0.01) && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontStyle: 'italic', padding: '1.5rem' }}>Aucune retenue à reverser sur la période</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 8, fontStyle: 'italic' }}>
        Les retenues sont enregistrées au crédit des comptes 4452x. « Reverser » génère l'écriture 4452x → trésorerie et solde la dette envers la DGI.
      </p>

      {reversing && (
        <ReversementModal
          line={reversing}
          onClose={() => setReversing(null)}
          onDone={() => { setReversing(null); queryClient.invalidateQueries({ queryKey: ['withholding-to-remit'] }); queryClient.invalidateQueries({ queryKey: ['ledger-entries'] }); }}
        />
      )}
    </>
  );
}

function ReversementModal({ line, onClose, onDone }: { line: ToRemitLine; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(Math.round((parseFloat(line.a_reverser) || 0) * 100) / 100));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<'bank' | 'cash'>('bank');

  const reverse = useMutation({
    mutationFn: () => withholdingApi.reversement(line.code, parseFloat(amount), date, method),
    onSuccess: (r) => { notify.success(`Reversement enregistré (${r.entry_number})`); onDone(); },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message : null;
      notify.error(msg || 'Erreur reversement');
    },
  });

  const inputStyle = { width: '100%', padding: '7px 10px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };
  const labelStyle = { fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 };

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--theme-bg-card)', borderRadius: 8, width: 420, maxWidth: '95vw' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--theme-bg-separator)', fontWeight: 600, fontSize: '0.9375rem' }}>Reverser à la DGI — {line.label}</div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label style={labelStyle}>Montant (DH)</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={inputStyle} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>Moyen</label>
              <select value={method} onChange={e => setMethod(e.target.value as 'bank' | 'cash')} style={inputStyle}>
                <option value="bank">Banque (5141)</option>
                <option value="cash">Caisse (5161)</option>
              </select>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => reverse.mutate()} disabled={reverse.isPending || !(parseFloat(amount) > 0)} className="odoo-btn-primary" style={{ opacity: (reverse.isPending || !(parseFloat(amount) > 0)) ? 0.5 : 1 }}>
            {reverse.isPending ? 'Enregistrement...' : 'Confirmer le reversement'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigView() {
  const queryClient = useQueryClient();
  const { data: types = [], isLoading } = useQuery({
    queryKey: ['withholding-types'],
    queryFn: () => withholdingApi.listTypes(),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => withholdingApi.updateType(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['withholding-types'] }); notify.success('Taux mis à jour'); },
    onError: () => notify.error('Erreur mise à jour'),
  });

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={20} className="animate-spin" /></div>;

  return (
    <>
      <div className="odoo-section" style={{ padding: 0 }}>
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Type de retenue</th>
              <th style={{ width: 70 }}>Compte</th>
              <th style={{ width: 90, textAlign: 'right' }}>Taux %</th>
              <th style={{ width: 110, textAlign: 'right' }}>Seuil (DH)</th>
              <th style={{ width: 100, textAlign: 'right' }}>Taux &gt; seuil</th>
              <th style={{ width: 80 }}>Actif</th>
            </tr>
          </thead>
          <tbody>
            {(types as WithholdingType[]).map(t => (
              <tr key={t.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{t.label}</div>
                  {t.legal_ref && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{t.legal_ref}</div>}
                </td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{t.account_code}</td>
                <td style={{ textAlign: 'right' }}>
                  {t.code === 'ir_salaires' ? (
                    <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>barème (paie)</span>
                  ) : (
                    <input type="number" step="0.01" defaultValue={t.rate ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (String(v) !== String(t.rate)) update.mutate({ id: t.id, data: { rate: v } }); }}
                      style={{ width: 64, padding: '4px 6px', textAlign: 'right', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, background: 'var(--theme-bg-input)', fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }} />
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {t.code === 'ir_salaires' ? '—' : (
                    <input type="number" step="1" defaultValue={t.threshold ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (String(v) !== String(t.threshold)) update.mutate({ id: t.id, data: { threshold: v } }); }}
                      style={{ width: 90, padding: '4px 6px', textAlign: 'right', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, background: 'var(--theme-bg-input)', fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }} />
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {t.code === 'ir_salaires' ? '—' : (
                    <input type="number" step="0.01" defaultValue={t.rate_above ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (String(v) !== String(t.rate_above)) update.mutate({ id: t.id, data: { rateAbove: v } }); }}
                      style={{ width: 64, padding: '4px 6px', textAlign: 'right', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, background: 'var(--theme-bg-input)', fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }} />
                  )}
                </td>
                <td>
                  <input type="checkbox" checked={t.is_active} onChange={e => update.mutate({ id: t.id, data: { isActive: e.target.checked } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 8, fontStyle: 'italic' }}>
        <Receipt size={11} style={{ display: 'inline', marginRight: 4 }} />
        Taux par défaut basés sur le CGI / loi de finances 2026. Seul le 5 % sur produits de location (art. 73-II-A) est confirmé par la LF ;
        les autres sont à valider avec votre expert-comptable. Modification immédiate, sans redéploiement.
      </p>
    </>
  );
}
