import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flame, Undo2 } from 'lucide-react';
import api from '../../api/client';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useProdTerms } from '../../hooks/useProdTerms';
import './production.css';

/**
 * Audit production pâtissière 2026-11 — lot 7.
 *  - EquipmentLoadPanel (C-19) : charge des équipements de la journée de l'ordre, la part de
 *    cet ordre, et les équipements saturés.
 *  - MaterialReturnPanel (C-28) : rendre au magasin de la matière déjà prélevée (article
 *    annulé, fournée réduite, reste), lot par lot, avec un motif.
 */
const UNIT: Record<string, string> = { plaque: 'plaque(s)', contenant: 'contenant(s)', kg: 'kg', piece: 'pièce(s)' };
const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

type Load = {
  equipementId: string; name: string; unit: string | null; capacity: number | null; load: number; planLoad: number; overloaded: boolean;
  lines: { planId: string; itemId: string; label: string; batches: number; load: number }[];
};

export function EquipmentLoadPanel({ planId }: { planId: string }) {
  const PT = useProdTerms();
  const { data = [] } = useQuery({
    queryKey: ['plan-capacity', planId],
    queryFn: () => api.get('/production/capacity', { params: { plan: planId } }).then(r => r.data.data as Load[]),
  });
  const mine = data.filter(e => e.planLoad > 0);
  if (mine.length === 0) return null;
  const saturated = mine.filter(e => e.overloaded);
  return (
    <div className="ds-panel pd-section" style={{ marginTop: 12 }}>
      <div className="pd-section-head"><Flame size={13} aria-hidden="true" /> Charge des équipements du jour</div>
      <div style={{ padding: '0.5rem 1rem', display: 'grid', gap: 8 }}>
        {saturated.length > 0 && (
          <StatusBanner tone="warning" icon={Flame} title={`${saturated.length} équipement(s) saturé(s) ce jour-là`}>
            Le nombre de {PT.batchesLc} planifié dépasse la capacité : réduisez des quantités ou déplacez un ordre sur une autre journée.
          </StatusBanner>
        )}
        <table className="odoo-table ds-dense">
          <thead><tr><th>Équipement</th><th className="ds-num">Cet ordre</th><th className="ds-num">Toute la journée</th><th className="ds-num">Capacité</th><th className="ds-num">Occupation</th></tr></thead>
          <tbody>{mine.map(e => {
            const u = UNIT[e.unit ?? ''] ?? '';
            const pct = e.capacity ? Math.round((e.load / e.capacity) * 100) : null;
            return (
              <tr key={e.equipementId}>
                <td className="ds-strong">{e.name}</td>
                <td className="ds-num">{fr(e.planLoad)} {u}</td>
                <td className="ds-num" title={e.lines.map(l => `${l.label} : ${fr(l.batches)} ${PT.batchLc}(s), ${fr(l.load)} ${u}`).join('\n')}>{fr(e.load)} {u}</td>
                <td className="ds-num">{e.capacity === null ? <span className="ds-muted">non renseignée</span> : `${fr(e.capacity)} ${u}`}</td>
                <td className="ds-num" style={{ color: e.overloaded ? 'var(--ds-danger, #b91c1c)' : undefined, fontWeight: e.overloaded ? 600 : undefined }}>
                  {pct === null ? '—' : `${pct} %`}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

type Returnable = {
  lines: { ligne_id: string; ingredient_name: string; unit: string | null; ingredient_lot_id: string; lot_number: string; returnable: number; returned: number }[];
  history: { id: string; quantity: number; unit: string | null; reason: string; returned_at: string; ingredient_name: string; lot_number: string; item_label: string | null; returned_by_name: string | null }[];
};

export function MaterialReturnPanel({ bonId, planId, closed }: { bonId: string; planId: string; closed: boolean }) {
  const PT = useProdTerms();
  const qc = useQueryClient();
  const key = ['bon-returns', bonId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get(`/bons-sortie/${bonId}/returns`).then(r => r.data.data as Returnable) });
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const n = (v: string | undefined) => Number((v ?? '').replace(',', '.'));
  const lineKey = (l: Returnable['lines'][number]) => `${l.ligne_id}|${l.ingredient_lot_id}`;
  const chosen = (data?.lines ?? []).filter(l => n(qty[lineKey(l)]) > 0);
  const tooMuch = chosen.some(l => n(qty[lineKey(l)]) > l.returnable + 1e-6);
  const save = useMutation({
    mutationFn: () => api.post(`/bons-sortie/${bonId}/returns`, {
      reason: reason.trim(),
      lines: chosen.map(l => ({ ligneId: l.ligne_id, lotId: l.ingredient_lot_id, quantity: n(qty[lineKey(l)]) })),
    }),
    onSuccess: () => {
      notify.success('Matière rendue au magasin');
      setOpen(false); setQty({}); setReason('');
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['production', planId] });
      qc.invalidateQueries({ queryKey: ['production-lots', planId] });
      qc.invalidateQueries({ queryKey: ['production-cout', planId] });
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  if (!data || (data.lines.length === 0 && data.history.length === 0)) return null;

  return (
    <div className="ds-panel pd-section" style={{ marginTop: 12 }}>
      <div className="pd-section-head"><Undo2 size={13} aria-hidden="true" /> Retour de matière au magasin
        {!closed && data.lines.length > 0 && (
          <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setOpen(o => !o)}>
            {open ? 'Fermer' : 'Rendre de la matière'}
          </button>
        )}
      </div>
      <div style={{ padding: '0.5rem 1rem', display: 'grid', gap: 10 }}>
        {closed && <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Ordre clôturé : son coût est arrêté, plus de retour possible.</span>}
        {open && (
          <>
            <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>
              Saisissez la quantité rendue par lot. Elle revient dans le lot (en-cours ouvert) et sort du coût de l'ordre ; la part d'un article annulé est rendue en premier.
            </span>
            <table className="odoo-table ds-dense">
              <thead><tr><th>Matière</th><th>Lot</th><th className="ds-num">Encore sorti</th><th className="ds-num">À rendre</th></tr></thead>
              <tbody>{data.lines.map(l => {
                const k = lineKey(l);
                const over = n(qty[k]) > l.returnable + 1e-6;
                return (
                  <tr key={k}>
                    <td className="ds-strong">{l.ingredient_name}</td>
                    <td>{l.lot_number}</td>
                    <td className="ds-num">{fr(l.returnable)} {l.unit ?? ''}</td>
                    <td className="ds-num">
                      <input className="ds-input sm" style={{ width: 80, textAlign: 'right', borderColor: over ? 'var(--ds-danger, #b91c1c)' : undefined }}
                        inputMode="decimal" value={qty[k] ?? ''} aria-label={`Quantité rendue de ${l.ingredient_name}, lot ${l.lot_number}`}
                        aria-invalid={over} onChange={e => setQty(q => ({ ...q, [k]: e.target.value }))} />
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Motif
              <input className="ds-input" value={reason} maxLength={500} placeholder={`Article annulé, réduction de ${PT.batchLc}, reste de sac…`}
                onChange={e => setReason(e.target.value)} />
            </label>
            {tooMuch && <span style={{ fontSize: 13, color: 'var(--ds-danger, #b91c1c)' }}>On ne peut pas rendre plus que ce qui est encore sorti.</span>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="odoo-btn-primary" disabled={chosen.length === 0 || tooMuch || reason.trim().length < 3 || save.isPending}
                onClick={() => save.mutate()}>Rendre au magasin</button>
            </div>
          </>
        )}
        {data.history.length > 0 && (
          <table className="odoo-table ds-dense">
            <thead><tr><th>Rendu le</th><th>Matière</th><th>Lot</th><th>Article</th><th className="ds-num">Quantité</th><th>Motif</th><th>Par</th></tr></thead>
            <tbody>{data.history.map(h => (
              <tr key={h.id}>
                <td>{new Date(h.returned_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{h.ingredient_name}</td><td>{h.lot_number}</td><td>{h.item_label ?? '—'}</td>
                <td className="ds-num">{fr(h.quantity)} {h.unit ?? ''}</td>
                <td>{h.reason}</td><td>{h.returned_by_name ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
