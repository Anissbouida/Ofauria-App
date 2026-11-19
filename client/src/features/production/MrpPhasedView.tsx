import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, CalendarRange, Check, AlertTriangle } from 'lucide-react';
import { productionApi, type MrpPhasedProposal } from '../../api/production.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Production › Plan directeur › Besoins phasés (G5-04).
 *
 * Calcul jour par jour sur l'horizon : demande (prévision + commandes), stock, ordres et
 * bons de commande en cours, explosion de la nomenclature décalée par les délais de
 * fabrication et d'achat, règles de lot. Sorties : ordres de fabrication et demandes
 * d'achat proposés (à valider), messages d'action sur ce qui est déjà lancé.
 */
const nf = (v: number) => (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const day = (d: string) => format(new Date(`${d}T00:00:00`), 'EEE dd/MM', { locale: fr });
const KIND = { product: 'Produit', base: 'Base', ingredient: 'Ingrédient' } as const;
const ACTION = { avancer: 'Avancer', retarder: 'Retarder', annuler: 'Annuler' } as const;
const key = (p: MrpPhasedProposal) => `${p.key}|${p.needDate}`;

export default function MrpPhasedView({ from }: { from: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['mrp-phased', from], queryFn: () => productionApi.mrpPhased(from) });
  const [kind, setKind] = useState<'all' | 'product' | 'base' | 'ingredient'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [itemKey, setItemKey] = useState<string>('');

  const proposals = useMemo(() => (data?.proposals ?? []).filter(p => kind === 'all' || p.kind === kind)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name)), [data, kind]);
  const selectable = (p: MrpPhasedProposal) => p.kind !== 'base';
  const validate = useMutation({
    mutationFn: () => productionApi.mrpPhasedValidate((data?.proposals ?? []).filter(p => picked.has(key(p)) && selectable(p))
      .map(p => ({ kind: p.kind as 'product' | 'ingredient', id: p.id, qty: p.qty, unit: p.unit, releaseDate: p.releaseDate, needDate: p.needDate }))),
    onSuccess: (r) => {
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ['mrp-phased'] });
      notify.success(`${r.plans.length} ordre(s) de fabrication et ${r.requests} demande(s) d'achat créés`);
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  if (isError || !data) return <StatusBanner tone="danger" icon={AlertTriangle} title="Calcul impossible">{apiErrorMessage(error)}</StatusBanner>;
  const item = data.items.find(i => i.key === itemKey);
  const late = data.proposals.filter(p => p.late).length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="info" icon={CalendarRange} title={`Besoins phasés du ${day(data.days[0])} au ${day(data.days[data.days.length - 1])}`}>
        Délais : produit {data.params.product_lead_days} j, base {data.params.base_lead_days} j, achat selon le fournisseur (sinon {data.params.default_purchase_lead_days} j).
        Les bases sont fabriquées avec l'ordre de leur produit (dépendances créées à la confirmation) : elles s'affichent pour information.
      </StatusBanner>
      {late > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle} title={`${late} proposition(s) en retard`}>
          Le besoin tombe dans le délai : il aurait fallu lancer avant aujourd'hui. Lancement proposé dès aujourd'hui.
        </StatusBanner>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="kl-sec" style={{ margin: 0 }}><h2>Propositions</h2><small>{data.proposals.length}</small></div>
        <div className="prj-chips" role="group" aria-label="Type de proposition">
          {(['all', 'product', 'base', 'ingredient'] as const).map(k => (
            <button key={k} type="button" aria-pressed={kind === k} className={`prj-chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {k === 'all' ? 'Toutes' : KIND[k]}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="odoo-btn-primary" disabled={!picked.size || validate.isPending}
          onClick={async () => { if (await confirm(`Créer les ordres de fabrication et demandes d'achat des ${picked.size} proposition(s) choisie(s) ?`, { confirmLabel: 'Créer' })) validate.mutate(); }}>
          {validate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Valider ({picked.size})
        </button>
      </div>
      <section className="prj-panel sal-panel"><div className="prj-scroll" style={{ maxHeight: 360 }}>
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr><th style={{ width: 28 }} /><th>Type</th><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th>Lancer le</th><th>Pour le</th><th /></tr></thead>
          <tbody>{proposals.map(p => (
            <tr key={key(p)}>
              <td>{selectable(p) && (
                <input type="checkbox" aria-label={`Choisir ${p.name} pour le ${p.needDate}`} checked={picked.has(key(p))}
                  onChange={e => setPicked(s => { const x = new Set(s); if (e.target.checked) x.add(key(p)); else x.delete(key(p)); return x; })} />
              )}</td>
              <td>{KIND[p.kind]}</td>
              <td><button type="button" className="odoo-link" onClick={() => setItemKey(p.key)} style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted' }}>{p.name}</button></td>
              <td style={{ textAlign: 'right' }}>{nf(p.qty)} {p.unit}</td>
              <td>{day(p.releaseDate)}</td>
              <td>{day(p.needDate)}</td>
              <td>{p.late && <StatusTag tone="late" label="En retard" />}</td>
            </tr>
          ))}</tbody>
        </table>
      </div></section>

      {data.messages.length > 0 && (
        <>
          <div className="kl-sec" style={{ margin: '6px 4px 0' }}><h2>Messages d'action</h2><small>{data.messages.length}</small></div>
          <section className="prj-panel sal-panel"><div className="prj-scroll" style={{ maxHeight: 260 }}>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead><tr><th>Pièce</th><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th>Prévu le</th><th>Action</th><th>Nouvelle date</th></tr></thead>
              <tbody>{data.messages.map((m, i) => (
                <tr key={`${m.ref}|${m.key}|${i}`}>
                  <td>{m.ref}</td><td>{m.name}</td><td style={{ textAlign: 'right' }}>{nf(m.qty)}</td><td>{day(m.date)}</td>
                  <td><StatusTag tone={m.action === 'annuler' ? 'cancelled' : m.action === 'avancer' ? 'late' : 'progress'} label={ACTION[m.action]} /></td>
                  <td>{m.newDate ? day(m.newDate) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div></section>
        </>
      )}

      {item && (
        <section className="prj-panel" aria-label={`Projection de ${item.name}`}>
          <div className="prj-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span>{item.name} <small style={{ fontWeight: 500, color: 'var(--theme-text-muted)' }}>— stock {nf(item.onHand)} {item.unit}, sécurité {nf(item.safety)}, délai {item.leadDays} j</small></span>
            <button type="button" className="odoo-btn-secondary" onClick={() => setItemKey('')}>Fermer</button>
          </div>
          <div className="prj-scroll">
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead><tr><th /> {item.days.map(d => <th key={d.date} style={{ textAlign: 'right' }}>{day(d.date)}</th>)}</tr></thead>
              <tbody>
                {([['gross', 'Besoin brut'], ['receipts', 'Réceptions prévues'], ['planned', 'Ordres proposés'], ['projected', 'Disponible projeté']] as const).map(([f, l]) => (
                  <tr key={f}><td>{l}</td>{item.days.map(d => (
                    <td key={d.date} style={{ textAlign: 'right', fontWeight: f === 'projected' ? 600 : undefined }}>{d[f] ? nf(d[f]) : '—'}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
