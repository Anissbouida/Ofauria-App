import { useState, useMemo, useRef, useEffect } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productLossesApi } from '../../api/product-losses.api';
import { productsApi } from '../../api/products.api';
import { serverUrl } from '../../api/client';
import { useReferentiel } from '../../hooks/useReferentiel';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, X, Search, Flame, Package, Clock, Trash2, TrendingDown, Factory, ShoppingBag, Recycle, Download, Camera,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { StagePipeline, PAGE_SIZE } from '../../components/purchasing/ProcessBoard';
import { money, currencySymbol } from '../../utils/money';
import { DataPanel, TableFooter, Toolbar, SearchBar, LoadingState, EmptyState, ErrorState, NoResultState, HeaderActions, MonthYearField, Modal, FormSection, FormField, FormFooter } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const MONTH_NAMES = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

// Fallback styling per loss type (icon/gradient can't come from DB)
const LOSS_TYPE_STYLE: Record<string, { color: string; bg: string; gradient: string; icon: typeof Flame }> = {
  production: { color: 'text-orange-700', bg: 'bg-orange-100', gradient: 'from-orange-500 to-amber-500', icon: Factory },
  vitrine: { color: 'text-red-700', bg: 'bg-red-100', gradient: 'from-red-500 to-rose-500', icon: Package },
  perime: { color: 'text-purple-700', bg: 'bg-purple-100', gradient: 'from-purple-500 to-violet-500', icon: Clock },
  recyclage: { color: 'text-emerald-700', bg: 'bg-emerald-100', gradient: 'from-emerald-500 to-green-500', icon: Recycle },
};
const DEFAULT_LOSS_STYLE = { color: 'text-gray-700', bg: 'bg-gray-100', gradient: 'from-gray-500 to-gray-400', icon: Package };

// Couleur du point de type (même palette que les anciennes pastilles).
const TYPE_DOT: Record<string, string> = {
  'odoo-tag-red': 'var(--ds-danger)', 'odoo-tag-orange': 'var(--ds-warning)', 'odoo-tag-yellow': 'var(--ds-warning)', 'odoo-tag-blue': 'var(--ds-info)', 'odoo-tag-grey': 'var(--ds-muted)',
};

/** Référentiels des pertes (types, motifs) : partagés par l'onglet Pertes et le module Contrôle. */
export function useLossReferentials() {
  // Dynamic referentiel data
  const { entries: lossTypeEntries, getLabel: getLossTypeLabel } = useReferentiel('loss_types');
  const { entries: lossReasonEntries, getLabel: getLossReasonLabel } = useReferentiel('loss_reasons');
  const { entries: prodLossReasons, getLabel: getProdLossReasonLabel } = useReferentiel('production_loss_reasons');

  // Build LOSS_TYPE_CONFIG dynamically from referentiel + fallback styling
  const LOSS_TYPE_CONFIG = Object.fromEntries(
    lossTypeEntries.map(e => [e.code, { label: e.label, ...(LOSS_TYPE_STYLE[e.code] || DEFAULT_LOSS_STYLE) }])
  );
  // Build combined reason labels from both referentiel tables
  const REASON_LABELS: Record<string, string> = Object.fromEntries([
    ...lossReasonEntries.map(e => [e.code, e.label]),
    ...prodLossReasons.map(e => [e.code, e.label]),
  ]);
  // Reasons by type: production uses production_loss_reasons, others use loss_reasons
  const REASONS_BY_TYPE: Record<string, string[]> = Object.fromEntries(
    lossTypeEntries.map(e => [
      e.code,
      e.code === 'production'
        ? prodLossReasons.map(r => r.code)
        : lossReasonEntries.map(r => r.code),
    ])
  );

  return { LOSS_TYPE_CONFIG, REASON_LABELS, REASONS_BY_TYPE, getLossTypeLabel, getLossReasonLabel, getProdLossReasonLabel };
}

