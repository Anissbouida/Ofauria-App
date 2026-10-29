import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Lock, Loader2, X, Eye, Trash2, Archive } from 'lucide-react';
import { inventoryApi, type StockClosing, type StockClosingDetail } from '../../api/inventory.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/**
 * Clôture de stock par période (mig 381) : fige la valorisation du stock matière
 * (quantités restantes × coût) à une date de fin de période. Instantané immuable
 * servant de valeur de stock pour le bilan et de référence historique.
 */

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });
const qty = (n: number, unit: string | null) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${unit ? ' ' + unit : ''}`;

export default function StockClosingTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: closings = [], isLoading } = useQuery({ queryKey: ['stock-closings'], queryFn: inventoryApi.closingList });
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => inventoryApi.closingDelete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-closings'] }); notify.success('Clôture supprimée'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const onDelete = async (c: StockClosing) => {
    if (await confirm(`Supprimer la clôture « ${c.period_label} » ? L'instantané sera perdu.`, { title: 'Rouvrir la période', danger: true, confirmLabel: 'Supprimer' })) {
      del.mutate(c.id);
    }
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={Lock} title="Clôture de stock par période">
        Fige la valeur du stock matière (quantités restantes × coût) à une date de fin de période. Sert de valeur de stock pour le bilan et de référence historique. L'instantané photographie l'état courant au moment de la clôture.
      </StatusBanner>

      <div>
        <button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}>
          <Lock size={14} /> Clôturer une période
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Période</th><th>Date de clôture</th>
              <th style={{ textAlign: 'right' }}>Valeur du stock</th>
              <th style={{ textAlign: 'right' }}>Articles</th>
              <th>Clôturé par</th><th />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && closings.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune clôture enregistrée.</td></tr>
            )}
            {closings.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500 }}>{c.period_label}</td>
                <td style={{ fontSize: '0.85rem' }}>{day(c.closing_date)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(Number(c.total_value))}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.lines_count}</td>
                <td style={{ fontSize: '0.85rem', color: 'var(--theme-text-muted)' }}>{c.closed_by_name || '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: 6 }} onClick={() => setDetailId(c.id)}>
                    <Eye size={12} /> Détail
                  </button>
                  <button type="button" className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => onDelete(c)} title="Rouvrir / supprimer">
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && <ClosingForm onClose={() => setShowForm(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['stock-closings'] }); setShowForm(false); }} />}
      {detailId && <ClosingDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function ClosingForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const now = new Date();
  const [periodLabel, setPeriodLabel] = useState(format(now, 'MMMM yyyy', { locale: fr }).replace(/^./, s => s.toUpperCase()));
  const [closingDate, setClosingDate] = useState(format(now, 'yyyy-MM-dd'));

  const { data: preview, isLoading } = useQuery({ queryKey: ['stock-closing-preview'], queryFn: inventoryApi.closingPreview });
  const save = useMutation({
    mutationFn: () => inventoryApi.closingCreate({ periodLabel: periodLabel.trim(), closingDate }),
    onSuccess: () => { notify.success('Période clôturée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(460px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Lock size={16} /> Clôturer une période</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--theme-bg-secondary)', borderRadius: 6, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>Valeur du stock à figer</div>
            {isLoading ? <Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginTop: 4 }} /> : (
              <>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(preview?.total ?? 0)}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>{preview?.count ?? 0} article(s)</div>
              </>
            )}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--theme-text-muted)' }}>Libellé de la période</span>
            <input type="text" value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--theme-text-muted)' }}>Date de clôture</span>
            <input type="date" value={closingDate} onChange={e => setClosingDate(e.target.value)} style={inp} />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!periodLabel.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />} Clôturer
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function ClosingDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<StockClosingDetail>({ queryKey: ['stock-closing', id], queryFn: () => inventoryApi.closingGet(id) });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(680px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Archive size={16} /> Clôture — {data?.period_label ?? ''}
          </span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 16px 16px' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /></div>
          ) : (
            <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--theme-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: 4 }}>Article</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Quantité</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Coût unitaire</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Valeur</th>
                </tr>
              </thead>
              <tbody>
                {data?.lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--odoo-border)' }}>
                    <td style={{ padding: 4 }}>{l.ingredient_name}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{qty(l.quantity, l.unit)}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{money(l.unit_cost)}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{money(l.value)}</td>
                  </tr>
                ))}
              </tbody>
              {data && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--odoo-border)', fontWeight: 700 }}>
                    <td style={{ padding: 4 }} colSpan={3}>Valeur totale du stock</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(Number(data.total_value))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}

const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', width: '100%', font: 'inherit' };
