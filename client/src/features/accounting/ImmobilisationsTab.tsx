import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Lock, Plus, Trash2, Download, Building2, Play, CalendarClock, Eye, LogOut, Undo2,
} from 'lucide-react';
import { DisposalModal, CancelDisposalModal, AssetsTableView } from './ImmobilisationsCession';
import { apiErrorMessage } from '../../api/errors';
import { fixedAssetsApi } from '../../api/fixed-assets.api';
import type { FixedAsset } from '../../api/fixed-assets.api';
import { planComptableApi } from '../../api/ledger.api';
import type { Account } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { money, currencySymbol } from '../../utils/money';
import { DataPanel, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, Tabs, Toolbar, TableFooter, HeaderActions, Modal, FormSection, FormField, FormFooter } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';

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
  active: { label: 'En cours', bg: 'var(--ds-success-bg)', color: 'var(--ds-success)' },
  fully_depreciated: { label: 'Amortie', bg: 'var(--ds-hair)', color: 'var(--ds-muted)' },
  disposed: { label: 'Sortie', bg: 'var(--ds-danger-bg)', color: 'var(--ds-danger)' },
};

/** Ton de l'étiquette de statut : en cours (bleu), amortie (vert, terminé), sortie (gris). */
const ASSET_TONE: Record<string, StatusTone> = { active: 'progress', fully_depreciated: 'done', disposed: 'cancelled' };

