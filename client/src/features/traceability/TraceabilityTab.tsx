import { useState } from 'react';
import QualityPanel from '../controle/QualityPanel';
import CustomFieldsCard from '../../components/custom-fields/CustomFieldsCard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ArrowLeft, Siren, Printer, Info, AlertTriangle, CheckCircle2, ShieldAlert, Lock, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import {
  traceabilityApi, DISPOSITION_LABELS, RECALL_STATUS_LABELS,
  type Certainty, type Disposition, type ProductLotTrace, type RecallStatus, type SearchHit,
} from '../../api/traceability.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { ListKpi } from '../sales/ListTemplate';
import { Panel, SectionTitle, PageLoading } from '../controle/KlUi';
import { Breadcrumb, DataPanel, EmptyState, NoResultState } from '../../components/ds';
import { useConfirm, usePrompt } from '../../components/ui/ConfirmDialog';

/**
 * Contrôle & Qualité › Traçabilité & rappels (mig 316).
 *   - Rechercher un lot (ingrédient ou produit fini) ;
 *   - aval d'un lot ingrédient : productions, lots produits, magasins, ventes ;
 *   - amont d'un lot produit : lots fournisseurs utilisés ;
 *   - rappel : périmètre figé → blocage → destination de chaque lot → clôture,
 *     avec un rapport imprimable (ONSSA).
 */

type Screen =
  | { kind: 'home' }
  | { kind: 'forward'; id: string }
  | { kind: 'backward'; id: string }
  | { kind: 'recall'; id: string };

const d = (s: string | null) => (s ? format(new Date(s.length === 10 ? `${s}T00:00:00` : s), 'dd/MM/yyyy') : '—');
const dt = (s: string | null) => (s ? format(new Date(s), 'dd/MM/yyyy HH:mm') : '—');
const q = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }));
/** Statut du rappel en étiquette commune : ouvert = lots à bloquer, action attendue. */
const RECALL_TONE: Record<RecallStatus, { tone: StatusTone; icon?: LucideIcon }> = {
  open: { tone: 'todo', icon: Siren }, blocked: { tone: 'blocked', icon: Lock }, closed: { tone: 'done' },
};
const RecallStatusTag = ({ status }: { status: RecallStatus }) => (
  <StatusTag tone={RECALL_TONE[status]?.tone ?? 'draft'} icon={RECALL_TONE[status]?.icon} label={RECALL_STATUS_LABELS[status]} />
);

function CertaintyTag({ c }: { c?: Certainty }) {
  return c === 'certain'
    ? <StatusTag tone="blocked" label="certain" title="La recette contient l'ingrédient" />
    : <StatusTag tone="todo" label="possible" title="Même production, composition non prouvée" />;
}

const Loading = PageLoading;

export default function TraceabilityTab() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const back = () => setScreen({ kind: 'home' });
  if (screen.kind === 'forward') return <ForwardView id={screen.id} onBack={back} onRecall={id => setScreen({ kind: 'recall', id })} onLot={id => setScreen({ kind: 'backward', id })} />;
  if (screen.kind === 'backward') return <BackwardView id={screen.id} onBack={back} onRecall={id => setScreen({ kind: 'recall', id })} onLot={id => setScreen({ kind: 'forward', id })} />;
  if (screen.kind === 'recall') return <RecallView id={screen.id} onBack={back} />;
  return <Home onPick={h => setScreen({ kind: h.kind === 'ingredient_lot' ? 'forward' : 'backward', id: h.id })} onRecall={id => setScreen({ kind: 'recall', id })} />;
}

/* ─── Accueil : recherche + rappels ────────────────────────────────── */