export default function LossesTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<{ url: string; productName: string; date: string } | null>(null);

  const { LOSS_TYPE_CONFIG, REASON_LABELS, REASONS_BY_TYPE } = useLossReferentials();

  const { data: losses = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['product-losses', month, year, typeFilter],
    queryFn: () => {
      const params: Record<string, string> = { month: String(month), year: String(year) };
      if (typeFilter !== 'all') params.lossType = typeFilter;
      return productLossesApi.list(params);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['product-losses-stats', month, year],
    queryFn: () => productLossesApi.stats(month, year),
  });

  const deleteMutation = useMutation({
    mutationFn: productLossesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-losses'] });
      queryClient.invalidateQueries({ queryKey: ['product-losses-stats'] });
      notify.success('Perte supprimee');
    },
  });

  const allLosses = losses as Record<string, any>[];
  const lossList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allLosses.filter(l => [l.product_name, l.reason_note, l.declared_by_first_name, l.declared_by_last_name]
      .some(v => String(v ?? '').toLowerCase().includes(q))) : allLosses;
  }, [allLosses, search]);
  useEffect(() => { setPage(1); }, [month, year, typeFilter, search]);
  const pagedLosses = lossList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Totals from stats
  const totalsByType = useMemo(() => {
    const map: Record<string, { count: number; quantity: number; cost: number }> = {};
    let totalCost = 0;
    let totalQty = 0;
    let totalCount = 0;
    if (stats?.byType) {
      for (const row of stats.byType as Record<string, any>[]) {
        const t = row.loss_type as string;
        const cost = parseFloat(row.total_cost as string) || 0;
        const qty = parseFloat(row.total_quantity as string) || 0;
        const count = parseInt(row.count as string) || 0;
        map[t] = { count, quantity: qty, cost };
        totalCost += cost;
        totalQty += qty;
        totalCount += count;
      }
    }
    return { map, totalCost, totalQty, totalCount };
  }, [stats]);

  const handleExport = () => {
    const rows = lossList.map(l => [
      format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm'),
      l.product_name as string,
      LOSS_TYPE_CONFIG[l.loss_type as string]?.label || l.loss_type,
      REASON_LABELS[l.reason as string] || l.reason,
      String(l.quantity),
      n(parseFloat(l.total_cost as string) || 0),
      (l.declared_by_first_name || '') + ' ' + (l.declared_by_last_name || ''),
      l.reason_note as string || '',
    ]);
    const BOM = '\uFEFF';
    const csv = BOM + [
      `DATE;PRODUIT;TYPE;MOTIF;QUANTITE;COUT (${currencySymbol()});DECLARE PAR;NOTE`,
      ...rows.map(r => r.join(';'))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pertes_${MONTH_NAMES[month - 1]}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Search panel : period + actions */}
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary">
          <Download size={13} /> Exporter
        </button>
        <button type="button" onClick={() => setShowForm(true)} className="odoo-btn-primary">
          <Plus size={14} /> Déclarer une perte
        </button>
      </HeaderActions>

      {/* Répartition par type : une carte par type (clic = filtre) */}
      <StagePipeline
        title={`Pertes · ${MONTH_NAMES[month - 1]} ${year}`}
        summary={`${totalsByType.totalCount} déclaration${totalsByType.totalCount > 1 ? 's' : ''} · ${money(totalsByType.totalCost)}`}
        stages={[
          { key: 'all', label: 'Toutes', hint: 'total du mois', icon: TrendingDown },
          ...Object.entries(LOSS_TYPE_CONFIG).map(([key, cfg]) => ({ key, label: cfg.label, hint: `${totalsByType.map[key]?.quantity ?? 0} unités`, icon: cfg.icon })),
        ]}
        stats={{
          all: { count: totalsByType.totalCount, sub: `${money(totalsByType.totalCost)}` },
          ...Object.fromEntries(Object.keys(LOSS_TYPE_CONFIG).map(key => [key, { count: totalsByType.map[key]?.count ?? 0, sub: `${money(totalsByType.map[key]?.cost ?? 0)}` }])),
        }}
        isActive={k => typeFilter === k}
        onPick={k => setTypeFilter(k === typeFilter && k !== 'all' ? 'all' : k)}
      />

      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un produit, une note, un déclarant…" label="Rechercher une perte" />
        <MonthYearField month={month} year={year} onMonth={setMonth} onYear={setYear} />
      </Toolbar>

      {/* Losses table */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : lossList.length === 0 ? (
        search || typeFilter !== 'all'
          ? <NoResultState text="Aucune perte ne correspond aux filtres." onReset={() => { setSearch(''); setTypeFilter('all'); }} />
          : <EmptyState icon={TrendingDown} title="Aucune perte déclarée sur la période" text="Les pertes déclarées (casse, périmé, invendu) apparaissent ici, valorisées au coût de revient." />
      ) : (
        <DataPanel label="Pertes déclarées" footer={
          <TableFooter page={page} pageSize={PAGE_SIZE} total={lossList.length} onPage={setPage} note={`${MONTH_NAMES[month - 1]} ${year}`} />
        }>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Date</th>
                <th>Produit</th>
                <th>Type</th>
                <th>Motif</th>
                <th className="ds-num">Quantité</th>
                <th className="ds-num">Coût ({currencySymbol()})</th>
                <th>Déclaré par</th>
                <th className="ds-actions" style={{ width: 90 }}><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pagedLosses.map(l => {
                const lossType = l.loss_type as string;
                const tagClass = lossType === 'casse' ? 'odoo-tag-red'
                  : lossType === 'perimee' ? 'odoo-tag-orange'
                  : lossType === 'invendu' ? 'odoo-tag-yellow'
                  : lossType === 'erreur' ? 'odoo-tag-blue'
                  : 'odoo-tag-grey';
                const cfg = LOSS_TYPE_CONFIG[lossType] || LOSS_TYPE_CONFIG.casse;
                return (
                  <tr key={l.id as string}>
                    <td>
                      {format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td className="ds-strong">{l.product_name as string}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: TYPE_DOT[tagClass] ?? 'var(--ds-muted)' }} />
                        {cfg.label}
                      </span>
                    </td>
                    <td style={{ color: 'var(--ds-muted)' }}>
                      {REASON_LABELS[l.reason as string] || String(l.reason)}
                      {l.reason_note ? <span style={{ marginLeft: 4 }}>— {String(l.reason_note)}</span> : null}
                    </td>
                    <td className="ds-num">{parseFloat(l.quantity as string)}</td>
                    <td className="ds-num ds-strong">{n(parseFloat(l.total_cost as string) || 0)}</td>
                    <td style={{ color: 'var(--ds-muted)' }}>
                      {l.declared_by_first_name ? `${l.declared_by_first_name} ${l.declared_by_last_name}` : '—'}
                    </td>
                    <td className="ds-actions">
                      {l.photo_url && (
                        <button type="button" onClick={() => setViewPhoto({
                          url: serverUrl(l.photo_url as string),
                          productName: l.product_name as string,
                          date: format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm'),
                        })}
                          className="ds-icon-btn" title="Voir la photo" aria-label={`Voir la photo de la perte ${l.product_name}`}>
                          <Camera size={15} />
                        </button>
                      )}
                      <RowMenu items={[{ label: 'Supprimer la perte', icon: Trash2, danger: true, onSelect: async () => {
                        if (await confirm(`Supprimer la perte « ${l.product_name} » (${money(parseFloat(l.total_cost as string) || 0)}) ?`, { title: 'Supprimer la perte', danger: true, confirmLabel: 'Supprimer' })) deleteMutation.mutate(l.id as string);
                      } }]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lossList.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4}>Total ({lossList.length} perte{lossList.length > 1 ? 's' : ''})</td>
                  <td className="ds-num">{lossList.reduce((s, l) => s + parseFloat(l.quantity as string), 0)}</td>
                  <td className="ds-num">{n(lossList.reduce((s, l) => s + (parseFloat(l.total_cost as string) || 0), 0))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </DataPanel>
      )}

      {/* Photo viewer overlay */}
      {viewPhoto && (
        <Modal title={viewPhoto.productName} subtitle={`Photo prise le ${viewPhoto.date}`} onClose={() => setViewPhoto(null)} width={720}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ds-bg)', borderRadius: 8, padding: 16 }}>
            <img src={viewPhoto.url} alt={`Photo de ${viewPhoto.productName}`} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8 }} />
          </div>
        </Modal>
      )}

      {/* Add loss modal */}
      {showForm && (
        <AddLossModal
          lossTypeConfig={LOSS_TYPE_CONFIG}
          reasonLabels={REASON_LABELS}
          reasonsByType={REASONS_BY_TYPE}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['product-losses'] });
            queryClient.invalidateQueries({ queryKey: ['product-losses-stats'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setShowForm(false);
          }}
        />
      )}
    </>
  );
}

