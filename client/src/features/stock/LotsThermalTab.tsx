import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Snowflake, Sun, Package, AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { lotThermalApi, type FreezableLot } from '../../api/lot-thermal.api';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';
import { FilterChips } from '../sales/ListTemplate';
import { ChipsRow } from './StockUi';
import { DataPanel, EmptyState, LoadingState, NoResultState, TableFooter } from '../../components/ds';

/** État thermique en étiquette commune (StatusTag) : décongelé = à consommer, action attendue. */
const ETAT_BADGE: Record<string, { label: string; tone: StatusTone; icon?: LucideIcon }> = {
  frais: { label: 'Frais', tone: 'done', icon: Sun },
  surgele: { label: 'Surgelé', tone: 'progress', icon: Snowflake },
  decongele: { label: 'Décongelé', tone: 'todo' },
};
const FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: 'Tous' },
  { key: 'frais', label: 'Frais' },
  { key: 'surgele', label: 'Surgelés' },
  { key: 'decongele', label: 'Décongelés' },
];
const DEFAULT_THAW_HOURS = 48;

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const isExpired = (s: string | null) => (s ? new Date(s).getTime() < Date.now() : false);

export default function LotsThermalTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [etat, setEtat] = useState<string | null>(null);

  const { data: lots = [], isLoading } = useQuery<FreezableLot[]>({
    queryKey: ['lots-thermal', etat],
    queryFn: () => lotThermalApi.listFreezable(undefined, etat || undefined),
  });

  const freezeMut = useMutation({
    mutationFn: (l: FreezableLot) => lotThermalApi.freeze(l.kind, l.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lots-thermal'] }); notify.success('Lot surgelé.'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Échec de la surgélation.')),
  });
  const thawMut = useMutation({
    mutationFn: (l: FreezableLot) => lotThermalApi.thaw(l.kind, l.id, DEFAULT_THAW_HOURS),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lots-thermal'] }); notify.success('Lot décongelé, DLC recalculée.'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Échec de la décongélation.')),
  });

  const askThaw = async (l: FreezableLot) => {
    const ok = await confirm(`Décongeler le lot « ${l.item_name} » ? Sa DLC sera fixée à ${DEFAULT_THAW_HOURS} h après décongélation, et il ne pourra plus être recongelé.`,
      { title: 'Décongeler', confirmLabel: 'Décongeler' },
    );
    if (ok) thawMut.mutate(l);
  };

  return (
    <div className="stk-stack">
      <ChipsRow summary={`${lots.length} lot${lots.length > 1 ? 's' : ''}`}>
        <FilterChips label="État thermique" value={etat ?? ''} onChange={k => setEtat(k || null)}
          chips={FILTERS.map(f => ({ key: f.key ?? '', label: f.label }))} />
      </ChipsRow>

      {isLoading ? (
        <LoadingState label="Chargement des lots…" />
      ) : lots.length === 0 ? (
        etat
          ? <NoResultState text="Aucun lot dans cet état." onReset={() => setEtat(null)} />
          : <EmptyState icon={Snowflake} title="Aucun lot surgelable" text="Les lots d'articles surgelables apparaîtront ici dès leur entrée en stock." />
      ) : (
        <DataPanel label="Lots surgelables" footer={<TableFooter note={`${lots.length} lot${lots.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Lot</th><th>Article</th><th className="ds-num">Quantité</th>
              <th>État</th><th>DLC</th><th>Surgelé le</th><th>Décongelé le</th><th className="ds-actions">Action</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => {
              const badge = ETAT_BADGE[l.etat_thermique] || ETAT_BADGE.frais;
              const expired = isExpired(l.dlc_affichee);
              return (
                <tr key={`${l.kind}-${l.id}`}>
                  <td><span className="ds-ref">{l.lot_number}</span></td>
                  <td>
                    <span className="odoo-tag" style={{ marginRight: 6 }}>{l.item_kind}</span>
                    <span className="ds-strong">{l.item_name}</span>
                  </td>
                  <td className="tabular-nums ds-num">{Math.round(l.quantity)} {l.unit}</td>
                  <td>
                    <StatusTag tone={badge.tone} icon={badge.icon} label={badge.label} />
                  </td>
                  <td style={{ color: expired ? 'var(--ds-danger)' : undefined, fontWeight: expired ? 600 : undefined }}>
                    {fmtDate(l.dlc_affichee)}
                    {l.etat_thermique === 'decongele' && <span style={{ fontSize: 12, color: 'var(--ds-muted)', marginLeft: 4 }}>(décongelé)</span>}
                  </td>
                  <td className="tabular-nums text-gray-500">{fmtDate(l.surgele_a)}</td>
                  <td className="tabular-nums text-gray-500">{fmtDate(l.decongele_a)}</td>
                  <td className="ds-actions">
                    {l.etat_thermique === 'frais' && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={freezeMut.isPending}
                        onClick={() => freezeMut.mutate(l)}>
                        <Snowflake size={12} /> Geler
                      </button>
                    )}
                    {l.etat_thermique === 'surgele' && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={thawMut.isPending}
                        onClick={() => askThaw(l)}>
                        <Sun size={12} /> Décongeler
                      </button>
                    )}
                    {l.etat_thermique === 'decongele' && (
                      <span style={{ fontSize: 12, color: 'var(--ds-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Recongélation interdite">
                        <AlertTriangle size={11} /> non recongelable
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </DataPanel>
      )}
      <p className="prj-note" style={{ display: 'flex', alignItems: 'center', gap: 4, margin: 0, color: 'var(--ds-muted)' }}>
        <Package size={11} /> La DLC d'un lot décongelé est recalculée ({DEFAULT_THAW_HOURS} h) et prime au FEFO. La recongélation est interdite.
      </p>
    </div>
  );
}
