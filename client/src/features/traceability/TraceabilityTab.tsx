import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, ArrowLeft, Siren, Printer, Info, AlertTriangle, CheckCircle2, ShieldAlert, Lock } from 'lucide-react';
import { format } from 'date-fns';
import {
  traceabilityApi, DISPOSITION_LABELS, RECALL_STATUS_LABELS,
  type Certainty, type Disposition, type ProductLotTrace, type RecallStatus, type SearchHit,
} from '../../api/traceability.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

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
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 };
const RECALL_TAG: Record<RecallStatus, string> = { open: 'odoo-tag-orange', blocked: 'odoo-tag-red', closed: 'odoo-tag-green' };

function CertaintyTag({ c }: { c?: Certainty }) {
  return c === 'certain'
    ? <span className="odoo-tag odoo-tag-red" title="La recette contient l'ingrédient">certain</span>
    : <span className="odoo-tag odoo-tag-yellow" title="Même production, composition non prouvée">possible</span>;
}

function Loading() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Loader2 size={20} className="animate-spin" /></div>;
}

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
      <form className="odoo-search-panel" style={{ margin: 0 }} onSubmit={e => { e.preventDefault(); setTerm(input.trim()); }}>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: 1, maxWidth: 480 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--theme-text-muted)' }} />
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="N° de lot interne ou fournisseur, ingrédient, produit…"
            className="odoo-search-input" style={{ paddingLeft: 26, width: '100%' }} aria-label="Rechercher un lot" />
        </span>
        <button type="submit" className="odoo-btn-primary" disabled={input.trim().length < 2}>Rechercher</button>
      </form>

      {term.length >= 2 && (isFetching ? <Loading /> : hits.length === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Aucun lot trouvé" />
      ) : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Type</th><th>Lot</th><th>Article</th><th>Fournisseur / magasin</th><th>Date</th><th>DLC</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {hits.map(h => (
                <tr key={`${h.kind}-${h.id}`} style={{ cursor: 'pointer' }} onClick={() => onPick(h)}>
                  <td><span className={`odoo-tag ${h.kind === 'ingredient_lot' ? 'odoo-tag-blue' : 'odoo-tag-purple'}`}>{h.kind === 'ingredient_lot' ? 'Ingrédient' : 'Produit fini'}</span></td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', fontWeight: 600 }}>
                    {h.lot_number}{h.supplier_lot_number && <div style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>fourn. {h.supplier_lot_number}</div>}
                  </td>
                  <td>{h.item_name}</td>
                  <td>{h.supplier_name ?? '—'}</td>
                  <td>{d(h.received_at)}</td>
                  <td>{d(h.expiration_date)}</td>
                  <td>{h.status}</td>
                  <td style={{ textAlign: 'right' }}><button type="button" className="odoo-btn-secondary">{h.kind === 'ingredient_lot' ? 'Aval' : 'Amont'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h3 style={{ margin: '8px 0 0', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Siren size={15} /> Rappels</h3>
      {isLoading ? <Loading /> : recalls.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Aucun rappel">
          Pour ouvrir un rappel, recherchez le lot en cause puis utilisez « Ouvrir un rappel ».
        </StatusBanner>
      ) : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Référence</th><th>Origine</th><th>Motif</th><th style={{ textAlign: 'right' }}>Lots</th><th>Ouvert le</th><th>Statut</th></tr></thead>
            <tbody>
              {recalls.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onRecall(r.id)}>
                  <td style={{ fontWeight: 600 }}>{r.reference}</td>
                  <td>{r.origin_label}</td>
                  <td style={{ maxWidth: 280 }}>{r.reason}</td>
                  <td style={{ textAlign: 'right' }}>{r.items_count}</td>
                  <td>{dt(r.created_at)}<div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{r.created_by_name}</div></td>
                  <td><span className={`odoo-tag ${RECALL_TAG[r.status]}`}>{RECALL_STATUS_LABELS[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OpenRecallButton({ originKind, originId, onCreated }: { originKind: 'ingredient_lot' | 'product_lot'; originId: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (reason: string) => traceabilityApi.createRecall({ originKind, originId, reason }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['recalls'] }); notify.success(`Rappel ${r.reference} ouvert`); onCreated(r.id); },
    onError: (e) => notify.error(e),
  });
  return (
    <button type="button" className="odoo-btn-danger" disabled={create.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      onClick={() => {
        const reason = window.prompt('Motif du rappel (contamination, corps étranger, alerte fournisseur…)');
        if (reason && reason.trim().length >= 3) create.mutate(reason.trim());
      }}>
      <Siren size={13} /> Ouvrir un rappel
    </button>
  );
}

function Header({ onBack, title, children }: { onBack: () => void; title: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} className="no-print">
      <button type="button" className="odoo-btn-secondary" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={13} /> Retour</button>
      <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>{title}</h3>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>{children}</div>
    </div>
  );
}

/* ─── Aval d'un lot ingrédient ─────────────────────────────────────── */

function LotSalesRow({ lot, colSpan }: { lot: ProductLotTrace; colSpan: number }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['lot-sales', lot.id], queryFn: () => traceabilityApi.lotSales(lot.id) });
  return (
    <tr><td colSpan={colSpan} style={{ background: 'var(--odoo-bg-hover)' }}>
      {isLoading ? <Loading /> : data.length === 0 ? (
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Aucune vente tracée pour ce lot (les ventes ne sont rattachées aux lots que depuis la mise en service).</span>
      ) : (
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr><th>Date</th><th>Ticket</th><th style={{ textAlign: 'right' }}>Qté du lot</th><th>Client</th></tr></thead>
          <tbody>{data.map((s, i) => (
            <tr key={`${s.sale_id}-${i}`}><td>{dt(s.created_at)}</td><td>{s.sale_number ?? '—'}</td><td style={{ textAlign: 'right' }}>{q(s.quantity)}</td>
              <td>{s.customer_name ? `${s.customer_name}${s.customer_phone ? ` · ${s.customer_phone}` : ''}` : <span style={{ color: 'var(--theme-text-muted)' }}>anonyme</span>}</td></tr>
          ))}</tbody>
        </table>
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
      <Header onBack={onBack} title={`Aval — ${lot.ingredient_name}, lot ${lot.lot_number}`}>
        <button type="button" className="odoo-btn-secondary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Imprimer</button>
        <OpenRecallButton originKind="ingredient_lot" originId={id} onCreated={onRecall} />
      </Header>
      <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
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
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Production</th><th>Magasin</th><th>Statut</th><th style={{ textAlign: 'right' }}>Quantité du lot utilisée</th><th>Voie</th></tr></thead>
            <tbody>{data.plans.map(p => (
              <tr key={p.id}><td>{d(p.plan_date)}</td><td>{p.store_name ?? '—'}</td><td>{p.status}</td>
                <td style={{ textAlign: 'right' }}>{p.qty_used != null ? `${q(p.qty_used)} ${lot.unit ?? ''}` : '—'}</td>
                <td>{p.depth === 0 ? 'directe' : `via semi-fini (niveau ${p.depth})`}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {data.semiLots.length > 0 && (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Semi-fini</th><th>Lot</th><th style={{ textAlign: 'right' }}>Produit</th><th style={{ textAlign: 'right' }}>Restant</th><th>Statut</th></tr></thead>
            <tbody>{data.semiLots.map(s => (
              <tr key={s.id}><td>{s.recipe_name}</td><td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{s.lot_number}</td>
                <td style={{ textAlign: 'right' }}>{q(s.quantity_produced)} {s.unit}</td><td style={{ textAlign: 'right' }}>{q(s.quantity_remaining)} {s.unit}</td><td>{s.status}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {data.productLots.length > 0 && (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Produit</th><th>Lot</th><th>Lien</th><th>Magasin</th><th>DLC</th><th style={{ textAlign: 'right' }}>Produit</th><th style={{ textAlign: 'right' }}>Vendu</th><th style={{ textAlign: 'right' }}>Perdu</th><th style={{ textAlign: 'right' }}>En stock</th><th /></tr></thead>
            <tbody>{data.productLots.map(l => [
              <tr key={l.id} className={l.remaining_qty > 0 ? 'row-warning' : undefined}>
                <td style={{ fontWeight: 600 }}>{l.product_name}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}><button type="button" onClick={() => onLot(l.id)} style={{ textDecoration: 'underline', color: 'inherit', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{l.lot_number}</button></td>
                <td><CertaintyTag c={l.certainty} /></td>
                <td>{l.store_name ?? '—'}</td>
                <td>{d(l.expires_at)}</td>
                <td style={{ textAlign: 'right' }}>{q(l.quantity_total)}</td>
                <td style={{ textAlign: 'right' }}>{q(l.sold_qty)}</td>
                <td style={{ textAlign: 'right' }}>{q(l.wasted_qty + l.recycled_qty)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{q(l.remaining_qty)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="odoo-btn-secondary" onClick={() => setOpenSales(openSales === l.id ? null : l.id)}>Ventes ({l.sales_count})</button>
                </td>
              </tr>,
              openSales === l.id && <LotSalesRow key={`${l.id}-s`} lot={l} colSpan={10} />,
            ])}</tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        « certain » : la recette du produit contient l'ingrédient. « possible » : même production, composition non prouvée (la consommation est enregistrée par plan, pas par produit).
        Le détail des ventes par ticket n'existe que depuis {data.traceStart ? d(data.traceStart) : 'la mise en service de la traçabilité'} ; avant, seuls les totaux par lot sont connus.
      </p>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value" style={{ fontSize: '1rem' }}>{value}</div>
      {sub && <div className="odoo-stat-card-sub">{sub}</div>}
    </div>
  );
}

/* ─── Amont d'un lot produit ───────────────────────────────────────── */

function BackwardView({ id, onBack, onRecall, onLot }: { id: string; onBack: () => void; onRecall: (id: string) => void; onLot: (id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['trace-backward', id], queryFn: () => traceabilityApi.backward(id) });
  if (isLoading || !data) return <Loading />;
  const { lot } = data;
  return (
    <>
      <Header onBack={onBack} title={`Amont — ${lot.product_name}, lot ${lot.lot_number}`}>
        <button type="button" className="odoo-btn-secondary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Imprimer</button>
        <OpenRecallButton originKind="product_lot" originId={id} onCreated={onRecall} />
      </Header>
      <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
        <Stat label="Produit le" value={d(lot.produced_at)} sub={`DLC ${d(lot.expires_at)} · ${lot.store_name ?? ''}`} />
        <Stat label="Quantité" value={`${q(lot.remaining_qty)} / ${q(lot.quantity_total)}`} sub="en stock / produit" />
        <Stat label="Vendu" value={q(lot.sold_qty)} sub={`${lot.sales_count} ticket(s) tracé(s)`} />
        <Stat label="Lots d'ingrédients" value={String(data.ingredientLots.length)} sub="utilisés par la production" />
      </div>
      {data.ingredientLots.length === 0 ? (
        <StatusBanner tone="warning" icon={AlertTriangle} title="Aucun lot d'ingrédient rattaché">La production n'a pas enregistré de prélèvement par lot (bon de sortie non pesé).</StatusBanner>
      ) : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Ingrédient</th><th>Lot</th><th>Lien</th><th>Fournisseur</th><th>DLC</th><th style={{ textAlign: 'right' }}>Utilisé</th><th>Voie</th><th /></tr></thead>
            <tbody>{data.ingredientLots.map((l, i) => (
              <tr key={`${l.id}-${i}`}>
                <td style={{ fontWeight: 600 }}>{l.ingredient_name}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{l.lot_number}{l.supplier_lot_number && <div style={{ color: 'var(--theme-text-muted)' }}>fourn. {l.supplier_lot_number}</div>}</td>
                <td><CertaintyTag c={l.certainty} /></td>
                <td>{l.supplier_name ?? '—'}</td>
                <td>{d(l.expiration_date)}</td>
                <td style={{ textAlign: 'right' }}>{q(l.qty_used)} {l.unit ?? ''}</td>
                <td>{l.depth === 0 ? 'directe' : `semi-fini niv. ${l.depth}`}</td>
                <td style={{ textAlign: 'right' }}><button type="button" className="odoo-btn-secondary" onClick={() => onLot(l.id)}>Aval</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ─── Rappel ───────────────────────────────────────────────────────── */

function RecallView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: r, isLoading } = useQuery({ queryKey: ['recall', id], queryFn: () => traceabilityApi.recall(id) });
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
      <Header onBack={onBack} title={`Rappel ${r.reference}`}>
        <button type="button" className="odoo-btn-secondary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Rapport</button>
        {r.status === 'open' && (
          <button type="button" className="odoo-btn-danger" disabled={block.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={() => { if (window.confirm(`Bloquer les ${r.items.length} lot(s) ? Ils ne pourront plus être utilisés ni vendus.`)) block.mutate(); }}>
            <Lock size={13} /> Bloquer les lots
          </button>
        )}
        {r.status === 'blocked' && (
          <button type="button" className="odoo-btn-primary" disabled={close.isPending || pending > 0} title={pending ? `${pending} lot(s) sans destination` : undefined}
            onClick={() => { const note = window.prompt('Conclusion du rappel (cause, mesures, information ONSSA / clients)'); if (note && note.trim().length >= 3) close.mutate(note.trim()); }}>
            Clôturer
          </button>
        )}
      </Header>

      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, fontSize: '0.8125rem' }}>
        <div><div style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>Origine</div>{r.origin_label}</div>
        <div><div style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>Motif</div>{r.reason}</div>
        <div><div style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>Statut</div><span className={`odoo-tag ${RECALL_TAG[r.status]}`}>{RECALL_STATUS_LABELS[r.status]}</span></div>
        <div><div style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>Ouvert</div>{dt(r.created_at)} · {r.created_by_name}</div>
        <div><div style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>Bloqué</div>{r.blocked_at ? `${dt(r.blocked_at)} · ${r.blocked_by_name ?? ''}` : '—'}</div>
        <div><div style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>Clôturé</div>{r.closed_at ? `${dt(r.closed_at)} · ${r.closed_by_name ?? ''}` : '—'}</div>
        {r.closing_note && <div style={{ gridColumn: '1 / -1' }}><div style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>Conclusion</div>{r.closing_note}</div>}
      </div>

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

      <div style={tableWrap}>
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr><th>Type</th><th>Article</th><th>Lot</th><th>Lien</th><th>Magasin</th><th style={{ textAlign: 'right' }}>Vendu</th><th style={{ textAlign: 'right' }}>En stock</th><th>Statut</th><th>Destination</th></tr></thead>
          <tbody>{r.items.map(i => (
            <tr key={i.id} className={(i.current_remaining ?? 0) > 0 && !i.disposition ? 'row-warning' : undefined}>
              <td>{i.item_kind === 'ingredient_lot' ? 'Ingrédient' : i.item_kind === 'semi_finished_lot' ? 'Semi-fini' : 'Produit fini'}</td>
              <td style={{ fontWeight: 600 }}>{i.label}</td>
              <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{i.lot_number ?? '—'}</td>
              <td><CertaintyTag c={i.certainty} /></td>
              <td>{i.store_name ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>{i.item_kind === 'product_lot' ? <>{q(i.qty_sold)}{i.sales_count ? <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{i.sales_count} ticket(s)</div> : null}</> : '—'}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{q(i.current_remaining)} {i.unit && i.unit !== 'u' ? i.unit : ''}</td>
              <td>{i.current_status}</td>
              <td>
                {r.status === 'closed' ? (i.disposition ? DISPOSITION_LABELS[i.disposition] : '—') : (
                  <select value={i.disposition ?? ''} disabled={r.status === 'open'} aria-label={`Destination ${i.label}`} className="odoo-search-input"
                    onChange={e => dispo.mutate({ itemId: i.id, disposition: (e.target.value || null) as Disposition | null })}>
                    <option value="">{r.status === 'open' ? 'Bloquer d\'abord' : 'À renseigner'}</option>
                    {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map(k => <option key={k} value={k}>{DISPOSITION_LABELS[k]}</option>)}
                  </select>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