function Home({ onPick, onRecall }: { onPick: (h: SearchHit) => void; onRecall: (id: string) => void }) {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['trace-search', term], queryFn: () => traceabilityApi.search(term), enabled: term.length >= 2,
  });
  const { data: recalls = [], isLoading } = useQuery({ queryKey: ['recalls'], queryFn: traceabilityApi.recalls });

  return (
    <>
      <form className="prj-toolbar" onSubmit={e => { e.preventDefault(); setTerm(input.trim()); }}>
        <label className="prj-search" style={{ maxWidth: 560 }}>
          <Search size={15} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
          <input type="search" value={input} onChange={e => setInput(e.target.value)} placeholder="N° de lot interne ou fournisseur, ingrédient, produit…"
            aria-label="Rechercher un lot" />
        </label>
        <button type="submit" className="odoo-btn-primary" disabled={input.trim().length < 2}>Rechercher</button>
      </form>

      {term.length >= 2 && (isFetching ? <Loading /> : hits.length === 0 ? (
        <NoResultState text="Aucun lot ne correspond à cette recherche." onReset={() => { setInput(''); setTerm(''); }} />
      ) : (
        <Panel title="Lots trouvés" hint={`${hits.length} résultat${hits.length > 1 ? 's' : ''}`}>
          <table className="odoo-table">
            <thead><tr><th>Type</th><th>Lot</th><th>Article</th><th>Fournisseur / magasin</th><th>Date</th><th>DLC</th><th>Statut</th><th className="ds-actions">Action</th></tr></thead>
            <tbody>
              {hits.map(h => (
                <tr key={`${h.kind}-${h.id}`} style={{ cursor: 'pointer' }} onClick={() => onPick(h)}>
                  <td><span className={`odoo-tag ${h.kind === 'ingredient_lot' ? 'odoo-tag-blue' : 'odoo-tag-purple'}`}>{h.kind === 'ingredient_lot' ? 'Ingrédient' : 'Produit fini'}</span></td>
                  <td className="ds-ref">
                    {h.lot_number}{h.supplier_lot_number && <div style={{ color: 'var(--ds-muted)', fontWeight: 400 }}>fourn. {h.supplier_lot_number}</div>}
                  </td>
                  <td className="ds-strong">{h.item_name}</td>
                  <td>{h.supplier_name ?? '—'}</td>
                  <td>{d(h.received_at)}</td>
                  <td>{d(h.expiration_date)}</td>
                  <td>{h.status}</td>
                  <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm">{h.kind === 'ingredient_lot' ? 'Voir l\'aval' : 'Voir l\'amont'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}

      <SectionTitle icon={Siren}>Rappels</SectionTitle>
      {isLoading ? <Loading /> : recalls.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Aucun rappel" text="Pour ouvrir un rappel, recherchez le lot en cause puis utilisez « Ouvrir un rappel »." />
      ) : (
        <Panel>
          <table className="odoo-table">
            <thead><tr><th>Référence</th><th>Origine</th><th>Motif</th><th className="ds-num">Lots</th><th>Ouvert le</th><th>Statut</th></tr></thead>
            <tbody>
              {recalls.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onRecall(r.id)}>
                  <td><span className="ds-ref">{r.reference}</span></td>
                  <td>{r.origin_label}</td>
                  <td style={{ maxWidth: 280 }}>{r.reason}</td>
                  <td className="ds-num">{r.items_count}</td>
                  <td>{dt(r.created_at)}<div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{r.created_by_name}</div></td>
                  <td><RecallStatusTag status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

function OpenRecallButton({ originKind, originId, onCreated }: { originKind: 'ingredient_lot' | 'product_lot'; originId: string; onCreated: (id: string) => void }) {
  const askReason = usePrompt();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (reason: string) => traceabilityApi.createRecall({ originKind, originId, reason }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['recalls'] }); notify.success(`Rappel ${r.reference} ouvert`); onCreated(r.id); },
    onError: (e) => notify.error(e),
  });
  return (
    <button type="button" className="ds-btn-danger" disabled={create.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      onClick={async () => {
        const reason = await askReason('Les lots concernés seront bloqués et les clients livrés retrouvés.', {
          title: 'Ouvrir un rappel', label: 'Motif du rappel', placeholder: 'Contamination, corps étranger, alerte fournisseur…',
          required: true, multiline: true, danger: true, confirmLabel: 'Ouvrir le rappel', hint: 'Au moins 3 caractères.',
        });
        if (reason && reason.trim().length >= 3) create.mutate(reason.trim());
      }}>
      <Siren size={13} /> Ouvrir un rappel
    </button>
  );
}

/**
 * En-tête d'une fiche (aval, amont, rappel) au gabarit commun : fil d'Ariane jusqu'à la pièce
 * (le premier élément ramène à l'accueil), actions à droite, puis titre + étiquette de statut.
 */
function Header({ onBack, crumb, title, status, children }: {
  onBack: () => void; crumb: string; title: string; status?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <>
      <div className="klc-record-head no-print">
        <button type="button" className="ds-icon-btn" onClick={onBack} aria-label="Retour à la traçabilité" title="Retour"><ArrowLeft size={16} aria-hidden="true" /></button>
        <Breadcrumb items={[{ label: 'Traçabilité & rappels', onClick: onBack }, { label: crumb }]} />
        <div className="klc-section-actions">{children}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--ds-t-section, 20px)', fontWeight: 700, color: 'var(--ds-ink)' }}>{title}</h2>
        {status}
      </div>
    </>
  );
}

/* ─── Aval d'un lot ingrédient ─────────────────────────────────────── */

function LotSalesRow({ lot, colSpan }: { lot: ProductLotTrace; colSpan: number }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['lot-sales', lot.id], queryFn: () => traceabilityApi.lotSales(lot.id) });
  return (
    <tr><td colSpan={colSpan} style={{ background: 'var(--ds-hair)' }}>
      {isLoading ? <Loading /> : data.length === 0 ? (
        <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>Aucune vente ni livraison tracée pour ce lot (les ventes ne sont rattachées aux lots que depuis la mise en service).</span>
      ) : (
        <DataPanel label={`Ventes du lot ${lot.lot_number}`}>
        <table className="odoo-table ds-dense">
          <thead><tr><th>Date</th><th>Pièce</th><th className="ds-num">Qté du lot</th><th>Client</th></tr></thead>
          <tbody>{data.map((s, i) => (
            <tr key={`${s.sale_id ?? s.delivery_note_id}-${i}`}><td>{dt(s.created_at)}</td>
              <td className="ds-ref">{s.kind === 'delivery' ? <>BL {s.delivery_note_number} <span className="odoo-tag odoo-tag-blue">pro</span></> : (s.sale_number ?? '—')}</td><td className="ds-num">{q(s.quantity)}</td>
              <td>{s.customer_name ? `${s.customer_name}${s.customer_phone ? ` · ${s.customer_phone}` : ''}` : <span style={{ color: 'var(--ds-muted)' }}>anonyme</span>}</td></tr>
          ))}</tbody>
        </table>
        </DataPanel>
      )}
    </td></tr>
  );
}

function ForwardView({ id, onBack, onRecall, onLot }: { id: string; onBack: () => void; onRecall: (id: string) => void; onLot: (id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['trace-forward', id], queryFn: () => traceabilityApi.forward(id) });
  const [openSales, setOpenSales] = useState<string | null>(null);
  if (isLoading || !data) return <Loading />;
  const { lot } = data;
  const sold = data.productLots.reduce((s, l) => s + l.sold_qty, 0);
  const remaining = data.productLots.reduce((s, l) => s + l.remaining_qty, 0);

  return (
    <>
      <Header onBack={onBack} crumb={`Lot ${lot.lot_number}`} title={`Aval — ${lot.ingredient_name}, lot ${lot.lot_number}`}
        status={<StatusTag tone="draft" label={String(lot.status)} />}>
        <button type="button" className="odoo-btn-secondary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Imprimer</button>
        <OpenRecallButton originKind="ingredient_lot" originId={id} onCreated={onRecall} />
      </Header>
      <div className="prj-kpis">
        <Stat label="Fournisseur" value={lot.supplier_name ?? '—'} sub={`lot fourn. ${lot.supplier_lot_number ?? '—'} · ${lot.voucher_number ?? 'hors BC'}`} />
        <Stat label="Reçu le" value={d(lot.received_at)} sub={`DLC ${d(lot.expiration_date)} · statut ${lot.status}`} />
        <Stat label="Quantité" value={`${q(lot.quantity_remaining)} / ${q(lot.quantity_received)} ${lot.unit ?? ''}`} sub="restant / reçu" />
        <Stat label="Lots produits touchés" value={String(data.productLots.length)} sub={`${q(sold)} vendus · ${q(remaining)} en stock`} />
      </div>
      {data.productLots.length === 0 && data.plans.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Ce lot n'a été utilisé dans aucune production">Il suffit de bloquer le lot lui-même.</StatusBanner>
      ) : remaining > 0 ? (
        <StatusBanner tone="danger" icon={ShieldAlert} title={`${q(remaining)} unité(s) potentiellement concernées sont encore en stock`}>
          {data.byStore.map(s => `${s.store_name} : ${q(s.remaining)}`).join(' · ')}
        </StatusBanner>
      ) : null}

      {data.plans.length > 0 && (
        <Panel title="Productions" hint={`${data.plans.length}`}>
          <table className="odoo-table">
            <thead><tr><th>Production</th><th>Magasin</th><th>Statut</th><th className="ds-num">Quantité du lot utilisée</th><th>Voie</th></tr></thead>
            <tbody>{data.plans.map(p => (
              <tr key={p.id}><td>{d(p.plan_date)}</td><td>{p.store_name ?? '—'}</td><td>{p.status}</td>
                <td className="ds-num">{p.qty_used != null ? `${q(p.qty_used)} ${lot.unit ?? ''}` : '—'}</td>
                <td>{p.depth === 0 ? 'directe' : `via semi-fini (niveau ${p.depth})`}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      )}

      {data.semiLots.length > 0 && (
        <Panel title="Semi-finis" hint={`${data.semiLots.length}`}>
          <table className="odoo-table">
            <thead><tr><th>Semi-fini</th><th>Lot</th><th className="ds-num">Produit</th><th className="ds-num">Restant</th><th>Statut</th></tr></thead>
            <tbody>{data.semiLots.map(s => (
              <tr key={s.id}><td className="ds-strong">{s.recipe_name}</td><td className="ds-ref">{s.lot_number}</td>
                <td className="ds-num">{q(s.quantity_produced)} {s.unit}</td><td className="ds-num">{q(s.quantity_remaining)} {s.unit}</td><td>{s.status}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      )}

      {data.productLots.length > 0 && (
        <Panel title="Lots produits touchés" hint={`${data.productLots.length}`}>
          <table className="odoo-table">
            <thead><tr><th>Produit</th><th>Lot</th><th>Lien</th><th>Magasin</th><th>DLC</th><th className="ds-num">Produit</th><th className="ds-num">Vendu</th><th className="ds-num">Perdu</th><th className="ds-num">En stock</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>{data.productLots.map(l => [
              <tr key={l.id} className={l.remaining_qty > 0 ? 'row-warning' : undefined}>
                <td className="ds-strong">{l.product_name}</td>
                <td className="ds-ref"><button type="button" onClick={() => onLot(l.id)} style={{ textDecoration: 'underline', color: 'inherit', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{l.lot_number}</button></td>
                <td><CertaintyTag c={l.certainty} /></td>
                <td>{l.store_name ?? '—'}</td>
                <td>{d(l.expires_at)}</td>
                <td className="ds-num">{q(l.quantity_total)}</td>
                <td className="ds-num">{q(l.sold_qty)}</td>
                <td className="ds-num">{q(l.wasted_qty + l.recycled_qty)}</td>
                <td className="ds-num" style={{ fontWeight: 600 }}>{q(l.remaining_qty)}</td>
                <td className="ds-actions">
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" aria-expanded={openSales === l.id} onClick={() => setOpenSales(openSales === l.id ? null : l.id)}>Ventes ({l.sales_count})</button>
                </td>
              </tr>,
              openSales === l.id && <LotSalesRow key={`${l.id}-s`} lot={l} colSpan={10} />,
            ])}</tbody>
          </table>
        </Panel>
      )}
      <p className="klc-note">
        « certain » : la recette du produit contient l'ingrédient. « possible » : même production, composition non prouvée (la consommation est enregistrée par plan, pas par produit).
        Le détail des ventes par ticket n'existe que depuis {data.traceStart ? d(data.traceStart) : 'la mise en service de la traçabilité'} ; avant, seuls les totaux par lot sont connus.
      </p>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <ListKpi label={label} value={value} sub={sub} />;
}

/* ─── Amont d'un lot produit ───────────────────────────────────────── */

function BackwardView({ id, onBack, onRecall, onLot }: { id: string; onBack: () => void; onRecall: (id: string) => void; onLot: (id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['trace-backward', id], queryFn: () => traceabilityApi.backward(id) });
  if (isLoading || !data) return <Loading />;
  const { lot } = data;
  return (
    <>
      <Header onBack={onBack} crumb={`Lot ${lot.lot_number}`} title={`Amont — ${lot.product_name}, lot ${lot.lot_number}`}>
        <button type="button" className="odoo-btn-secondary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Imprimer</button>
        <OpenRecallButton originKind="product_lot" originId={id} onCreated={onRecall} />
      </Header>
      <div className="prj-kpis">
        <Stat label="Produit le" value={d(lot.produced_at)} sub={`DLC ${d(lot.expires_at)} · ${lot.store_name ?? ''}`} />
        <Stat label="Quantité" value={`${q(lot.remaining_qty)} / ${q(lot.quantity_total)}`} sub="en stock / produit" />
        <Stat label="Vendu" value={q(lot.sold_qty)} sub={`${lot.sales_count} ticket(s) tracé(s)`} />
        <Stat label="Lots d'ingrédients" value={String(data.ingredientLots.length)} sub="utilisés par la production" />
      </div>
      <div><CustomFieldsCard entity="product_lot" id={id} /></div>
      <QualityPanel filter={{ productLotId: id }} links={{ productLotId: id }} title={`Contrôle lot ${lot.lot_number}`} />
      {data.ingredientLots.length === 0 ? (
        <StatusBanner tone="warning" icon={AlertTriangle} title="Aucun lot d'ingrédient rattaché">La production n'a pas enregistré de prélèvement par lot (bon de sortie non pesé).</StatusBanner>
      ) : (
        <Panel title="Lots d'ingrédients utilisés" hint={`${data.ingredientLots.length}`}>
          <table className="odoo-table">
            <thead><tr><th>Ingrédient</th><th>Lot</th><th>Lien</th><th>Fournisseur</th><th>DLC</th><th className="ds-num">Utilisé</th><th>Voie</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>{data.ingredientLots.map((l, i) => (
              <tr key={`${l.id}-${i}`}>
                <td className="ds-strong">{l.ingredient_name}</td>
                <td className="ds-ref">{l.lot_number}{l.supplier_lot_number && <div style={{ color: 'var(--ds-muted)', fontWeight: 400 }}>fourn. {l.supplier_lot_number}</div>}</td>
                <td><CertaintyTag c={l.certainty} /></td>
                <td>{l.supplier_name ?? '—'}</td>
                <td>{d(l.expiration_date)}</td>
                <td className="ds-num">{q(l.qty_used)} {l.unit ?? ''}</td>
                <td>{l.depth === 0 ? 'directe' : `semi-fini niv. ${l.depth}`}</td>
                <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => onLot(l.id)}>Aval</button></td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

/* ─── Rappel ───────────────────────────────────────────────────────── */

function RecallView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: r, isLoading } = useQuery({ queryKey: ['recall', id], queryFn: () => traceabilityApi.recall(id) });
  const confirm = useConfirm();
  const askReason = usePrompt();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['recall', id] }); qc.invalidateQueries({ queryKey: ['recalls'] }); };
  const block = useMutation({ mutationFn: () => traceabilityApi.block(id), onSuccess: () => { refresh(); notify.success('Lots bloqués, boutiques prévenues'); }, onError: (e) => notify.error(e) });
  const dispo = useMutation({
    mutationFn: (p: { itemId: string; disposition: Disposition | null }) => traceabilityApi.setDisposition(id, p.itemId, p.disposition),
    onSuccess: refresh, onError: (e) => notify.error(e),
  });
  const close = useMutation({ mutationFn: (note: string) => traceabilityApi.close(id, note), onSuccess: () => { refresh(); notify.success('Rappel clôturé'); }, onError: (e) => notify.error(e) });
  if (isLoading || !r) return <Loading />;
  const pending = r.items.filter(i => !i.disposition).length;

  return (
    <>
      <Header onBack={onBack} crumb={r.reference} title={`Rappel ${r.reference}`} status={<RecallStatusTag status={r.status} />}>
        <button type="button" className="odoo-btn-secondary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Rapport</button>
        {r.status === 'open' && (
          <button type="button" className="ds-btn-danger" disabled={block.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={async () => { if (await confirm(`Bloquer les ${r.items.length} lot(s) ? Ils ne pourront plus être utilisés ni vendus.`, { title: 'Bloquer les lots', confirmLabel: 'Bloquer les lots', danger: true })) block.mutate(); }}>
            <Lock size={13} /> Bloquer les lots
          </button>
        )}
        {r.status === 'blocked' && (
          <button type="button" className="odoo-btn-primary" disabled={close.isPending || pending > 0} title={pending ? `${pending} lot(s) sans destination` : undefined}
            onClick={async () => {
              const note = await askReason('La conclusion est conservée dans le dossier du rappel.', {
                title: 'Clôturer le rappel', label: 'Conclusion', placeholder: 'Cause, mesures, information ONSSA / clients',
                required: true, multiline: true, confirmLabel: 'Clôturer', hint: 'Au moins 3 caractères.',
              });
              if (note && note.trim().length >= 3) close.mutate(note.trim());
            }}>
            Clôturer
          </button>
        )}
      </Header>

      <section className="prj-panel klc-facts" aria-label="Rappel">
        <div><span>Origine</span>{r.origin_label}</div>
        <div><span>Motif</span>{r.reason}</div>
        <div><span>Ouvert</span>{dt(r.created_at)} · {r.created_by_name}</div>
        <div><span>Bloqué</span>{r.blocked_at ? `${dt(r.blocked_at)} · ${r.blocked_by_name ?? ''}` : '—'}</div>
        <div><span>Clôturé</span>{r.closed_at ? `${dt(r.closed_at)} · ${r.closed_by_name ?? ''}` : '—'}</div>
        {r.closing_note && <div style={{ gridColumn: '1 / -1' }}><span>Conclusion</span>{r.closing_note}</div>}
      </section>

      {r.status === 'open' && (
        <StatusBanner tone="orange" icon={ShieldAlert} title="Périmètre identifié, rien n'est encore bloqué">
          Vérifiez la liste puis bloquez : les lots d'ingrédients passent en quarantaine, les lots produits sont retirés de la vente (hors FEFO).
        </StatusBanner>
      )}
      {r.status === 'blocked' && (
        <StatusBanner tone="danger" icon={AlertTriangle} title="Retrait physique à faire">
          Retirez les produits des vitrines et réserves, puis renseignez la destination de chaque lot. Le stock vitrine n'est pas ajusté automatiquement :
          déclarez la destruction dans Pertes pour qu'elle soit valorisée.
        </StatusBanner>
      )}

      <Panel title="Lots du rappel" hint={pending ? `${pending} sans destination` : `${r.items.length}`}>
        <table className="odoo-table">
          <thead><tr><th>Type</th><th>Article</th><th>Lot</th><th>Lien</th><th>Magasin</th><th className="ds-num">Vendu</th><th className="ds-num">En stock</th><th>Statut</th><th>Destination</th></tr></thead>
          <tbody>{r.items.map(i => (
            <tr key={i.id} className={(i.current_remaining ?? 0) > 0 && !i.disposition ? 'row-warning' : undefined}>
              <td>{i.item_kind === 'ingredient_lot' ? 'Ingrédient' : i.item_kind === 'semi_finished_lot' ? 'Semi-fini' : 'Produit fini'}</td>
              <td className="ds-strong">{i.label}</td>
              <td className="ds-ref">{i.lot_number ?? '—'}</td>
              <td><CertaintyTag c={i.certainty} /></td>
              <td>{i.store_name ?? '—'}</td>
              <td className="ds-num">{i.item_kind === 'product_lot' ? <>{q(i.qty_sold)}{i.sales_count ? <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{i.sales_count} ticket(s)</div> : null}</> : '—'}</td>
              <td className="ds-num" style={{ fontWeight: 600 }}>{q(i.current_remaining)} {i.unit && i.unit !== 'u' ? i.unit : ''}</td>
              <td>{i.current_status}</td>
              <td>
                {r.status === 'closed' ? (i.disposition ? DISPOSITION_LABELS[i.disposition] : '—') : (
                  <select value={i.disposition ?? ''} disabled={r.status === 'open'} aria-label={`Destination ${i.label}`} className="ds-input sm" style={{ width: 'auto' }}
                    onChange={e => dispo.mutate({ itemId: i.id, disposition: (e.target.value || null) as Disposition | null })}>
                    <option value="">{r.status === 'open' ? 'Bloquer d\'abord' : 'À renseigner'}</option>
                    {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map(k => <option key={k} value={k}>{DISPOSITION_LABELS[k]}</option>)}
                  </select>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </>
  );
}
