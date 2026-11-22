import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Lock, Loader2, X, Eye, Trash2, Archive, Download, CalendarClock, AlertTriangle } from 'lucide-react';
import { inventoryApi, type StockClosing, type StockClosingDetail } from '../../api/inventory.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { money } from '../../utils/money';
import '../sales/ListTemplate';
import { RowMenu } from '../../components/ui/RowMenu';
import { HeaderActions } from './StockUi';
import { DataPanel, EmptyState, FormField, FormFooter, LoadingState, Modal, SectionHeader, TableFooter } from '../../components/ds';
import './stock.css';

/**
 * Clôture de stock par période (mig 381) : fige la valorisation du stock matière
 * (quantités restantes × coût) à une date de fin de période. Instantané immuable
 * servant de valeur de stock pour le bilan et de référence historique.
 */

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
    <div className="stk-stack">
      <StatusBanner tone="info" icon={Lock} title="Clôture de stock par période">
        Fige la valeur du stock matière (quantités restantes × coût) à une date de fin de période. Sert de valeur de stock pour le bilan et de référence historique. L'instantané photographie l'état courant au moment de la clôture.
      </StatusBanner>

      <HeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => setShowForm(true)}>
          <Lock size={14} aria-hidden="true" /> Clôturer une période
        </button>
      </HeaderActions>

      <StockAtDatePanel />

      <SectionHeader title="Clôtures enregistrées" />
      {isLoading ? (
        <LoadingState label="Chargement des clôtures…" />
      ) : closings.length === 0 ? (
        <EmptyState icon={Archive} title="Aucune clôture enregistrée" text="Clôturez une période pour figer la valeur du stock à sa date de fin." />
      ) : (
      <DataPanel label="Clôtures enregistrées" footer={<TableFooter note={`${closings.length} clôture${closings.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Période</th><th>Date de clôture</th>
              <th className="ds-num">Valeur du stock</th>
              <th className="ds-num">Articles</th>
              <th>Clôturé par</th><th className="ds-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {closings.map(c => (
              <tr key={c.id}>
                <td className="ds-strong">{c.period_label}</td>
                <td style={{ fontSize: '0.85rem' }}>{day(c.closing_date)}</td>
                <td className="ds-num" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(Number(c.total_value))}</td>
                <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.lines_count}</td>
                <td style={{ fontSize: '0.85rem', color: 'var(--ds-muted)' }}>{c.closed_by_name || '—'}</td>
                <td className="ds-actions">
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setDetailId(c.id)}>
                    <Eye size={12} aria-hidden="true" /> Détail
                  </button>
                  <RowMenu items={[{ label: 'Supprimer la clôture', icon: Trash2, danger: true, onSelect: () => onDelete(c) }]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}

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
    <Modal title="Clôturer une période" onClose={onClose} locked={save.isPending} width={460}
      footer={<FormFooter onCancel={onClose} submitLabel="Clôturer" busy={save.isPending} disabled={!periodLabel.trim()} onSubmit={() => save.mutate()} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--ds-hair)', borderRadius: 6, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--ds-muted)' }}>Valeur du stock à figer</div>
            {isLoading ? <Loader2 size={16} className="animate-spin" style={{ display: 'inline', marginTop: 4 }} /> : (
              <>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(preview?.total ?? 0)}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--ds-muted)' }}>{preview?.count ?? 0} article(s)</div>
              </>
            )}
          </div>
          <FormField label="Libellé de la période" htmlFor="closing-label" required
            error={!periodLabel.trim() ? 'Saisissez le libellé de la période.' : undefined}>
            <input id="closing-label" type="text" className="ds-input" value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} />
          </FormField>
          <FormField label="Date de clôture" htmlFor="closing-date" required>
            <input id="closing-date" type="date" className="ds-input" value={closingDate} onChange={e => setClosingDate(e.target.value)} />
          </FormField>
        </div>
    </Modal>
  );
}

function ClosingDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<StockClosingDetail>({ queryKey: ['stock-closing', id], queryFn: () => inventoryApi.closingGet(id) });
  return (
    <Modal title={<>Clôture — {data?.period_label ?? ''}</>} onClose={onClose} width={680}>
          {isLoading ? (
            <LoadingState bare label="Chargement de la clôture…" />
          ) : (
            <DataPanel label="Articles de la clôture">
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th>Article</th>
                  <th className="ds-num">Quantité</th>
                  <th className="ds-num">Coût unitaire</th>
                  <th className="ds-num">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {data?.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="ds-strong">{l.ingredient_name}</td>
                    <td className="ds-num">{qty(l.quantity, l.unit)}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{money(l.unit_cost)}</td>
                    <td className="ds-num">{money(l.value)}</td>
                  </tr>
                ))}
              </tbody>
              {data && (
                <tfoot>
                  <tr>
                    <td colSpan={3}>Valeur totale du stock</td>
                    <td className="ds-num">{money(Number(data.total_value))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            </DataPanel>
          )}
    </Modal>
  );
}

/**
 * Stock valorisé au… (G5-01) : quantité, coût en vigueur et valeur de chaque article à
 * la fin d'une date, reconstitués depuis le journal des mouvements. Un avertissement
 * signale les articles dont le journal n'explique pas le stock courant.
 */
function StockAtDatePanel() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(today);
  const [showGaps, setShowGaps] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['stock-at', date], queryFn: () => inventoryApi.stockAt(date), enabled: !!date });
  const { data: gaps = [] } = useQuery({ queryKey: ['stock-journal-gaps'], queryFn: inventoryApi.journalGaps, enabled: showGaps });
  const download = async () => {
    try {
      const blob = await inventoryApi.stockAtCsv(date);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `stock-valorise-${date}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { notify.error(apiErrorMessage(e)); }
  };
  return (
    <section className="prj-panel" style={{ padding: '14px 18px 16px', display: 'grid', gap: 12 }} aria-label="Stock valorisé à une date">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <CalendarClock size={16} aria-hidden style={{ color: 'var(--ds-accent)' }} />
        <h2 className="ds-subhead" style={{ fontSize: 'var(--ds-t-section)', fontWeight: 700 }}>Stock valorisé au</h2>
        <input type="date" className="ds-input" value={date} max={today} onChange={e => setDate(e.target.value)} aria-label="Date du stock" style={{ width: 'auto' }} />
        {data && <span>{data.lines.length} article(s) · <strong>{money(data.total)}</strong></span>}
        <div style={{ flex: 1 }} />
        <button type="button" className="odoo-btn-secondary" onClick={download} disabled={!data}><Download size={14} aria-hidden="true" /> Exporter</button>
      </div>
      {data && data.gaps > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle} title={`${data.gaps} article(s) au journal incomplet`}
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => setShowGaps(v => !v)}>{showGaps ? 'Masquer' : 'Voir'}</button>}>
          Pour ces articles, la somme des mouvements ne donne pas le stock actuel (mouvements non journalisés ou reprise de données) :
          leur stock aux dates passées est approximatif. Le stock d'aujourd'hui reste exact.
        </StatusBanner>
      )}
      {showGaps && gaps.length > 0 && (
        <DataPanel label="Articles au journal incomplet" style={{ maxHeight: 220, overflow: 'auto' }}>
          <table className="odoo-table ds-dense">
            <thead><tr><th>Article</th><th className="ds-num">Stock actuel</th><th className="ds-num">Somme du journal</th><th className="ds-num">Écart</th></tr></thead>
            <tbody>{gaps.map(g => (
              <tr key={`${g.ingredient_id}`}><td className="ds-strong">{g.ingredient_name}</td><td className="ds-num">{qty(g.current_quantity, g.unit)}</td>
                <td className="ds-num">{qty(g.journal_quantity, g.unit)}</td><td className="ds-num">{qty(g.gap, g.unit)}</td></tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
      {isLoading ? <LoadingState bare label="Calcul du stock à cette date…" /> : data && (
        <DataPanel label="Stock valorisé à la date" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Article</th><th className="ds-num">Quantité</th><th className="ds-num">Coût unitaire</th><th className="ds-num">Valeur</th></tr></thead>
            <tbody>{data.lines.map(l => (
              <tr key={l.ingredient_id}>
                <td className="ds-strong">{l.ingredient_name}</td>
                <td className="ds-num" style={{ color: l.quantity < 0 ? 'var(--ds-danger)' : undefined }}>{qty(l.quantity, l.unit)}</td>
                <td className="ds-num">{l.unit_cost.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</td>
                <td className="ds-num">{money(l.value)}</td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
    </section>
  );
}
