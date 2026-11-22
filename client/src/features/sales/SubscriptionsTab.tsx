import { money } from '../../utils/money';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Repeat, Plus, Play, Pause, X, Loader2, Eye, RotateCcw, Archive } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { subscriptionsApi, type Subscription, type SubscriptionDetail, type SubFrequency } from '../../api/subscriptions.api';
import { customersApi } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { createPortal } from 'react-dom';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { currencySymbol } from '../../utils/money';
import { KpiGrid, KpiCard, DataPanel, TableFooter, EmptyState, LoadingState } from '../../components/ds';

const day = (d: string | null) => d ? format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr }) : '—';
const FREQ: Record<SubFrequency, string> = { monthly: 'Mensuel', quarterly: 'Trimestriel', yearly: 'Annuel' };

/** `actionsSlot` : emplacement de la barre du haut où poser les actions de la page. */
export default function SubscriptionsTab({ actionsSlot }: { actionsSlot?: HTMLElement | null } = {}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['subscriptions'], queryFn: subscriptionsApi.list });
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => subscriptionsApi.generate({}),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); notify.success(r.posted > 0 ? `${r.posted} facture(s) générée(s) et comptabilisée(s)` : 'Aucune échéance due à facturer'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: 'active' | 'paused' | 'ended' }) => subscriptionsApi.setStatus(id, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const active = rows.filter(r => r.status === 'active');
  const onGenerate = async () => {
    if (await confirm('Générer les factures dues jusqu\'à aujourd\'hui ? Des factures émises seront créées et comptabilisées.', { title: 'Facturer les abonnements', confirmLabel: 'Générer' })) {
      generate.mutate();
    }
  };

  const headActions = (
    <>
      <button type="button" className="odoo-btn-secondary" disabled={generate.isPending} onClick={onGenerate}>
        {generate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Générer les factures dues
      </button>
      <button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Nouvel abonnement</button>
    </>
  );
  const menu = (r: Subscription): RowMenuItem[] => [
    ...(r.status === 'active' ? [{ label: 'Mettre en pause', icon: Pause, onSelect: () => status.mutate({ id: r.id, s: 'paused' as const }) }] : []),
    ...(r.status === 'paused' ? [{ label: 'Reprendre', icon: RotateCcw, onSelect: () => status.mutate({ id: r.id, s: 'active' as const }) }] : []),
  ];

  return (
    <div className="prj">
      {actionsSlot
        ? createPortal(headActions, actionsSlot)
        : <div className="prj-toolbar"><span style={{ flex: 1 }} />{headActions}</div>}

      <KpiGrid>
        <KpiCard label="Abonnements actifs" value={String(active.length)} sub={`${rows.length} au total`} />
        <KpiCard label="Total déjà facturé" value={money(rows.reduce((s, r) => s + Number(r.invoiced_total || 0), 0))} sub="factures générées par les abonnements" />
      </KpiGrid>

      {isLoading ? <LoadingState label="Chargement des abonnements…" /> : rows.length === 0 ? (
        <EmptyState icon={Repeat} title="Aucun abonnement" text="Un abonnement génère une facture client à échéance régulière." />
      ) : (
      <DataPanel label="Abonnements" footer={<TableFooter note={`${rows.length} abonnement${rows.length > 1 ? 's' : ''} · ${active.length} actif${active.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Client</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th><th>Fréquence</th>
              <th>Prochaine facture</th><th>État</th><th className="ds-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="ds-strong">{r.customer_name}</td>
                <td>{r.label}</td>
                <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{Number(r.amount).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{Number(r.tva_rate) > 0 && <span style={{ color: 'var(--ds-muted)', fontSize: '0.78rem' }}> + {Number(r.tva_rate)} % TVA</span>}</td>
                <td>{FREQ[r.frequency]}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.status === 'active' ? day(r.next_invoice_date) : '—'}</td>
                <td>
                  {r.status === 'active' ? <StatusTag tone="done" label="Actif" />
                    : r.status === 'paused' ? <StatusTag tone="cancelled" icon={Pause} label="En pause" />
                    : <StatusTag tone="cancelled" icon={Archive} label="Terminé" />}
                </td>
                <td className="ds-actions">
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setDetailId(r.id)}><Eye size={13} /> Factures</button>
                  <RowMenu items={menu(r)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}

      {showForm && <SubForm onClose={() => setShowForm(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); setShowForm(false); }} />}
      {detailId && <SubDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function SubForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [customerId, setCustomerId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [tvaRate, setTvaRate] = useState('0');
  const [frequency, setFrequency] = useState<SubFrequency>('monthly');
  const now = new Date();
  const [startDate, setStartDate] = useState(format(now, 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState('');

  const { data: custResp } = useQuery({ queryKey: ['customers-all'], queryFn: () => customersApi.list({ limit: '500' }) });
  const customers = ((custResp as { data?: Record<string, unknown>[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const custOptions = useMemo(() => customers.map(c => ({
    id: c.id as string,
    label: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Client',
    sublabel: (c.phone as string) || undefined,
  })), [customers]);

  const save = useMutation({
    mutationFn: () => subscriptionsApi.create({ customerId, label: label.trim(), amount: Number(amount), tvaRate: Number(tvaRate) || 0, frequency, startDate, endDate: endDate || null }),
    onSuccess: () => { notify.success('Abonnement créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const invalid = !customerId || !label.trim() || !(Number(amount) > 0) || (!!endDate && endDate < startDate);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(520px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Repeat size={16} /> Nouvel abonnement</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Client">
            <SearchSelect options={custOptions} value={customerId} onChange={setCustomerId} placeholder="Choisir un client…" width={468} />
          </Field>
          <Field label="Libellé"><input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex. Contrat pain quotidien" style={inp} /></Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Montant HT par échéance"><input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={inp} /></Field>
            <Field label="TVA (%)"><input type="number" step="0.01" min="0" max="100" value={tvaRate} onChange={e => setTvaRate(e.target.value)} style={inp} /></Field>
          </div>
          <Field label="Fréquence">
            <select value={frequency} onChange={e => setFrequency(e.target.value as SubFrequency)} style={inp}>
              <option value="monthly">Mensuel</option>
              <option value="quarterly">Trimestriel</option>
              <option value="yearly">Annuel</option>
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Première échéance"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} /></Field>
            <Field label="Fin (optionnel)"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inp} /></Field>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Créer
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function SubDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<SubscriptionDetail>({ queryKey: ['subscription', id], queryFn: () => subscriptionsApi.getById(id) });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(560px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Repeat size={16} /> {data?.label ?? 'Abonnement'}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 16px 16px' }}>
          {isLoading ? <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /></div> : (
            <>
              <p style={{ fontSize: '0.85rem', color: 'var(--theme-text-muted)', marginTop: 8 }}>{data?.customer_name} · {data && FREQ[data.frequency]} · {data && money(Number(data.amount))} HT</p>
              <table className="odoo-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr style={{ color: 'var(--theme-text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: 4 }}>Période</th><th style={{ padding: 4 }}>Facture</th>
                    <th style={{ padding: 4, textAlign: 'right' }}>TTC</th><th style={{ padding: 4 }}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.invoices.map((f, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--odoo-border)' }}>
                      <td style={{ padding: 4 }}>{day(f.period_date)}</td>
                      <td style={{ padding: 4, fontFamily: 'ui-monospace, monospace' }}>{f.invoice_number || '—'}</td>
                      <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(Number(f.amount_ttc))}</td>
                      <td style={{ padding: 4 }}>{f.invoice_status || '—'}</td>
                    </tr>
                  ))}
                  {data && data.invoices.length === 0 && <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune facture générée pour l'instant.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}

const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', width: '100%', font: 'inherit' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1 }}><span style={{ color: 'var(--theme-text-muted)' }}>{label}</span>{children}</label>;
}
