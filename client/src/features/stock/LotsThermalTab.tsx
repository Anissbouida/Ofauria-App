import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Snowflake, Sun, Package, AlertTriangle } from 'lucide-react';
import { lotThermalApi, type FreezableLot } from '../../api/lot-thermal.api';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';

const ETAT_BADGE: Record<string, { label: string; cls: string }> = {
  frais: { label: 'Frais', cls: 'odoo-tag' },
  surgele: { label: 'Surgelé', cls: 'odoo-tag-blue' },
  decongele: { label: 'Décongelé', cls: 'odoo-tag-amber' },
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
    const ok = await confirm(
      `Décongeler le lot « ${l.item_name} » ? Sa DLC sera fixée à ${DEFAULT_THAW_HOURS} h après décongélation, et il ne pourra plus être recongelé.`,
      { title: 'Décongeler', confirmLabel: 'Décongeler' },
    );
    if (ok) thawMut.mutate(l);
  };

  return (
    <div style={{ padding: '1rem' }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-gray-700">
          <Snowflake size={16} className="text-sky-600" />
          <span className="font-semibold">Lots surgelables</span>
          <span className="text-xs text-gray-400">{lots.length}</span>
        </div>
        <div className="odoo-view-switcher">
          {FILTERS.map(f => (
            <button key={f.label} onClick={() => setEtat(f.key)} className={etat === f.key ? 'active' : ''}>{f.label}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-gray-400">Chargement…</div>
      ) : lots.length === 0 ? (
        <div className="text-center py-10 text-gray-400">Aucun lot dans cet état.</div>
      ) : (
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Lot</th><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th>
              <th>État</th><th>DLC</th><th>Surgelé le</th><th>Décongelé le</th><th />
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => {
              const badge = ETAT_BADGE[l.etat_thermique] || ETAT_BADGE.frais;
              const expired = isExpired(l.dlc_affichee);
              return (
                <tr key={`${l.kind}-${l.id}`}>
                  <td className="font-mono">{l.lot_number}</td>
                  <td>
                    <span className="odoo-tag" style={{ marginRight: 6 }}>{l.item_kind}</span>
                    {l.item_name}
                  </td>
                  <td style={{ textAlign: 'right' }} className="tabular-nums">{Math.round(l.quantity)} {l.unit}</td>
                  <td>
                    <span className={badge.cls}>
                      {l.etat_thermique === 'surgele' && <Snowflake size={10} style={{ display: 'inline', marginRight: 2 }} />}
                      {badge.label}
                    </span>
                  </td>
                  <td className="tabular-nums" style={{ color: expired ? 'var(--theme-danger, #dc3545)' : undefined }}>
                    {fmtDate(l.dlc_affichee)}
                    {l.etat_thermique === 'decongele' && <span className="text-[10px] text-gray-400 ml-1">(décong.)</span>}
                  </td>
                  <td className="tabular-nums text-gray-500">{fmtDate(l.surgele_a)}</td>
                  <td className="tabular-nums text-gray-500">{fmtDate(l.decongele_a)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {l.etat_thermique === 'frais' && (
                      <button className="odoo-btn-secondary" disabled={freezeMut.isPending}
                        onClick={() => freezeMut.mutate(l)}>
                        <Snowflake size={12} /> Geler
                      </button>
                    )}
                    {l.etat_thermique === 'surgele' && (
                      <button className="odoo-btn-secondary" disabled={thawMut.isPending}
                        onClick={() => askThaw(l)}>
                        <Sun size={12} /> Décongeler
                      </button>
                    )}
                    {l.etat_thermique === 'decongele' && (
                      <span className="text-[11px] text-gray-400 inline-flex items-center gap-1" title="Recongélation interdite">
                        <AlertTriangle size={11} /> non recongelable
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1">
        <Package size={11} /> La DLC d'un lot décongelé est recalculée ({DEFAULT_THAW_HOURS} h) et prime au FEFO. La recongélation est interdite.
      </p>
    </div>
  );
}