/* ═══════════════════════ ADD LOSS MODAL ═══════════════════════ */
function AddLossModal({ onClose, onSuccess, lossTypeConfig: LOSS_TYPE_CONFIG, reasonLabels: REASON_LABELS, reasonsByType: REASONS_BY_TYPE }: {
  onClose: () => void;
  onSuccess: () => void;
  lossTypeConfig: Record<string, { label: string; color: string; bg: string; gradient: string; icon: typeof Flame }>;
  reasonLabels: Record<string, string>;
  reasonsByType: Record<string, string[]>;
}) {
  const [lossType, setLossType] = useState('');
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [quantity, setQuantity] = useState('');
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: productsData } = useQuery({
    queryKey: ['products', { limit: '500' }],
    queryFn: () => productsApi.list({ limit: '500' }),
  });

  const products = (productsData?.data || []) as Record<string, any>[];

  const selectedProduct = productId ? products.find(p => p.id === productId) : null;

  const normalizeStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filteredProducts = products.filter(p => {
    if (!productSearch.trim()) return true;
    const q = normalizeStr(productSearch);
    const name = normalizeStr(p.name as string);
    return q.split(/\s+/).filter(Boolean).every(w => name.includes(w));
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const createMutation = useMutation({
    mutationFn: productLossesApi.create,
    onSuccess: () => {
      notify.success('Perte declaree avec succes');
      onSuccess();
    },
    onError: () => notify.error('Erreur lors de la declaration'),
  });

  // Mêmes contrôles qu'avant, dans le même ordre ; le message s'affiche sous le champ concerné.
  const [errors, setErrors] = useState<Partial<Record<'product' | 'type' | 'reason' | 'quantity', string>>>({});
  const handleSubmit = () => {
    if (!productId) { setErrors({ product: 'Sélectionnez un produit.' }); return; }
    if (!lossType) { setErrors({ type: 'Sélectionnez un type de perte.' }); return; }
    if (!reason) { setErrors({ reason: 'Sélectionnez un motif.' }); return; }
    if (!quantity || parseFloat(quantity) <= 0) { setErrors({ quantity: 'La quantité doit être supérieure à 0.' }); return; }
    setErrors({});
    createMutation.mutate({
      productId, quantity: parseFloat(quantity), lossType, reason,
      reasonNote: reasonNote || undefined,
    });
  };

  const availableReasons = lossType ? REASONS_BY_TYPE[lossType] || [] : [];

  return (
    <Modal title="Déclarer une perte" subtitle="Production, casse ou périmé" label="Déclarer une perte" onClose={onClose} width={560} locked={createMutation.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={handleSubmit} busy={createMutation.isPending} submitLabel="Déclarer la perte" />}>
      <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <FormSection title="Perte">
          <FormField label="Type de perte" required error={errors.type}>
            <div role="group" aria-label="Type de perte" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {Object.entries(LOSS_TYPE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const isSelected = lossType === key;
                return (
                  <button type="button" key={key} onClick={() => { setLossType(key); setReason(''); }} aria-pressed={isSelected}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', textAlign: 'left', borderRadius: 8, minHeight: 40,
                      border: `1px solid ${isSelected ? 'var(--ds-accent)' : 'var(--ds-line)'}`,
                      background: isSelected ? 'var(--ds-tint)' : 'var(--ds-card)',
                      color: isSelected ? 'var(--ds-accent-ink)' : 'var(--ds-ink)', fontWeight: isSelected ? 600 : 500, fontSize: 13,
                    }}>
                    <Icon size={16} aria-hidden="true" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </FormField>

          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <FormField label="Produit" htmlFor="loss-product" required error={errors.product}>
              <div style={{ position: 'relative' }}>
                <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ds-muted)' }} />
                <input id="loss-product" ref={searchRef} type="text" className="ds-input"
                  style={{ paddingLeft: 34, paddingRight: 34, fontWeight: selectedProduct ? 600 : undefined }}
                  placeholder="Rechercher un produit..."
                  value={dropdownOpen ? productSearch : (selectedProduct ? selectedProduct.name as string : productSearch)}
                  onChange={(e) => { setProductSearch(e.target.value); setDropdownOpen(true); if (productId) setProductId(''); }}
                  onFocus={() => { setDropdownOpen(true); if (selectedProduct) setProductSearch(''); }}
                  autoComplete="off" />
                {(selectedProduct || productSearch) && (
                  <button type="button" onClick={() => { setProductId(''); setProductSearch(''); searchRef.current?.focus(); }}
                    className="ds-icon-btn" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }} aria-label="Effacer le produit">
                    <X size={14} />
                  </button>
                )}
              </div>
            </FormField>
            {dropdownOpen && (
              <div role="listbox" aria-label="Produits" style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, marginTop: 4, background: 'var(--ds-card)', border: '1px solid var(--ds-line)', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.12)', maxHeight: 192, overflowY: 'auto' }}>
                {filteredProducts.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--ds-muted)' }}>Aucun produit trouvé</div>
                ) : (
                  filteredProducts.slice(0, 15).map(p => (
                    <button type="button" key={p.id as string} role="option" aria-selected={productId === p.id}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 0, cursor: 'pointer' }}
                      onClick={() => { setProductId(p.id as string); setProductSearch(''); setDropdownOpen(false); }}>
                      {p.image_url ? (
                        <img src={serverUrl(p.image_url as string)} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                      ) : (
                        <span style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--ds-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ShoppingBag size={12} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ds-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name as string}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)' }}>{p.category_name as string || ''}</span>
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{parseFloat(p.price as string || '0').toFixed(2)} {currencySymbol()}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {lossType && (
            <FormField label="Motif" htmlFor="loss-reason" required error={errors.reason}>
              <select id="loss-reason" className="ds-input" value={reason} onChange={e => setReason(e.target.value)} required>
                <option value="">-- Choisir un motif --</option>
                {availableReasons.map(r => (
                  <option key={r} value={r}>{REASON_LABELS[r]}</option>
                ))}
              </select>
            </FormField>
          )}

          <FormField label="Quantité perdue" htmlFor="loss-qty" required error={errors.quantity}>
            <input id="loss-qty" className="ds-input" type="number" min="0.01" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)} required placeholder="Ex: 5" />
          </FormField>

          <FormField label="Note" htmlFor="loss-note">
            <textarea id="loss-note" className="ds-input" value={reasonNote} onChange={e => setReasonNote(e.target.value)} rows={2} placeholder="Détails supplémentaires..." />
          </FormField>
        </FormSection>

        {selectedProduct && quantity && parseFloat(quantity) > 0 && (
          <div className="ds-alert danger" role="status" style={{ justifyContent: 'space-between' }}>
            <span>Coût estimé de la perte</span>
            <strong style={{ fontSize: 16 }}>
              {money((parseFloat(selectedProduct.cost_price as string) || parseFloat(selectedProduct.price as string) || 0) * parseFloat(quantity))}
            </strong>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Déclaration d'une perte de produit fini, utilisable hors de l'onglet Pertes (module Contrôle). */
export function ProductLossDeclareModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { LOSS_TYPE_CONFIG, REASON_LABELS, REASONS_BY_TYPE } = useLossReferentials();
  return (
    <AddLossModal lossTypeConfig={LOSS_TYPE_CONFIG} reasonLabels={REASON_LABELS} reasonsByType={REASONS_BY_TYPE}
      onClose={onClose} onSuccess={onSuccess} />
  );
}
