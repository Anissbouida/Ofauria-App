import { money } from '../../utils/money';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Repeat, Plus, Play, Pause, Loader2, Eye, RotateCcw, Archive } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { subscriptionsApi, type Subscription, type SubscriptionDetail, type SubFrequency } from '../../api/subscriptions.api';
import { customersApi } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import SearchSelect from '../../components/ui/SearchSelect';
import { createPortal } from 'react-dom';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { currencySymbol } from '../../utils/money';
import { KpiGrid, KpiCard, DataPanel, TableFooter, EmptyState, LoadingState, ErrorState, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

const day = (d: string | null) => d ? format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr }) : '—';
const FREQ: Record<SubFrequency, string> = { monthly: 'Mensuel', quarterly: 'Trimestriel', yearly: 'Annuel' };

/** `actionsSlot` : emplacement de la barre du haut où poser les actions de la page. */
export default function SubscriptionsTab({ actionsSlot }: { actionsSlot?: HTMLElement | null } = {}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['subscriptions'], queryFn: subscriptionsApi.list });
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

      {isLoading ? <LoadingState label="Chargement des abonnements…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : rows.length === 0 ? (
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

  const dirty = !!(customerId || label || amount);
  const endError = !!endDate && endDate < startDate ? 'La fin doit suivre la première échéance.' : undefined;

  return (
    <Modal title="Nouvel abonnement" onClose={onClose} width={520} locked={save.isPending}
      footer={<FormFooter dirty={dirty} onCancel={onClose} onSubmit={() => save.mutate()} submitLabel="Créer" disabled={invalid} busy={save.isPending} />}>
      <FormSection title="Abonnement">
        <FormField label="Client" required>
          <SearchSelect options={custOptions} value={customerId} onChange={setCustomerId} placeholder="Choisir un client…" ariaLabel="Client" width="100%" size="md" />
        </FormField>
        <FormField label="Libellé" htmlFor="sub-label" required>
          <input id="sub-label" type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex. Contrat pain quotidien" className="ds-input" />
        </FormField>
        <div className="ds-form-grid">
          <FormField label={`Montant HT par échéance (${currencySymbol()})`} htmlFor="sub-amount" required>
            <input id="sub-amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="ds-input" />
          </FormField>
          <FormField label="TVA (%)" htmlFor="sub-tva">
            <input id="sub-tva" type="number" step="0.01" min="0" max="100" value={tvaRate} onChange={e => setTvaRate(e.target.value)} className="ds-input" />
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Échéancier">
        <FormField label="Fréquence" htmlFor="sub-freq">
          <select id="sub-freq" value={frequency} onChange={e => setFrequency(e.target.value as SubFrequency)} className="ds-input">
            <option value="monthly">Mensuel</option>
            <option value="quarterly">Trimestriel</option>
            <option value="yearly">Annuel</option>
          </select>
        </FormField>
        <div className="ds-form-grid">
          <FormField label="Première échéance" htmlFor="sub-start" required>
            <input id="sub-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="ds-input" />
          </FormField>
          <FormField label="Fin (optionnel)" htmlFor="sub-end" error={endError}>
            <input id="sub-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="ds-input" />
          </FormField>
        </div>
      </FormSection>
    </Modal>
  );
}

function SubDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError, error, refetch } = useQuery<SubscriptionDetail>({ queryKey: ['subscription', id], queryFn: () => subscriptionsApi.getById(id) });
  return (
    <Modal title={data?.label ?? 'Abonnement'} subtitle={data ? `${data.customer_name} · ${FREQ[data.frequency]} · ${money(Number(data.amount))} HT` : undefined} onClose={onClose} width={560}>
      {isLoading ? <LoadingState bare /> : isError ? <ErrorState error={error} onRetry={() => refetch()} bare /> : (
        <DataPanel label="Factures de l'abonnement">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Période</th><th>Facture</th>
                <th className="ds-num">TTC ({currencySymbol()})</th><th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data?.invoices.map((f, i) => (
                <tr key={i}>
                  <td>{day(f.period_date)}</td>
                  <td>{f.invoice_number ? <span className="ds-ref">{f.invoice_number}</span> : '—'}</td>
                  <td className="ds-num">{Number(f.amount_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td>{f.invoice_status || '—'}</td>
                </tr>
              ))}
              {data && data.invoices.length === 0 && <tr><td colSpan={4}><EmptyState bare icon={Repeat} title="Aucune facture générée pour l'instant." /></td></tr>}
            </tbody>
          </table>
        </DataPanel>
      )}
    </Modal>
  );
}
