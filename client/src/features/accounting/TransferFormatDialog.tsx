import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, RotateCcw, Save, X } from 'lucide-react';
import { paymentRunsApi, type TransferColumn, type TransferFormat } from '../../api/accounting.api';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Format du fichier de virement d'un compte bancaire (G4-01, mig 600).
 *
 * Chaque portail bancaire importe son propre fichier (colonnes, séparateur, montant en
 * centimes, positions fixes…). On le décrit ici une fois par compte ; sans format, le fichier
 * est le CSV générique (le même que pour les salaires). L'aperçu est calculé par le serveur.
 */
const ALL: TransferColumn[] = ['seq', 'name', 'rib', 'bank', 'amount', 'motif', 'date', 'debit_rib', 'currency', 'reference'];
const DEFAULT_WIDTH: Record<TransferColumn, number> = { seq: 5, name: 35, rib: 24, bank: 30, amount: 15, motif: 35, date: 8, debit_rib: 24, currency: 3, reference: 20 };
const lbl: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8rem', fontWeight: 500 };

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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" onClick={e => e.stopPropagation()} role="dialog" aria-label="Format du fichier de virement"
        style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', background: 'var(--odoo-bg)', borderRadius: 6, padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: '1rem' }}>Format du fichier de virement</strong>
          {data && <StatusTag tone={data.isGeneric ? 'draft' : 'done'} label={data.isGeneric ? 'Générique' : 'Propre à la banque'} />}
          <button type="button" className="odoo-pager-btn" style={{ marginLeft: 'auto' }} onClick={onClose} title="Fermer"><X size={14} /></button>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>
          Décrivez le fichier qu'attend le portail de virement de masse de la banque (voir sa notice d'import). Le RIB du bénéficiaire et le montant sont obligatoires.
        </div>
        <label style={lbl}>Compte bancaire
          <select className="odoo-input" value={accountId} onChange={e => setAccountId(e.target.value)} aria-label="Compte bancaire">
            {banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>

        {isLoading || !f || !data ? <Loader2 size={16} className="animate-spin" /> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <label style={lbl}>Séparateur
                <select className="odoo-input" value={f.separator} onChange={e => set('separator', e.target.value as TransferFormat['separator'])}>
                  <option value=";">Point-virgule ;</option><option value=",">Virgule ,</option><option value="tab">Tabulation</option>
                  <option value="|">Barre |</option><option value="fixed">Positions fixes</option>
                </select></label>
              <label style={lbl}>Montant
                <select className="odoo-input" value={f.amountInCents ? 'cents' : f.decimal} onChange={e => {
                  const v = e.target.value;
                  setF(x => (x ? { ...x, amountInCents: v === 'cents', decimal: v === ',' ? ',' : '.' } : x));
                }}>
                  <option value=".">1234.50</option><option value=",">1234,50</option><option value="cents">En centimes (123450)</option>
                </select></label>
              <label style={lbl}>Date
                <select className="odoo-input" value={f.dateFormat} onChange={e => set('dateFormat', e.target.value as TransferFormat['dateFormat'])}>
                  <option value="DD/MM/YYYY">30/11/2026</option><option value="YYYY-MM-DD">2026-11-30</option>
                  <option value="YYYYMMDD">20261130</option><option value="DDMMYYYY">30112026</option>
                </select></label>
              <label style={lbl}>Fin de ligne
                <select className="odoo-input" value={f.lineEnding} onChange={e => set('lineEnding', e.target.value as TransferFormat['lineEnding'])}>
                  <option value="crlf">Windows (CRLF)</option><option value="lf">Unix (LF)</option>
                </select></label>
              <label style={lbl}>Extension
                <select className="odoo-input" value={f.extension} onChange={e => set('extension', e.target.value as TransferFormat['extension'])}>
                  <option value="csv">.csv</option><option value="txt">.txt</option>
                </select></label>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', opacity: fixed ? 0.5 : 1 }}>
                <input type="checkbox" disabled={fixed} checked={!fixed && f.header} onChange={e => set('header', e.target.checked)} /> Ligne d'en-tête
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={f.uppercase} onChange={e => set('uppercase', e.target.checked)} /> Noms en majuscules sans accents
              </label>
            </div>

            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, overflowX: 'auto' }}>
              <table className="odoo-table" style={{ width: '100%', margin: 0 }}>
                <thead><tr><th style={{ width: 36 }} /><th style={{ textAlign: 'left' }}>Colonne</th><th style={{ textAlign: 'right', width: 60 }}>Ordre</th>
                  {fixed && <th style={{ textAlign: 'right', width: 90 }}>Largeur</th>}<th style={{ width: 70 }} /></tr></thead>
                <tbody>
                  {[...f.columns, ...ALL.filter(c => !f.columns.includes(c))].map(c => {
                    const i = f.columns.indexOf(c);
                    const on = i >= 0;
                    return (
                      <tr key={c} style={{ opacity: on ? 1 : 0.55 }}>
                        <td><input type="checkbox" checked={on} onChange={() => toggle(c)} aria-label={`Inclure ${data.columns[c]}`} /></td>
                        <td>{data.columns[c]}</td>
                        <td style={{ textAlign: 'right' }}>{on ? i + 1 : '—'}</td>
                        {fixed && <td style={{ textAlign: 'right' }}>{on && (
                          <input className="odoo-input" inputMode="numeric" style={{ width: 70, textAlign: 'right' }} aria-label={`Largeur de ${data.columns[c]}`}
                            value={String(f.widths?.[c] ?? DEFAULT_WIDTH[c])}
                            onChange={e => set('widths', { ...(f.widths ?? {}), [c]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                        )}</td>}
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{on && (
                          <>
                            <button type="button" className="odoo-pager-btn" title="Monter" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
                            <button type="button" className="odoo-pager-btn" title="Descendre" disabled={i === f.columns.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
                          </>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Aperçu du format enregistré (deux bénéficiaires fictifs)</div>
              <pre style={{ margin: 0, padding: 10, fontSize: '0.75rem', background: 'var(--theme-bg-secondary)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre' }}>
                {data.preview.replace(/\t/g, '→')}
              </pre>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="odoo-btn-secondary" disabled={!data || data.isGeneric || save.isPending} onClick={() => save.mutate(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><RotateCcw size={13} /> Rétablir le format générique</button>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
            <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
            <button type="button" className="odoo-btn-primary" disabled={!f || save.isPending} onClick={() => save.mutate(payload())}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
            </button>
          </span>
        </div>
      </div>
    </ModalBackdrop>
  );
}
