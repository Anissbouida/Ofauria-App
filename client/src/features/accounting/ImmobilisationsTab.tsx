import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Lock, Plus, Trash2, X, Download, Building2, Play, CalendarClock, Eye,
} from 'lucide-react';
import { fixedAssetsApi } from '../../api/fixed-assets.api';
import type { FixedAsset } from '../../api/fixed-assets.api';
import { planComptableApi } from '../../api/ledger.api';
import type { Account } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

function n(v: string | number): string {
  const num = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(num)) return '0,00';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(raw: string): string {
  const s = String(raw).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '﻿';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  active: { label: 'En cours', bg: '#E1F5EE', color: '#085041' },
  fully_depreciated: { label: 'Amortie', bg: '#F1EFE8', color: '#444441' },
  disposed: { label: 'Cédée', bg: '#FCEBEB', color: '#791F1F' },
};

export default function ImmobilisationsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();
  const now = new Date();
  const [showForm, setShowForm] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [deprMonth, setDeprMonth] = useState(now.getMonth() + 1);
  const [deprYear, setDeprYear] = useState(now.getFullYear());

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['fixed-assets'],
    queryFn: () => fixedAssetsApi.list(),
    enabled: isAdmin,
  });

  const runDepr = useMutation({
    mutationFn: () => fixedAssetsApi.runDepreciation(deprYear, deprMonth),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      notify.success(`${r.created} dotation(s) générée(s) · ${n(r.totalAmount)} DH${r.skipped ? ` · ${r.skipped} ignorée(s)` : ''}`);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message : null;
      notify.error(msg || 'Erreur génération dotations');
    },
  });

  const removeAsset = useMutation({
    mutationFn: (id: string) => fixedAssetsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      notify.success('Immobilisation supprimée');
    },
    onError: () => notify.error('Erreur suppression'),
  });

  const totals = useMemo(() => {
    let brut = 0, amort = 0;
    for (const a of assets as FixedAsset[]) {
      brut += parseFloat(a.acquisition_cost) || 0;
      amort += parseFloat(a.total_depreciated) || 0;
    }
    return { brut, amort, vnc: brut - amort };
  }, [assets]);

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>Les immobilisations sont réservées à l'administrateur.</p>
      </div>
    );
  }

  const handleExport = () => {
    const rows: string[][] = (assets as FixedAsset[]).map(a => {
      const vnc = (parseFloat(a.acquisition_cost) || 0) - (parseFloat(a.total_depreciated) || 0);
      return [a.label, a.asset_account_code, fmtDate(a.acquisition_date), a.acquisition_cost,
        a.total_depreciated, String(vnc.toFixed(2)), `${a.duration_years} ans`, a.method];
    });
    exportCSV(`immobilisations_${new Date().toISOString().slice(0, 10)}.csv`,
      ['LIBELLE', 'COMPTE', 'ACQUISITION', 'COUT', 'AMORTI', 'VNC', 'DUREE', 'METHODE'], rows);
  };

  return (
    <>
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Valeur brute</div>
          <div className="odoo-stat-card-value">{n(totals.brut)}</div>
          <div className="odoo-stat-card-sub">{(assets as FixedAsset[]).length} immobilisation(s)</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Amortissements cumulés</div>
          <div className="odoo-stat-card-value" style={{ color: '#c62828' }}>{n(totals.amort)}</div>
          <div className="odoo-stat-card-sub">comptes 28xx</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Valeur nette comptable</div>
          <div className="odoo-stat-card-value" style={{ color: '#1565c0' }}>{n(totals.vnc)}</div>
          <div className="odoo-stat-card-sub">VNC</div>
        </div>
      </div>

      {/* Barre d'actions */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> Nouvelle immobilisation
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <CalendarClock size={13} style={{ color: 'var(--theme-text-muted)' }} />
          <select value={deprMonth} onChange={e => setDeprMonth(parseInt(e.target.value, 10))} className="odoo-search-input" style={{ minWidth: 110 }}>
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={deprYear} onChange={e => setDeprYear(parseInt(e.target.value, 10))} className="odoo-search-input" style={{ minWidth: 80 }}>
            {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => runDepr.mutate()} disabled={runDepr.isPending} className="odoo-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {runDepr.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Lancer la dotation
          </button>
        </div>
        <button onClick={handleExport} className="odoo-btn-secondary" disabled={assets.length === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: assets.length === 0 ? 0.5 : 1 }}>
          <Download size={13} /> Exporter
        </button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : assets.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Building2 size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune immobilisation. Ajoutez votre matériel (four, frigo, caisse...).</p>
        </div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Libellé</th>
                <th style={{ width: 70 }}>Compte</th>
                <th style={{ width: 90 }}>Acquisition</th>
                <th style={{ width: 100, textAlign: 'right' }}>Coût</th>
                <th style={{ width: 100, textAlign: 'right' }}>Amorti</th>
                <th style={{ width: 100, textAlign: 'right' }}>VNC</th>
                <th style={{ width: 110 }}>Durée / Méthode</th>
                <th style={{ width: 90 }}>Statut</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {(assets as FixedAsset[]).map(a => {
                const cost = parseFloat(a.acquisition_cost) || 0;
                const amort = parseFloat(a.total_depreciated) || 0;
                const vnc = cost - amort;
                const st = STATUS_LABELS[a.status] || STATUS_LABELS.active;
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{a.label}
                      {a.supplier_name && <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontSize: '0.75rem' }}> · {a.supplier_name}</span>}
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{a.asset_account_code}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{fmtDate(a.acquisition_date)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(cost)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: '#c62828' }}>{n(amort)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#1565c0' }}>{n(vnc)}</td>
                    <td style={{ fontSize: '0.75rem' }}>{a.duration_years} ans · {a.method === 'linear' ? 'linéaire' : 'dégressif'}</td>
                    <td>
                      <span style={{ fontSize: '0.625rem', padding: '2px 7px', borderRadius: 999, background: st.bg, color: st.color, fontWeight: 500 }}>{st.label}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <button onClick={() => setScheduleId(a.id)} className="odoo-btn-secondary" title="Plan d'amortissement" style={{ padding: '4px 6px' }}><Eye size={12} /></button>
                        <button onClick={() => { if (window.confirm(`Supprimer "${a.label}" et ses écritures de dotation ?`)) removeAsset.mutate(a.id); }} className="odoo-btn-secondary" title="Supprimer" style={{ padding: '4px 6px', color: '#c62828' }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <AssetForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['fixed-assets'] }); }} />}
      {scheduleId && <ScheduleModal id={scheduleId} onClose={() => setScheduleId(null)} />}
    </>
  );
}

function AssetForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: accounts = [] } = useQuery({ queryKey: ['ledger-accounts'], queryFn: () => planComptableApi.list() });
  const assetAccounts = (accounts as Account[]).filter(a => a.account_class === 2 && !a.code.startsWith('28'));
  const deprAccounts = (accounts as Account[]).filter(a => a.code.startsWith('28'));
  const expenseAccounts = (accounts as Account[]).filter(a => a.code.startsWith('619'));

  const [form, setForm] = useState({
    label: '', assetAccountId: '', depreciationAccountId: '', expenseAccountId: '',
    acquisitionDate: new Date().toISOString().slice(0, 10), acquisitionCost: '', residualValue: '0',
    durationYears: '5', method: 'linear' as 'linear' | 'degressive', notes: '',
  });

  const save = useMutation({
    mutationFn: () => fixedAssetsApi.create({
      ...form,
      acquisitionCost: parseFloat(form.acquisitionCost),
      residualValue: parseFloat(form.residualValue) || 0,
      durationYears: parseInt(form.durationYears, 10),
    }),
    onSuccess: () => { notify.success('Immobilisation créée'); onSaved(); },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message : null;
      notify.error(msg || 'Erreur création');
    },
  });

  const valid = form.label && form.assetAccountId && form.depreciationAccountId && form.expenseAccountId
    && form.acquisitionCost && parseFloat(form.acquisitionCost) > 0 && parseInt(form.durationYears, 10) > 0;

  const inputStyle = { width: '100%', padding: '7px 10px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };
  const labelStyle = { fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ background: 'var(--theme-bg-card)', borderRadius: 8, maxWidth: 560, width: '95vw', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={16} /><strong style={{ fontSize: '0.9375rem' }}>Nouvelle immobilisation</strong>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Libellé *</label>
            <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Four à pain, frigo vitrine..." style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Compte immobilisation (23xx) *</label>
              <select value={form.assetAccountId} onChange={e => setForm({ ...form, assetAccountId: e.target.value })} style={inputStyle}>
                <option value="">—</option>
                {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Compte amortissement (28xx) *</label>
              <select value={form.depreciationAccountId} onChange={e => setForm({ ...form, depreciationAccountId: e.target.value })} style={inputStyle}>
                <option value="">—</option>
                {deprAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Compte dotation (619x) *</label>
            <select value={form.expenseAccountId} onChange={e => setForm({ ...form, expenseAccountId: e.target.value })} style={inputStyle}>
              <option value="">—</option>
              {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Date d'acquisition *</label>
              <input type="date" value={form.acquisitionDate} onChange={e => setForm({ ...form, acquisitionDate: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Coût d'acquisition (DH) *</label>
              <input type="number" step="0.01" value={form.acquisitionCost} onChange={e => setForm({ ...form, acquisitionCost: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Valeur résiduelle</label>
              <input type="number" step="0.01" value={form.residualValue} onChange={e => setForm({ ...form, residualValue: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Durée (ans) *</label>
              <input type="number" value={form.durationYears} onChange={e => setForm({ ...form, durationYears: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Méthode</label>
              <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value as 'linear' | 'degressive' })} style={inputStyle}>
                <option value="linear">Linéaire</option>
                <option value="degressive">Dégressif</option>
              </select>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => save.mutate()} disabled={!valid || save.isPending} className="odoo-btn-primary" style={{ opacity: (!valid || save.isPending) ? 0.5 : 1 }}>
            {save.isPending ? 'Création...' : 'Créer'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function ScheduleModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['fixed-asset-schedule', id], queryFn: () => fixedAssetsApi.schedule(id) });
  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ background: 'var(--theme-bg-card)', borderRadius: 8, maxWidth: 640, width: '95vw', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarClock size={16} /><strong style={{ fontSize: '0.9375rem' }}>{data ? `Plan d'amortissement — ${data.asset.label}` : 'Chargement...'}</strong>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={16} /></button>
        </div>
        {isLoading || !data ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}><Loader2 size={20} className="animate-spin" /></div>
        ) : (
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Période</th>
                <th style={{ textAlign: 'right' }}>Dotation</th>
                <th style={{ textAlign: 'right' }}>Cumul</th>
                <th style={{ textAlign: 'right' }}>VNC</th>
                <th style={{ width: 90, textAlign: 'center' }}>Comptabilisé</th>
              </tr>
            </thead>
            <tbody>
              {data.schedule.map((l, i) => (
                <tr key={i} style={l.posted ? { background: 'var(--theme-bg-secondary)' } : undefined}>
                  <td style={{ fontSize: '0.75rem' }}>{String(l.month).padStart(2, '0')}/{l.year}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(l.amount)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>{n(l.cumulated)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: '#1565c0' }}>{n(l.vnc)}</td>
                  <td style={{ textAlign: 'center' }}>{l.posted ? <span style={{ color: '#0e7c3a' }}>✓</span> : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ModalBackdrop>
  );
}
