import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Receipt, Send } from 'lucide-react';
import { withholdingApi } from '../../api/withholding.api';
import type { WithholdingType, ToRemitLine } from '../../api/withholding.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { currencySymbol } from '../../utils/money';
import { DataPanel, DateRangeField, EmptyState, ErrorState, FormField, FormFooter, FormSection, KpiCard, KpiGrid, LoadingState, Modal, Tabs, Toolbar } from '../../components/ds';

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
      <EmptyState icon={Lock} title="Les retenues à la source sont réservées à l'administrateur ou au gérant." />
    );
  }

  return (
    <>
      <Tabs label="Retenues à la source" value={view} onChange={setView}
        tabs={[{ key: 'a_reverser', label: 'À reverser à la DGI' }, { key: 'config', label: 'Configuration des taux' }]} />

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

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['withholding-to-remit', startDate, endDate],
    queryFn: () => withholdingApi.toRemit(startDate, endDate),
  });

  return (
    <>
      {data && (
        <KpiGrid>
          <KpiCard label="Total à reverser à la DGI" value={n(data.total_a_reverser)} sub={<>{currencySymbol()} · sur la période</>} tone={data.total_a_reverser > 0 ? 'red' : 'green'} />
        </KpiGrid>
      )}

      <Toolbar>
        <DateRangeField from={startDate} to={endDate} onFrom={setStartDate} onTo={setEndDate} />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} title="Les retenues n'ont pas pu être chargées" onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <LoadingState />
      ) : (
        <DataPanel>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Retenue</th>
                <th style={{ width: 70 }}>Compte</th>
                <th className="ds-num" style={{ width: 130 }}>Retenu ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 150 }}>Déjà reversé ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 140 }}>À reverser ({currencySymbol()})</th>
                <th className="ds-actions" style={{ width: 120 }}><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l: ToRemitLine) => {
                const aReverser = parseFloat(l.a_reverser) || 0;
                return (
                  <tr key={l.code}>
                    <td>
                      <div className="ds-strong">{l.label}</div>
                      {l.legal_ref && <div style={{ fontSize: 11, color: 'var(--ds-muted)' }}>{l.legal_ref}</div>}
                    </td>
                    <td className="ds-ref">{l.account_code}</td>
                    <td className="ds-num">{n(l.total_retenu)}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{n(l.total_reverse)}</td>
                    <td className="ds-num ds-strong" style={{ color: aReverser > 0 ? undefined : 'var(--ds-muted)' }}>{n(aReverser)}</td>
                    <td className="ds-actions">
                      {aReverser > 0.01 && (
                        <button type="button" onClick={() => setReversing(l)} className="odoo-btn-secondary ds-btn-sm">
                          <Send size={12} aria-hidden="true" /> Reverser
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.lines.every((l: ToRemitLine) => Math.abs(parseFloat(l.a_reverser) || 0) < 0.01) && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ds-muted)', padding: '1.5rem' }}>Aucune retenue à reverser sur la période</td></tr>
              )}
            </tbody>
          </table>
        </DataPanel>
      )}

      <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
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

  return (
    <Modal title="Reverser à la DGI" subtitle={line.label} onClose={onClose} width={460} locked={reverse.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => reverse.mutate()} busy={reverse.isPending}
        disabled={!(parseFloat(amount) > 0)} submitLabel="Confirmer le reversement" />}>
      <FormSection title="Reversement">
        <FormField label={`Montant (${currencySymbol()})`} htmlFor="ras-amount" required>
          <input id="ras-amount" className="ds-input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
        </FormField>
        <div className="ds-form-grid">
          <FormField label="Date" htmlFor="ras-date" required>
            <input id="ras-date" className="ds-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </FormField>
          <FormField label="Moyen" htmlFor="ras-method" required>
            <select id="ras-method" className="ds-input" value={method} onChange={e => setMethod(e.target.value as 'bank' | 'cash')}>
              <option value="bank">Banque (5141)</option>
              <option value="cash">Caisse (5161)</option>
            </select>
          </FormField>
        </div>
      </FormSection>
    </Modal>
  );
}

function ConfigView() {
  const queryClient = useQueryClient();
  const { data: types = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['withholding-types'],
    queryFn: () => withholdingApi.listTypes(),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => withholdingApi.updateType(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['withholding-types'] }); notify.success('Taux mis à jour'); },
    onError: () => notify.error('Erreur mise à jour'),
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState error={error} title="Les taux n'ont pas pu être chargés" onRetry={() => refetch()} />;

  return (
    <>
      <DataPanel>
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th>Type de retenue</th>
              <th style={{ width: 70 }}>Compte</th>
              <th className="ds-num" style={{ width: 90 }}>Taux %</th>
              <th className="ds-num" style={{ width: 110 }}>Seuil ({currencySymbol()})</th>
              <th className="ds-num" style={{ width: 100 }}>Taux &gt; seuil</th>
              <th style={{ width: 80 }}>Actif</th>
            </tr>
          </thead>
          <tbody>
            {(types as WithholdingType[]).map(t => (
              <tr key={t.id}>
                <td>
                  <div className="ds-strong">{t.label}</div>
                  {t.legal_ref && <div style={{ fontSize: 11, color: 'var(--ds-muted)' }}>{t.legal_ref}</div>}
                </td>
                <td className="ds-ref">{t.account_code}</td>
                <td className="ds-num">
                  {t.code === 'ir_salaires' ? (
                    <span style={{ fontSize: 11, color: 'var(--ds-muted)' }}>barème (paie)</span>
                  ) : (
                    <input type="number" step="0.01" defaultValue={t.rate ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (String(v) !== String(t.rate)) update.mutate({ id: t.id, data: { rate: v } }); }}
                      aria-label={`${t.label} : taux %`} className="ds-input sm" style={{ width: 72, textAlign: 'right' }} />
                  )}
                </td>
                <td className="ds-num">
                  {t.code === 'ir_salaires' ? '—' : (
                    <input type="number" step="1" defaultValue={t.threshold ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (String(v) !== String(t.threshold)) update.mutate({ id: t.id, data: { threshold: v } }); }}
                      aria-label={`${t.label} : seuil (${currencySymbol()})`} className="ds-input sm" style={{ width: 96, textAlign: 'right' }} />
                  )}
                </td>
                <td className="ds-num">
                  {t.code === 'ir_salaires' ? '—' : (
                    <input type="number" step="0.01" defaultValue={t.rate_above ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (String(v) !== String(t.rate_above)) update.mutate({ id: t.id, data: { rateAbove: v } }); }}
                      aria-label={`${t.label} : taux au-delà du seuil`} className="ds-input sm" style={{ width: 72, textAlign: 'right' }} />
                  )}
                </td>
                <td>
                  <input type="checkbox" aria-label={`${t.label} : actif`} checked={t.is_active} onChange={e => update.mutate({ id: t.id, data: { isActive: e.target.checked } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
        <Receipt size={11} style={{ display: 'inline', marginRight: 4 }} />
        Taux par défaut basés sur le CGI / loi de finances 2026. Seul le 5 % sur produits de location (art. 73-II-A) est confirmé par la LF ;
        les autres sont à valider avec votre expert-comptable. Modification immédiate, sans redéploiement.
      </p>
    </>
  );
}
