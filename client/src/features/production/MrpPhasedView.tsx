import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, CalendarRange, Check, AlertTriangle } from 'lucide-react';
import { productionApi, type MrpPhasedProposal } from '../../api/production.api';
import { Alert, DataPanel, EmptyState, ErrorState, HeaderActions, LoadingState, SectionHeader, TableFooter } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useProdTerms } from '../../hooks/useProdTerms';

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
const ACTION = { avancer: 'Avancer', retarder: 'Retarder', annuler: 'Annuler' } as const;
const key = (p: MrpPhasedProposal) => `${p.key}|${p.needDate}`;

export default function MrpPhasedView({ from }: { from: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const T = useProdTerms();
  const KIND = { product: 'Produit', base: 'Base', ingredient: T.ingredient } as const;
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['mrp-phased', from], queryFn: () => productionApi.mrpPhased(from) });
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

  if (isLoading) return <LoadingState label="Calcul des besoins…" />;
  if (isError || !data) return <ErrorState error={error} title="Calcul impossible" text={apiErrorMessage(error)} onRetry={() => refetch()} />;
  const item = data.items.find(i => i.key === itemKey);
  const late = data.proposals.filter(p => p.late).length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {late > 0 && (
        <Alert tone="warning" icon={AlertTriangle}>
          {late} proposition(s) en retard : le besoin tombe dans le délai, il aurait fallu lancer avant aujourd'hui. Lancement proposé dès aujourd'hui.
        </Alert>
      )}
      <Alert tone="info" icon={CalendarRange}>
        Besoins phasés du {day(data.days[0])} au {day(data.days[data.days.length - 1])}. Délais : produit {data.params.product_lead_days} j, base {data.params.base_lead_days} j, achat selon le fournisseur (sinon {data.params.default_purchase_lead_days} j).
        Les bases sont fabriquées avec l'ordre de leur produit (dépendances créées à la confirmation) : elles s'affichent pour information.
      </Alert>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <SectionHeader title="Propositions" />
        <div className="prj-chips" role="group" aria-label="Type de proposition">
          {(['all', 'product', 'base', 'ingredient'] as const).map(k => (
            <button key={k} type="button" aria-pressed={kind === k} className={`prj-chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {k === 'all' ? 'Toutes' : KIND[k]}
            </button>
          ))}
        </div>
      </div>
      <HeaderActions>
        <button type="button" className="odoo-btn-primary" disabled={!picked.size || validate.isPending} aria-busy={validate.isPending || undefined}
          onClick={async () => { if (await confirm(`Créer les ordres de fabrication et demandes d'achat des ${picked.size} proposition(s) choisie(s) ?`, { confirmLabel: 'Créer' })) validate.mutate(); }}>
          {validate.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />} Valider ({picked.size})
        </button>
      </HeaderActions>
      {proposals.length === 0 ? <EmptyState icon={CalendarRange} title="Aucune proposition" text="La demande de l'horizon est couverte par le stock et les ordres en cours." /> : (
      <DataPanel label="Propositions" footer={<TableFooter note={`${proposals.length} proposition(s)${picked.size ? ` · ${picked.size} choisie(s)` : ''}`} />}>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th style={{ width: 28 }}><span className="sr-only">Choisir</span></th><th>Type</th><th>Article</th><th className="ds-num">Quantité</th><th>Lancer le</th><th>Pour le</th><th>Échéance</th></tr></thead>
          <tbody>{proposals.map(p => (
            <tr key={key(p)} className={picked.has(key(p)) ? 'ds-selected' : undefined}>
              <td>{selectable(p) && (
                <input type="checkbox" aria-label={`Choisir ${p.name} pour le ${p.needDate}`} checked={picked.has(key(p))}
                  onChange={e => setPicked(s => { const x = new Set(s); if (e.target.checked) x.add(key(p)); else x.delete(key(p)); return x; })} />
              )}</td>
              <td>{KIND[p.kind]}</td>
              <td><button type="button" className="ds-strong" onClick={() => setItemKey(p.key)} title="Voir la projection jour par jour" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline dotted' }}>{p.name}</button></td>
              <td className="ds-num">{nf(p.qty)} {p.unit}</td>
              <td>{day(p.releaseDate)}</td>
              <td>{day(p.needDate)}</td>
              <td>{p.late && <StatusTag tone="late" label="En retard" />}</td>
            </tr>
          ))}</tbody>
        </table>
        </div>
      </DataPanel>
      )}

      {data.messages.length > 0 && (
        <>
          <SectionHeader title="Messages d'action" />
          <DataPanel label="Messages d'action" footer={<TableFooter note={`${data.messages.length} message(s)`} />}>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>N° pièce</th><th>Article</th><th className="ds-num">Quantité</th><th>Prévu le</th><th>Action</th><th>Nouvelle date</th></tr></thead>
              <tbody>{data.messages.map((m, i) => (
                <tr key={`${m.ref}|${m.key}|${i}`}>
                  <td><span className="ds-ref">{m.ref}</span></td><td className="ds-strong">{m.name}</td><td className="ds-num">{nf(m.qty)}</td><td>{day(m.date)}</td>
                  <td><StatusTag tone={m.action === 'annuler' ? 'cancelled' : m.action === 'avancer' ? 'late' : 'progress'} label={ACTION[m.action]} /></td>
                  <td>{m.newDate ? day(m.newDate) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
            </div>
          </DataPanel>
        </>
      )}

      {item && (
        <>
          <SectionHeader title={`Projection de ${item.name}`} note={`Stock ${nf(item.onHand)} ${item.unit}, sécurité ${nf(item.safety)}, délai ${item.leadDays} j`}>
            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setItemKey('')}>Fermer</button>
          </SectionHeader>
          <DataPanel label={`Projection de ${item.name}`}>
            <table className="odoo-table">
              <thead><tr><th>Ligne</th>{item.days.map(d => <th key={d.date} className="ds-num">{day(d.date)}</th>)}</tr></thead>
              <tbody>
                {([['gross', 'Besoin brut'], ['receipts', 'Réceptions prévues'], ['planned', 'Ordres proposés'], ['projected', 'Disponible projeté']] as const).map(([f, l]) => (
                  <tr key={f}><td className="ds-strong">{l}</td>{item.days.map(d => (
                    <td key={d.date} className="ds-num" style={{ fontWeight: f === 'projected' ? 600 : undefined }}>{d[f] ? nf(d[f]) : '—'}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </>
      )}
    </div>
  );
}
