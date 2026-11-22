import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarClock, Plus, Play, X, Loader2 } from 'lucide-react';
import { prepaidChargesApi } from '../../api/prepaid-charges.api';
import { planComptableApi } from '../../api/ledger.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { money as fmtMoney, currencySymbol } from '../../utils/money';
import { LoadingState, DataPanel, KpiGrid, KpiCard, EmptyState, TableFooter } from '../../components/ds';
import { AccHeaderActions } from './AccHeaderActions';

/**
 * Charges constatées d'avance (compte 486). On enregistre une dépense qui couvre
 * une période à venir (assurance, abonnement annuel…) : son montant est sorti des
 * charges vers l'actif, puis repassé en charge mois par mois. La « Constatation »
 * passe les écritures des mois échus.
 */

const money = (v: number) => fmtMoney(v);
/** Montant sans devise : l'unité est dans l'en-tête de colonne. */
const amt = (v: number) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });

export default function PrepaidChargesTab() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['prepaid-charges'], queryFn: prepaidChargesApi.list });
  const [showForm, setShowForm] = useState(false);

  const recognizeAll = useMutation({
    mutationFn: () => prepaidChargesApi.recognize({}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['prepaid-charges'] });
      notify.success(r.posted > 0 ? `${r.posted} constatation(s) comptabilisée(s)` : 'Aucun mois échu à constater');
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const totalRemaining = useMemo(() => rows.reduce((s, r) => s + r.remaining, 0), [rows]);
  const active = rows.filter(r => r.status === 'active');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={CalendarClock} title="Charges constatées d'avance (compte 486)">
        Une dépense qui couvre une période à venir est étalée sur les mois concernés. À la création, le montant est reclassé en actif (débit 486) ; chaque mois échu, « Constater » le repasse en charge au prorata.
      </StatusBanner>

      <KpiGrid>
        <KpiCard label="Reste à constater" value={money(totalRemaining)} sub={<>{active.length} charge{active.length > 1 ? 's' : ''} en cours</>} />
      </KpiGrid>

      <AccHeaderActions>
        <button type="button" className="odoo-btn-secondary" disabled={recognizeAll.isPending} onClick={() => recognizeAll.mutate()} aria-busy={recognizeAll.isPending || undefined}>
          {recognizeAll.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />} Constater les mois échus
        </button>
        <button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={14} aria-hidden="true" /> Nouvelle charge
        </button>
      </AccHeaderActions>

      {isLoading ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Aucune charge constatée d'avance" text="Créez une charge payée d'avance pour l'étaler sur les mois qu'elle couvre."
          action={<button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}><Plus size={14} aria-hidden="true" /> Nouvelle charge</button>} />
      ) : (
      <DataPanel label="Charges payées d'avance" footer={<TableFooter note={`${rows.length} charge${rows.length > 1 ? 's' : ''} · reste à constater ${money(totalRemaining)}`} />}>
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th>Libellé</th><th>Compte</th><th>Période</th>
              <th className="ds-num">Total ({currencySymbol()})</th>
              <th className="ds-num">Constaté ({currencySymbol()})</th>
              <th className="ds-num">Reste ({currencySymbol()})</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const pct = r.total_amount > 0 ? Math.round(r.recognized / r.total_amount * 100) : 0;
              return (
                <tr key={r.id}>
                  <td className="ds-strong">{r.label}</td>
                  <td>
                    <span className="ds-ref">{r.charge_account_code}</span> <span style={{ color: 'var(--ds-muted)' }}>{r.charge_account_label}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{day(r.start_date)} → {day(r.end_date)} <span style={{ color: 'var(--theme-text-muted)' }}>({r.months} mois)</span></td>
                  <td className="ds-num">{amt(r.total_amount)}</td>
                  <td className="ds-num">
                    {amt(r.recognized)}
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--theme-bg-secondary)', marginTop: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--theme-accent)' }} />
                    </div>
                  </td>
                  <td className="ds-num ds-strong">{amt(r.remaining)}</td>
                  <td>
                    <StatusTag tone={r.status === 'done' ? 'done' : r.status === 'cancelled' ? 'cancelled' : 'progress'}
                      label={r.status === 'done' ? 'Soldée' : r.status === 'cancelled' ? 'Annulée' : 'En cours'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataPanel>
      )}

      {showForm && <PrepaidForm onClose={() => setShowForm(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['prepaid-charges'] }); setShowForm(false); }} />}
    </div>
  );
}

function PrepaidForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const y = new Date().getFullYear();
  const [label, setLabel] = useState('');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState(`${y}-01-01`);
  const [endDate, setEndDate] = useState(`${y}-12-31`);

  const { data: accounts = [] } = useQuery({ queryKey: ['ledger-accounts'], queryFn: () => planComptableApi.list() });
  const chargeAccounts = useMemo(
    () => (accounts as { code: string; label: string; account_class: number; is_active: boolean }[])
      .filter(a => a.account_class === 6 && a.is_active)
      .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  const save = useMutation({
    mutationFn: () => prepaidChargesApi.create({ label: label.trim(), chargeAccountCode: account, totalAmount: Number(amount), startDate, endDate }),
    onSuccess: () => { notify.success('Charge constatée d\'avance créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const invalid = !label.trim() || !account || !(Number(amount) > 0) || endDate < startDate;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(520px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><CalendarClock size={16} /> Nouvelle charge constatée d'avance</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Libellé">
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex. Assurance locaux 2026" className="ds-input sm" />
          </Field>
          <Field label="Compte de charge (classe 6)">
            <SearchSelect value={account} onChange={setAccount}
              placeholder="— Choisir —" width="100%" size="md" ariaLabel="Compte de charge"
              options={chargeAccounts.map(a => ({ id: String(a.code), label: `${a.code} — ${a.label}` }))} />
          </Field>
          <Field label={`Montant total (${currencySymbol()})`}>
            <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="ds-input sm" />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Début de période"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="ds-input sm" /></Field>
            <Field label="Fin de période"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="ds-input sm" /></Field>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)', margin: 0 }}>
            Le montant sera étalé linéairement sur les mois couverts. La création passe l'écriture de reclassement (débit 486 / crédit {account || '6x'}).
          </p>
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


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1 }}>
      <span style={{ color: 'var(--theme-text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}