export default function ImmobilisationsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const queryClient = useQueryClient();
  const now = new Date();
  const [showForm, setShowForm] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [deprMonth, setDeprMonth] = useState(now.getMonth() + 1);
  const [deprYear, setDeprYear] = useState(now.getFullYear());
  const [view, setView] = useState<'registre' | 'tableau'>('registre');
  const confirm = useConfirm();
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [cancelling, setCancelling] = useState<FixedAsset | null>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
    queryClient.invalidateQueries({ queryKey: ['fixed-assets-table'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
  };

  const { data: assets = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['fixed-assets'],
    queryFn: () => fixedAssetsApi.list(),
    enabled: isAdmin,
  });

  const runDepr = useMutation({
    mutationFn: () => fixedAssetsApi.runDepreciation(deprYear, deprMonth),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      notify.success(`${r.created} dotation(s) générée(s) · ${money(r.totalAmount)}${r.skipped ? ` · ${r.skipped} ignorée(s)` : ''}`);
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
    onError: (e) => notify.error(apiErrorMessage(e, 'Erreur suppression')),
  });

  const totals = useMemo(() => {
    let brut = 0, amort = 0;
    // Les immobilisations sorties ne sont plus à l'actif.
    for (const a of (assets as FixedAsset[]).filter(x => x.status !== 'disposed')) {
      brut += parseFloat(a.acquisition_cost) || 0;
      amort += parseFloat(a.total_depreciated) || 0;
    }
    return { brut, amort, vnc: brut - amort };
  }, [assets]);

  if (!isAdmin) {
    return (
      <EmptyState icon={Lock} title="Les immobilisations sont réservées à l'administrateur ou au gérant" />
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
      <KpiGrid>
        <KpiCard label="Valeur brute" value={n(totals.brut)} sub={<>{(assets as FixedAsset[]).filter(x => x.status !== 'disposed').length} immobilisation(s) à l'actif</>} />
        <KpiCard label="Amortissements cumulés" value={n(totals.amort)} sub="comptes 28xx" />
        <KpiCard label="Valeur nette comptable" value={n(totals.vnc)} sub="VNC" />
      </KpiGrid>

      <Tabs label="Immobilisations" value={view} onChange={setView}
        tabs={[{ key: 'registre', label: 'Registre' }, { key: 'tableau', label: 'Tableau de l\'exercice' }]} />

      {view === 'tableau' ? <AssetsTableView /> : <>
      {/* Barre d'actions */}
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={assets.length === 0}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <button type="button" onClick={() => setShowForm(true)} className="odoo-btn-primary">
          <Plus size={13} aria-hidden="true" /> Nouvelle immobilisation
        </button>
      </HeaderActions>

      <Toolbar>
        <span role="group" aria-label="Dotation aux amortissements" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-muted)' }}>
          <CalendarClock size={14} aria-hidden="true" /> Dotation du mois
          <select value={deprMonth} onChange={e => setDeprMonth(parseInt(e.target.value, 10))} className="ds-input sm" style={{ minWidth: 110, width: 'auto' }} aria-label="Mois de la dotation">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={deprYear} onChange={e => setDeprYear(parseInt(e.target.value, 10))} className="ds-input sm" style={{ minWidth: 80, width: 'auto' }} aria-label="Année de la dotation">
            {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </span>
        <button type="button" onClick={() => runDepr.mutate()} disabled={runDepr.isPending} aria-busy={runDepr.isPending || undefined} className="odoo-btn-secondary ds-btn-sm">
          {runDepr.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />} Lancer la dotation
        </button>
      </Toolbar>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : assets.length === 0 ? (
        <EmptyState icon={Building2} title="Aucune immobilisation" text="Ajoutez votre matériel : four, frigo, caisse…"
          action={<button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={13} aria-hidden="true" /> Nouvelle immobilisation</button>} />
      ) : (
        <DataPanel label="Registre des immobilisations" footer={<TableFooter note={`${assets.length} immobilisation${assets.length > 1 ? 's' : ''} · valeur nette ${n(totals.vnc)} ${currencySymbol()}`} />}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Libellé</th>
                <th style={{ width: 80 }}>Compte</th>
                <th style={{ width: 100 }}>Acquisition</th>
                <th className="ds-num" style={{ width: 120 }}>Coût ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 120 }}>Amorti ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 120 }}>VNC ({currencySymbol()})</th>
                <th style={{ width: 140 }}>Durée et méthode</th>
                <th style={{ width: 120 }}>Statut</th>
                <th className="ds-actions" style={{ width: 90 }}><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(assets as FixedAsset[]).map(a => {
                const cost = parseFloat(a.acquisition_cost) || 0;
                const amort = parseFloat(a.total_depreciated) || 0;
                const out = a.status === 'disposed';
                // Sortie : la VNC est celle du jour de sortie, plus à l'actif.
                const vnc = out ? parseFloat(a.disposal_vnc ?? '0') || 0 : cost - amort;
                const gain = parseFloat(a.disposal_gain ?? '0') || 0;
                return (
                  <tr key={a.id}>
                    <td className="ds-strong">{a.label}
                      {a.supplier_name && <span style={{ color: 'var(--ds-muted)', fontWeight: 400, fontSize: 12 }}> · {a.supplier_name}</span>}
                      {out && a.disposal_date && (
                        <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ds-muted)' }}>
                          {a.disposal_kind === 'sale' ? `Cédée le ${fmtDate(a.disposal_date)} · ${n(a.disposal_price ?? 0)} HT${a.disposal_buyer ? ` · ${a.disposal_buyer}` : ''}` : `Mise au rebut le ${fmtDate(a.disposal_date)}`}
                          {' · '}<span style={{ color: gain >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{gain >= 0 ? 'plus-value' : 'moins-value'} {n(Math.abs(gain))}</span>
                        </div>
                      )}
                    </td>
                    <td className="ds-ref">{a.asset_account_code}</td>
                    <td>{fmtDate(a.acquisition_date)}</td>
                    <td className="ds-num">{n(cost)}</td>
                    <td className="ds-num">{n(out ? parseFloat(a.disposal_cumulated ?? '0') || amort : amort)}</td>
                    <td className="ds-num ds-strong">{n(vnc)}</td>
                    <td>{a.duration_years} ans · {a.method === 'linear' ? 'linéaire' : 'dégressif'}</td>
                    <td><StatusTag tone={ASSET_TONE[a.status] ?? 'progress'} label={(STATUS_LABELS[a.status] || STATUS_LABELS.active).label} /></td>
                    <td className="ds-actions">
                      <button type="button" onClick={() => setScheduleId(a.id)} className="ds-icon-btn" title="Plan d'amortissement" aria-label={`Plan d'amortissement de ${a.label}`}><Eye size={15} /></button>
                      <RowMenu items={out
                        ? [{ label: 'Annuler la sortie', icon: Undo2, onSelect: () => setCancelling(a) }]
                        : [
                          { label: 'Céder ou mettre au rebut', icon: LogOut, onSelect: () => setDisposing(a) },
                          { label: 'Supprimer (saisie erronée)', icon: Trash2, danger: true, onSelect: async () => {
                            if (await confirm(`Supprimer « ${a.label} » et ses écritures de dotation ?`, { title: 'Supprimer l\'immobilisation', danger: true, confirmLabel: 'Supprimer' })) removeAsset.mutate(a.id);
                          } },
                        ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      </>}

      {disposing && <DisposalModal asset={disposing} onClose={() => setDisposing(null)} onDone={() => { setDisposing(null); refresh(); }} />}
      {cancelling && <CancelDisposalModal asset={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); refresh(); }} />}
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

  const acc = (list: Account[]) => list.map(a => ({ id: String(a.id), label: `${a.code} — ${a.label}` }));

  return (
    <Modal title="Nouvelle immobilisation" onClose={onClose} width={600} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} disabled={!valid} submitLabel="Créer" />}>
      <FormSection title="Bien">
        <FormField label="Libellé" htmlFor="fa-label" required>
          <input id="fa-label" className="ds-input" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Four à pain, frigo vitrine..." />
        </FormField>
        <div className="ds-form-grid">
          <FormField label="Date d'acquisition" htmlFor="fa-date" required>
            <input id="fa-date" className="ds-input" type="date" value={form.acquisitionDate} onChange={e => setForm({ ...form, acquisitionDate: e.target.value })} />
          </FormField>
          <FormField label={`Coût d'acquisition (${currencySymbol()})`} htmlFor="fa-cost" required>
            <input id="fa-cost" className="ds-input" type="number" step="0.01" value={form.acquisitionCost} onChange={e => setForm({ ...form, acquisitionCost: e.target.value })} />
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Comptes">
        <div className="ds-form-grid">
          <FormField label="Compte immobilisation (23xx)" required>
            <SearchSelect value={form.assetAccountId} onChange={v => setForm({ ...form, assetAccountId: v })}
              placeholder="—" width="100%" size="md" ariaLabel="Compte immobilisation" options={acc(assetAccounts)} />
          </FormField>
          <FormField label="Compte amortissement (28xx)" required>
            <SearchSelect value={form.depreciationAccountId} onChange={v => setForm({ ...form, depreciationAccountId: v })}
              placeholder="—" width="100%" size="md" ariaLabel="Compte amortissement" options={acc(deprAccounts)} />
          </FormField>
          <FormField label="Compte dotation (619x)" required>
            <SearchSelect value={form.expenseAccountId} onChange={v => setForm({ ...form, expenseAccountId: v })}
              placeholder="—" width="100%" size="md" ariaLabel="Compte dotation" options={acc(expenseAccounts)} />
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Amortissement">
        <div className="ds-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <FormField label={`Valeur résiduelle (${currencySymbol()})`} htmlFor="fa-residual">
            <input id="fa-residual" className="ds-input" type="number" step="0.01" value={form.residualValue} onChange={e => setForm({ ...form, residualValue: e.target.value })} />
          </FormField>
          <FormField label="Durée (ans)" htmlFor="fa-duration" required>
            <input id="fa-duration" className="ds-input" type="number" value={form.durationYears} onChange={e => setForm({ ...form, durationYears: e.target.value })} />
          </FormField>
          <FormField label="Méthode" htmlFor="fa-method">
            <select id="fa-method" className="ds-input" value={form.method} onChange={e => setForm({ ...form, method: e.target.value as 'linear' | 'degressive' })}>
              <option value="linear">Linéaire</option>
              <option value="degressive">Dégressif</option>
            </select>
          </FormField>
        </div>
      </FormSection>
    </Modal>
  );
}

function ScheduleModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['fixed-asset-schedule', id], queryFn: () => fixedAssetsApi.schedule(id) });
  return (
    <Modal title={data ? `Plan d'amortissement — ${data.asset.label}` : 'Plan d\'amortissement'} onClose={onClose} width={680}>
      {isError ? (
        <ErrorState bare error={error} title="Le plan n'a pas pu être chargé" onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <LoadingState bare />
      ) : (
        <DataPanel label="Plan d'amortissement">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Période</th>
                <th className="ds-num">Dotation ({currencySymbol()})</th>
                <th className="ds-num">Cumul ({currencySymbol()})</th>
                <th className="ds-num">VNC ({currencySymbol()})</th>
                <th style={{ width: 110, textAlign: 'center' }}>Comptabilisé</th>
              </tr>
            </thead>
            <tbody>
              {data.schedule.map((l, i) => (
                <tr key={i} style={l.posted ? { background: 'var(--ds-bg)' } : undefined}>
                  <td>{String(l.month).padStart(2, '0')}/{l.year}</td>
                  <td className="ds-num">{n(l.amount)}</td>
                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{n(l.cumulated)}</td>
                  <td className="ds-num ds-strong">{n(l.vnc)}</td>
                  <td style={{ textAlign: 'center' }}>{l.posted ? <span style={{ color: 'var(--ds-success)' }} aria-label="Oui">✓</span> : <span style={{ color: 'var(--ds-muted)' }} aria-label="Non">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </Modal>
  );
}
