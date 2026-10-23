import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ShieldAlert, Search, Package, Factory, Boxes, Users, Loader2,
  Recycle, Info, AlertTriangle, PhoneOff, Phone,
} from 'lucide-react';
import { recallApi, type RecallResult, type RecallNode, type RecallSale } from '../../api/recall.api';
import { StatusBanner } from '../../components/ui/StatusBanner';

/** Date lisible (jour) ou '—'. */
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : format(d, 'dd MMM yyyy', { locale: fr });
}
/** Date + heure (pour les ventes). */
function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : format(d, 'dd MMM yyyy HH:mm', { locale: fr });
}
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Toutes les ventes de l'arbre, aplaties, avec le produit/lot d'origine. */
function flattenSales(root: RecallNode): (RecallSale & { productName: string; lotNumber: string })[] {
  const out: (RecallSale & { productName: string; lotNumber: string })[] = [];
  const walk = (node: RecallNode) => {
    for (const plan of node.plans) {
      for (const batch of plan.batches) {
        for (const sale of [...batch.sales, ...batch.approximateSales]) {
          out.push({ ...sale, productName: batch.productName, lotNumber: batch.lotNumber });
        }
        batch.recycledInto.forEach(walk);
      }
    }
  };
  walk(root);
  // Clients nominatifs d'abord, puis anonymes ; plus récents en tête.
  return out.sort((a, b) => {
    if (!!a.customerId !== !!b.customerId) return a.customerId ? -1 : 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

export default function RecallPage() {
  const [search, setSearch] = useState('');
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

  const { data: lots = [], isFetching: lotsLoading } = useQuery({
    queryKey: ['recall-lots', search],
    queryFn: () => recallApi.lots(search || undefined),
  });

  const { data: recall, isFetching: recallLoading, error } = useQuery<RecallResult>({
    queryKey: ['recall', selectedLotId],
    queryFn: () => recallApi.recall(selectedLotId!),
    enabled: !!selectedLotId,
  });

  const allSales = useMemo(() => (recall ? flattenSales(recall.root) : []), [recall]);

  return (
    <div className="odoo-scope">
      <div className="odoo-form-header">
        <h1 className="odoo-form-title">
          <ShieldAlert size={18} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--theme-accent)' }} />
          Rappel — partir d'un lot
        </h1>
        <p className="odoo-form-subtitle">
          Traçabilité descendante : d'un lot de matière première jusqu'aux clients ayant acheté
          les produits finis qui en sont issus.
        </p>
      </div>

      {/* ══════ Chaîne de traçabilité (repère visuel) ══════ */}
      <div className="ui-timeline" style={{ margin: '12px 0 20px' }}>
        {[
          { label: 'Lot matière', icon: Package },
          { label: 'Production', icon: Factory },
          { label: 'Fournées', icon: Boxes },
          { label: 'Clients', icon: Users },
        ].map((s, i) => (
          <div key={s.label} className={`ui-timeline-step ${selectedLotId ? 'is-done' : i === 0 ? 'is-current' : ''}`}>
            <span className="ui-timeline-dot"><s.icon size={12} /></span>
            <span className="ui-timeline-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ══════ Sélection du lot ══════ */}
      <div className="odoo-section">
        <div className="odoo-section-header">Choisir un lot de matière première</div>
        <div style={{ position: 'relative', maxWidth: 420, margin: '8px 0' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--odoo-text-muted)' }} />
          <input
            className="odoo-search-input"
            style={{ paddingLeft: 30, width: '100%' }}
            placeholder="Ingrédient, fournisseur ou n° de lot fournisseur…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--odoo-border, #e5e7eb)', borderRadius: 6 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Lot</th><th>Ingrédient</th><th>Fournisseur</th><th>DLC</th><th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {lotsLoading && lots.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 12 }}><Loader2 size={14} className="animate-spin" /> Chargement…</td></tr>
              )}
              {!lotsLoading && lots.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 12, color: 'var(--odoo-text-muted)' }}>Aucun lot trouvé.</td></tr>
              )}
              {lots.map(l => (
                <tr
                  key={l.id}
                  onClick={() => setSelectedLotId(l.id)}
                  style={{ cursor: 'pointer', background: l.id === selectedLotId ? 'var(--odoo-purple-light, #f3e8ff)' : undefined }}
                >
                  <td style={{ fontFamily: 'monospace' }}>{l.lot_number}</td>
                  <td>{l.ingredient_name || '—'}</td>
                  <td>{l.supplier_name || '—'}{l.supplier_lot_number ? ` · ${l.supplier_lot_number}` : ''}</td>
                  <td>{fmtDate(l.expiration_date)}</td>
                  <td><span className={`odoo-tag ${l.status === 'active' ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════ Résultat du rappel ══════ */}
      {recallLoading && (
        <div style={{ textAlign: 'center', padding: 30 }}><Loader2 size={20} className="animate-spin" /> Analyse de la chaîne…</div>
      )}
      {error && (
        <StatusBanner tone="danger" icon={AlertTriangle} title="Erreur">
          Impossible de charger la chaîne de rappel pour ce lot.
        </StatusBanner>
      )}

      {recall && !recallLoading && (
        <>
          {/* Synthèse chiffrée */}
          <div className="odoo-stat-grid" style={{ marginTop: 16 }}>
            <Stat label="Plans de production" value={recall.summary.totalPlans} />
            <Stat label="Fournées produites" value={recall.summary.totalBatches} />
            <Stat label="Vendu" value={n2(recall.summary.soldQty)} />
            <Stat label="Encore en stock" value={n2(recall.summary.inStockQty)} sub="backroom + vitrine" />
            <Stat label="Jeté" value={n2(recall.summary.wastedQty)} />
            <Stat label="Recyclé" value={n2(recall.summary.recycledQty)} />
            <Stat label="Clients à contacter" value={recall.summary.customersToContact} />
            <Stat label="Ventes anonymes" value={recall.summary.anonymousSalesCount} />
          </div>

          {/* Avertissements métier */}
          {recall.summary.approximateSalesCount > 0 && (
            <StatusBanner tone="warning" icon={AlertTriangle} title="Ventes approximatives incluses">
              {recall.summary.approximateSalesCount} vente(s) sont rattachées par recoupement de dates
              (produit vendu dans la fenêtre DLC du lot, sur le même magasin) faute de lien par ligne —
              ventes antérieures au suivi par lot. À traiter comme une approximation à vérifier.
            </StatusBanner>
          )}
          {recall.summary.anonymousSalesCount > 0 && (
            <StatusBanner tone="info" icon={PhoneOff} title="Ventes anonymes">
              {recall.summary.anonymousSalesCount} vente(s) sans client identifié (walk-in POS) :
              seuls la date, le magasin et le caissier sont disponibles.
            </StatusBanner>
          )}

          {/* Arbre d'impact */}
          <div className="odoo-section" style={{ marginTop: 16 }}>
            <div className="odoo-section-header">Arbre d'impact</div>
            <RecallNodeView node={recall.root} depth={0} />
          </div>

          {/* Liste consolidée des clients à contacter */}
          <div className="odoo-section" style={{ marginTop: 16 }}>
            <div className="odoo-section-header">Clients à contacter ({allSales.length})</div>
            {allSales.length === 0 ? (
              <StatusBanner tone="success" icon={Info} title="Aucune vente rattachée">
                Aucun produit issu de ce lot n'a encore été vendu.
              </StatusBanner>
            ) : (
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th>Client</th><th>Téléphone</th><th>Produit</th><th>Lot produit</th>
                    <th>Date de vente</th><th>Qté</th><th>Magasin</th><th>Caissier</th><th>Fiabilité</th>
                  </tr>
                </thead>
                <tbody>
                  {allSales.map((s, i) => (
                    <tr key={`${s.saleItemId}-${i}`}>
                      <td>
                        {s.customerId ? (
                          <><Phone size={11} style={{ verticalAlign: '-1px', marginRight: 4, color: 'var(--odoo-green, #16a34a)' }} />{s.customerName || 'Client'}</>
                        ) : (
                          <span style={{ color: 'var(--odoo-text-muted)' }}>Anonyme (walk-in)</span>
                        )}
                      </td>
                      <td>{s.customerPhone || '—'}</td>
                      <td>{s.productName}</td>
                      <td style={{ fontFamily: 'monospace' }}>{s.lotNumber}</td>
                      <td>{fmtDateTime(s.createdAt)}</td>
                      <td>{n2(s.quantity)}</td>
                      <td>{s.storeName || '—'}</td>
                      <td>{s.cashierName || '—'}</td>
                      <td>
                        {s.approximate
                          ? <span className="odoo-tag odoo-tag-orange">Approximatif</span>
                          : <span className="odoo-tag odoo-tag-green">Tracé</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', marginTop: 8 }}>
            Généré le {fmtDateTime(recall.generatedAt)}.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="odoo-stat-card">
      <div className="odoo-stat-card-value">{value}</div>
      <div className="odoo-stat-card-label">{label}</div>
      {sub && <div className="odoo-stat-card-sub">{sub}</div>}
    </div>
  );
}

/** Rendu récursif d'un nœud (lot matière → plans → fournées → ventes), recyclage inclus. */
function RecallNodeView({ node, depth }: { node: RecallNode; depth: number }) {
  const lot = node.ingredientLot;
  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0, borderLeft: depth > 0 ? '2px solid var(--odoo-purple, #7c3aed)' : undefined, paddingLeft: depth > 0 ? 12 : 0, marginTop: depth > 0 ? 10 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {node.recycled && <span className="odoo-tag odoo-tag-purple"><Recycle size={11} style={{ verticalAlign: '-1px' }} /> Recyclé</span>}
        <Package size={14} style={{ color: 'var(--theme-accent)' }} />
        <strong style={{ fontFamily: 'monospace' }}>{lot.lotNumber}</strong>
        <span>{lot.ingredientName || '—'}</span>
        {lot.supplierName && <span style={{ color: 'var(--odoo-text-muted)' }}>· {lot.supplierName}{lot.supplierLotNumber ? ` (${lot.supplierLotNumber})` : ''}</span>}
        <span style={{ color: 'var(--odoo-text-muted)' }}>· DLC {fmtDate(lot.expirationDate)}</span>
      </div>

      {node.plans.length === 0 ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.85rem', margin: '4px 0 8px' }}>
          Aucun plan de production rattaché à ce lot.
        </p>
      ) : (
        node.plans.map(plan => (
          <div key={plan.productionPlanId} style={{ margin: '8px 0 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', marginBottom: 4 }}>
              <Factory size={13} style={{ color: 'var(--odoo-text-muted)' }} />
              Plan du {fmtDate(plan.planDate)}
              {plan.planStatus && <span className="odoo-tag odoo-tag-grey">{plan.planStatus}</span>}
              <span style={{ color: 'var(--odoo-text-muted)' }}>· {n2(plan.quantityUsed)} utilisé(s)</span>
            </div>
            {plan.batches.length === 0 ? (
              <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8rem', marginLeft: 20 }}>Aucune fournée enregistrée.</p>
            ) : (
              <table className="odoo-table" style={{ marginLeft: 20, width: 'calc(100% - 20px)' }}>
                <thead>
                  <tr>
                    <th>Fournée</th><th>Produit</th><th>Produit le</th><th>DLC</th>
                    <th>Vendu</th><th>En stock</th><th>Jeté</th><th>Recyclé</th><th>Ventes rattachées</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.batches.map(b => (
                    <tr key={b.productLotId}>
                      <td style={{ fontFamily: 'monospace' }}>{b.lotNumber}</td>
                      <td>{b.productName}</td>
                      <td>{fmtDate(b.producedAt)}</td>
                      <td>{fmtDate(b.expiresAt)}</td>
                      <td>{n2(b.states.sold)}</td>
                      <td>{n2(b.states.backroom + b.states.vitrine)}</td>
                      <td>{b.states.wasted > 0 ? <span className="odoo-tag odoo-tag-red">{n2(b.states.wasted)}</span> : '0'}</td>
                      <td>{b.states.recycled > 0 ? <span className="odoo-tag odoo-tag-purple">{n2(b.states.recycled)}</span> : '0'}</td>
                      <td>
                        {b.sales.length > 0 && <span className="odoo-tag odoo-tag-green" style={{ marginRight: 4 }}>{b.sales.length} tracée(s)</span>}
                        {b.approximateSales.length > 0 && <span className="odoo-tag odoo-tag-orange">{b.approximateSales.length} approx.</span>}
                        {b.sales.length === 0 && b.approximateSales.length === 0 && '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Chaînes de recyclage issues des fournées de ce plan */}
            {plan.batches.flatMap(b => b.recycledInto).map(child => (
              <RecallNodeView key={child.ingredientLot.id} node={child} depth={depth + 1} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
