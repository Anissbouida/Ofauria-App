import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { paymentRunsApi, type TransferColumn, type TransferFormat } from '../../api/accounting.api';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { LoadingState, Modal, FormSection, FormField, FormFooter, DataPanel } from '../../components/ds';

/**
 * Format du fichier de virement d'un compte bancaire (G4-01, mig 600).
 *
 * Chaque portail bancaire importe son propre fichier (colonnes, séparateur, montant en
 * centimes, positions fixes…). On le décrit ici une fois par compte ; sans format, le fichier
 * est le CSV générique (le même que pour les salaires). L'aperçu est calculé par le serveur.
 */
const ALL: TransferColumn[] = ['seq', 'name', 'rib', 'bank', 'amount', 'motif', 'date', 'debit_rib', 'currency', 'reference'];
const DEFAULT_WIDTH: Record<TransferColumn, number> = { seq: 5, name: 35, rib: 24, bank: 30, amount: 15, motif: 35, date: 8, debit_rib: 24, currency: 3, reference: 20 };

export default function TransferFormatDialog({ banks, initialId, onClose }: { banks: { id: string; label: string }[]; initialId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(initialId);
  const { data, isLoading } = useQuery({ queryKey: ['transfer-format', accountId], queryFn: () => paymentRunsApi.transferFormat(accountId), enabled: !!accountId });
  const [f, setF] = useState<TransferFormat | null>(null);
  useEffect(() => { if (data) setF(data.format); }, [data]);
  const set = <K extends keyof TransferFormat>(k: K, v: TransferFormat[K]) => setF(x => (x ? { ...x, [k]: v } : x));

  const save = useMutation({
    mutationFn: (format: TransferFormat | null) => paymentRunsApi.saveTransferFormat(accountId, format),
    onSuccess: (view, format) => {
      qc.setQueryData(['transfer-format', accountId], view);
      notify.success(format ? 'Format enregistré' : 'Format générique rétabli');
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const fixed = f?.separator === 'fixed';
  const toggle = (c: TransferColumn) => f && set('columns', f.columns.includes(c) ? f.columns.filter(x => x !== c) : [...f.columns, c]);
  const move = (i: number, d: -1 | 1) => {
    if (!f) return;
    const cols = [...f.columns];
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    set('columns', cols);
  };
  const payload = (): TransferFormat | null => {
    if (!f) return null;
    if (!fixed) { const { widths: _w, ...rest } = f; void _w; return rest; }
    return { ...f, header: false, widths: Object.fromEntries(f.columns.map(c => [c, f.widths?.[c] ?? DEFAULT_WIDTH[c]])) };
  };

  return (
    <Modal title="Format du fichier de virement" onClose={onClose} width={760} locked={save.isPending}
      aside={data && <StatusTag tone={data.isGeneric ? 'draft' : 'done'} label={data.isGeneric ? 'Générique' : 'Propre à la banque'} />}
      subtitle="Décrivez le fichier qu'attend le portail de virement de masse de la banque (voir sa notice d'import). Le RIB du bénéficiaire et le montant sont obligatoires."
      footer={
        <FormFooter onCancel={onClose} cancelLabel="Fermer" onSubmit={() => save.mutate(payload())} busy={save.isPending} disabled={!f}>
          <button type="button" className="odoo-btn-secondary" disabled={!data || data.isGeneric || save.isPending} onClick={() => save.mutate(null)}><RotateCcw size={13} /> Rétablir le format générique</button>
        </FormFooter>
      }>
      <FormSection title="Compte">
        <FormField label="Compte bancaire" htmlFor="tf-account" required>
          <select id="tf-account" className="ds-input" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </FormField>
      </FormSection>

      {isLoading || !f || !data ? <LoadingState /> : (
        <>
          <FormSection title="Mise en forme">
            <div className="ds-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <FormField label="Séparateur" htmlFor="tf-sep">
                <select id="tf-sep" className="ds-input" value={f.separator} onChange={e => set('separator', e.target.value as TransferFormat['separator'])}>
                  <option value=";">Point-virgule ;</option><option value=",">Virgule ,</option><option value="tab">Tabulation</option>
                  <option value="|">Barre |</option><option value="fixed">Positions fixes</option>
                </select>
              </FormField>
              <FormField label="Montant" htmlFor="tf-amount">
                <select id="tf-amount" className="ds-input" value={f.amountInCents ? 'cents' : f.decimal} onChange={e => {
                  const v = e.target.value;
                  setF(x => (x ? { ...x, amountInCents: v === 'cents', decimal: v === ',' ? ',' : '.' } : x));
                }}>
                  <option value=".">1234.50</option><option value=",">1234,50</option><option value="cents">En centimes (123450)</option>
                </select>
              </FormField>
              <FormField label="Date" htmlFor="tf-date">
                <select id="tf-date" className="ds-input" value={f.dateFormat} onChange={e => set('dateFormat', e.target.value as TransferFormat['dateFormat'])}>
                  <option value="DD/MM/YYYY">30/11/2026</option><option value="YYYY-MM-DD">2026-11-30</option>
                  <option value="YYYYMMDD">20261130</option><option value="DDMMYYYY">30112026</option>
                </select>
              </FormField>
              <FormField label="Fin de ligne" htmlFor="tf-eol">
                <select id="tf-eol" className="ds-input" value={f.lineEnding} onChange={e => set('lineEnding', e.target.value as TransferFormat['lineEnding'])}>
                  <option value="crlf">Windows (CRLF)</option><option value="lf">Unix (LF)</option>
                </select>
              </FormField>
              <FormField label="Extension" htmlFor="tf-ext">
                <select id="tf-ext" className="ds-input" value={f.extension} onChange={e => set('extension', e.target.value as TransferFormat['extension'])}>
                  <option value="csv">.csv</option><option value="txt">.txt</option>
                </select>
              </FormField>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 14, flexWrap: 'wrap' }}>
              <label htmlFor="tf-header" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', opacity: fixed ? 0.5 : 1 }}>
                <input id="tf-header" type="checkbox" disabled={fixed} checked={!fixed && f.header} onChange={e => set('header', e.target.checked)} /> Ligne d'en-tête
              </label>
              <label htmlFor="tf-upper" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input id="tf-upper" type="checkbox" checked={f.uppercase} onChange={e => set('uppercase', e.target.checked)} /> Noms en majuscules sans accents
              </label>
            </div>
          </FormSection>

          <FormSection title="Colonnes">
            <DataPanel label="Colonnes du fichier">
              <table className="odoo-table ds-dense">
                <thead><tr><th style={{ width: 36 }} /><th>Colonne</th><th className="ds-num" style={{ width: 60 }}>Ordre</th>
                  {fixed && <th className="ds-num" style={{ width: 90 }}>Largeur</th>}<th className="ds-actions" style={{ width: 70 }} /></tr></thead>
                <tbody>
                  {[...f.columns, ...ALL.filter(c => !f.columns.includes(c))].map(c => {
                    const i = f.columns.indexOf(c);
                    const on = i >= 0;
                    return (
                      <tr key={c} style={{ opacity: on ? 1 : 0.55 }}>
                        <td><input type="checkbox" checked={on} onChange={() => toggle(c)} aria-label={`Inclure ${data.columns[c]}`} /></td>
                        <td className="ds-strong">{data.columns[c]}</td>
                        <td className="ds-num">{on ? i + 1 : '—'}</td>
                        {fixed && <td className="ds-num">{on && (
                          <input className="ds-input sm" inputMode="numeric" style={{ width: 70, textAlign: 'right' }} aria-label={`Largeur de ${data.columns[c]}`}
                            value={String(f.widths?.[c] ?? DEFAULT_WIDTH[c])}
                            onChange={e => set('widths', { ...(f.widths ?? {}), [c]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                        )}</td>}
                        <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>{on && (
                          <>
                            <button type="button" className="ds-icon-btn" title="Monter" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter"><ArrowUp size={12} /></button>
                            <button type="button" className="ds-icon-btn" title="Descendre" disabled={i === f.columns.length - 1} onClick={() => move(i, 1)} aria-label="Descendre"><ArrowDown size={12} /></button>
                          </>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataPanel>
          </FormSection>

          <FormSection title="Aperçu du format enregistré (deux bénéficiaires fictifs)">
            <pre style={{ margin: 0, padding: 10, fontSize: 12, background: 'var(--ds-bg)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre' }}>
              {data.preview.replace(/\t/g, '→')}
            </pre>
          </FormSection>
        </>
      )}
    </Modal>
  );
}
