import { useState, useMemo, useEffect, useRef } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, AlertTriangle, X, TrendingUp, TrendingDown, Package, Recycle, ArrowLeftRight, Boxes } from 'lucide-react';
import { packagingApi } from '../../api/packaging.api';
import { expenseCategoriesApi } from '../../api/accounting.api';
import CategoryCascadeSelector, { CONSUMABLE_ROOT_IDS } from '../../components/CategoryCascadeSelector';
import { notify } from '../../components/ui/InlineNotification';
import { PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';
import { ListToolbar, FilterChips } from '../sales/ListTemplate';
import { ChipsRow, PagerFoot, HeaderActions } from '../stock/StockUi';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { currencySymbol } from '../../utils/money';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, EmptyState, FormField, FormFooter, LoadingState, Modal, NoResultState } from '../../components/ds';

/** Situation d'un consommable (exclusive) : mêmes cartes que le stock des ingrédients. */
const PKG_SITUATIONS: StageDef[] = [
  { key: 'rupture', label: 'Rupture', hint: 'plus en stock', icon: AlertTriangle },
  { key: 'low', label: 'Sous le seuil', hint: 'à réapprovisionner', icon: TrendingDown },
  { key: 'ok', label: 'OK', hint: 'rien à faire', icon: TrendingUp },
];
const PKG_DOT: Record<string, string> = { rupture: 'var(--ds-danger)', low: 'var(--ds-warning)', ok: 'var(--ds-success)' };

interface PackagingItem {
  id: string;
  name: string;
  format: string | null;
  unit: string;
  unit_cost: string | number;
  supplier: string | null;
  category: string;
  category_id: string | null;
  category_name?: string | null;
  is_recyclable: boolean;
  is_compostable: boolean;
  is_food_safe: boolean;
  is_active: boolean;
  notes: string | null;
  stock_quantity?: string | number;
  stock_min_threshold?: string | number;
}

/** Construit les options de filtre (feuilles du référentiel) groupées par racine
 *  consommable. Une feuille = catégorie sans enfant. */
function useConsumableLeafOptions() {
  const { data: cats = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => expenseCategoriesApi.list(),
  });
  return useMemo(() => {
    const all = cats as Record<string, any>[];
    const hasChild = new Set(all.map(c => String(c.parent_id)).filter(Boolean));
    const rootOf = (c: Record<string, any>): string | null => {
      let cur: Record<string, any> | undefined = c;
      while (cur && cur.parent_id) cur = all.find(x => String(x.id) === String(cur!.parent_id));
      return cur ? String(cur.id) : null;
    };
    const rootName = (id: string) => all.find(c => String(c.id) === id)?.name as string | undefined;
    const groups = CONSUMABLE_ROOT_IDS.map(rid => ({
      rootId: rid,
      label: rootName(rid) || '',
      leaves: all
        .filter(c => !hasChild.has(String(c.id)) && rootOf(c) === rid)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    })).filter(g => g.leaves.length > 0);
    return groups;
  }, [cats]);
}

export default function PackagingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [categoryIdFilter, setCategoryIdFilter] = useState<string>('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'ok' | 'rupture'>('all');
  const [editingItem, setEditingItem] = useState<PackagingItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [stockDialog, setStockDialog] = useState<PackagingItem | null>(null);

  const leafGroups = useConsumableLeafOptions();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['packaging-items', search, categoryIdFilter],
    queryFn: () => packagingApi.list({
      search: search || undefined,
      categoryId: categoryIdFilter || undefined,
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packagingApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packaging-items'] });
      notify.success('Consommable supprimé');
    },
    onError: () => notify.error('Erreur lors de la suppression'),
  });

  const stockState = (it: PackagingItem) => {
    const stock = parseFloat(String(it.stock_quantity || 0));
    const threshold = parseFloat(String(it.stock_min_threshold || 0));
    const isRupture = stock <= 0;
    const isLow = !isRupture && threshold > 0 && stock <= threshold;
    return { stock, isRupture, isLow };
  };
  const totalItems = items.length;
  const lowCount = items.filter((it: PackagingItem) => stockState(it).isLow).length;
  const ruptureCount = items.filter((it: PackagingItem) => stockState(it).isRupture).length;

  const filtered = items.filter((it: PackagingItem) => {
    const { isRupture, isLow } = stockState(it);
    if (stockFilter === 'low') return isLow;
    if (stockFilter === 'rupture') return isRupture;
    if (stockFilter === 'ok') return !isRupture && !isLow;
    return true;
  });

  const hasActiveFilters = !!search || !!categoryIdFilter || stockFilter !== 'all';
  const resetFilters = () => { setSearchInput(''); setSearch(''); setCategoryIdFilter(''); setStockFilter('all'); };
  useEffect(() => { setPage(1); }, [search, categoryIdFilter, stockFilter]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const situationOf = (it: PackagingItem) => { const st = stockState(it); return st.isRupture ? 'rupture' : st.isLow ? 'low' : 'ok'; };

  return (
    <div className={embedded ? 'stk-stack' : 'odoo-scope stk-stack'}>
      {!embedded && (
        <div className="odoo-breadcrumb">
          <Package size={14} style={{ color: 'var(--ds-accent)' }} aria-hidden="true" />
          <span>Stock</span>
          <span className="odoo-breadcrumb-separator" aria-hidden="true">›</span>
          <span>Opérations</span>
          <span className="odoo-breadcrumb-separator" aria-hidden="true">›</span>
          <span className="odoo-breadcrumb-current">Consommables</span>
        </div>
      )}

      <HeaderActions>
        <button type="button" onClick={() => setShowCreate(true)} className="odoo-btn-primary">
          <Plus size={14} aria-hidden="true" /> Nouveau consommable
        </button>
      </HeaderActions>

      {/* ══════ SITUATION : une pastille par situation, clic = filtre ══════ */}
      <ChipsRow summary={`${totalItems} article${totalItems > 1 ? 's' : ''} · ${lowCount + ruptureCount} à réapprovisionner`}>
        <FilterChips label="Où en sont mes consommables" value={stockFilter === 'all' ? '' : stockFilter}
          onChange={k => setStockFilter((k || 'all') as 'all' | 'low' | 'ok' | 'rupture')}
          chips={[
            { key: '', label: 'Tous', count: totalItems },
            { key: 'rupture', label: 'Rupture', count: ruptureCount, icon: AlertTriangle, tone: ruptureCount > 0 ? 'late' : undefined },
            { key: 'low', label: 'Sous le seuil', count: lowCount, icon: TrendingDown },
            { key: 'ok', label: 'OK', count: totalItems - lowCount - ruptureCount, icon: TrendingUp },
          ]} />
      </ChipsRow>

      {/* ══════ BARRE D'OUTILS : recherche, catégorie, nouveau ══════ */}
      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="Rechercher un consommable…">
        <SearchSelect
          options={leafGroups.flatMap(g => g.leaves.map(leaf => ({ id: String(leaf.id), label: String(leaf.name), sublabel: g.label })))}
          value={categoryIdFilter}
          onChange={setCategoryIdFilter}
          placeholder="Catégorie"
        />
        {hasActiveFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={13} /> Réinitialiser
          </button>
        )}
      </ListToolbar>

      {/* ══════ TABLE ══════ */}
      {isLoading ? (
        <LoadingState label="Chargement des consommables…" />
      ) : filtered.length === 0 ? (
        hasActiveFilters
          ? <NoResultState text="Aucun consommable ne correspond aux filtres." onReset={resetFilters} />
          : <EmptyState icon={Boxes} title="Aucun consommable" text="Emballages, produits d'entretien et fournitures apparaîtront ici avec leur stock."
              action={<button type="button" className="odoo-btn-primary" onClick={() => setShowCreate(true)}><Plus size={13} aria-hidden="true" /> Nouveau consommable</button>} />
      ) : (
      <DataPanel footer={<PagerFoot page={page} total={filtered.length} onPage={setPage}
          note={`${filtered.length} consommable${filtered.length > 1 ? 's' : ''}${hasActiveFilters ? ' (filtré)' : ''} sur ${totalItems}`} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Article</th>
              <th className="hidden sm:table-cell">Catégorie</th>
              <th className="hidden md:table-cell">Format</th>
              <th className="hidden md:table-cell ds-num">Dernier prix</th>
              <th className="ds-num">Stock</th>
              <th className="hidden lg:table-cell">Fournisseur</th>
              <th className="ds-actions">Prochaine action</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((it: PackagingItem) => {
              const { stock, isRupture, isLow } = stockState(it);
              return (
                <tr key={it.id}>
                  <td>
                    <div className="ds-strong" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {it.name}
                      {it.is_recyclable && <Recycle size={12} style={{ color: 'var(--ds-success)' }} aria-label="Recyclable" />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '12px', color: 'var(--ds-muted)', marginTop: 1 }}>
                      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: PKG_DOT[situationOf(it)] }} />
                      {PKG_SITUATIONS.find(x => x.key === situationOf(it))?.label}
                    </div>
                    {it.notes && <div style={{ fontSize: '12px', color: 'var(--ds-muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.notes}</div>}
                  </td>
                  <td className="hidden sm:table-cell">
                    {it.category_name
                      ? <span className="odoo-tag odoo-tag-grey">{it.category_name}</span>
                      : <span style={{ color: 'var(--ds-sep)', fontSize: '12px' }}>—</span>}
                  </td>
                  <td className="hidden md:table-cell" style={{ color: 'var(--ds-muted)' }}>{it.format || '—'}</td>
                  <td className="hidden md:table-cell ds-num">
                    {parseFloat(String(it.unit_cost)).toFixed(2)} <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{currencySymbol()}/{it.unit}</span>
                  </td>
                  <td className="ds-num">
                    <button type="button" onClick={() => setStockDialog(it)} title="Enregistrer un mouvement de stock"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 700,
                        color: isRupture ? 'var(--ds-danger)' : isLow ? 'var(--ds-warning)' : 'var(--ds-ink)' }}>
                      {stock.toFixed(0)} <span style={{ color: 'var(--ds-muted)', fontWeight: 400, fontSize: '12px' }}>{it.unit}</span>
                    </button>
                    {parseFloat(String(it.stock_min_threshold || 0)) > 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>seuil {parseFloat(String(it.stock_min_threshold)).toFixed(0)}</div>
                    )}
                  </td>
                  <td className="hidden lg:table-cell" style={{ color: 'var(--ds-muted)' }}>{it.supplier || '—'}</td>
                  <td className="ds-actions">
                    {(isRupture || isLow) ? (
                      <button type="button" onClick={() => setStockDialog(it)} className={`${isRupture ? 'ds-btn-danger' : 'odoo-btn-primary'} ds-btn-sm`}
                        title="Enregistrer une entrée de stock">
                        Réapprovisionner
                      </button>
                    ) : (
                      <button type="button" onClick={() => setStockDialog(it)} className="odoo-btn-secondary ds-btn-sm">
                        <ArrowLeftRight size={12} aria-hidden="true" /> Mouvement
                      </button>
                    )}
                    <RowMenu items={[
                      { label: 'Mouvement de stock', icon: ArrowLeftRight, onSelect: () => setStockDialog(it) },
                      { label: 'Modifier', icon: Pencil, onSelect: () => setEditingItem(it) },
                      { label: 'Supprimer', icon: Trash2, danger: true, onSelect: async () => {
                        if (await confirm(`Supprimer le consommable « ${it.name} » ?`, { title: 'Supprimer le consommable', confirmLabel: 'Supprimer', danger: true })) deleteMutation.mutate(it.id);
                      } },
                    ]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataPanel>
      )}

      {/* Modal create/edit */}
      {(showCreate || editingItem) && (
        <PackagingFormModal
          item={editingItem}
          onClose={() => { setShowCreate(false); setEditingItem(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['packaging-items'] });
            setShowCreate(false); setEditingItem(null);
          }}
        />
      )}

      {/* Modal mouvement stock */}
      {stockDialog && (
        <StockAdjustModal
          item={stockDialog}
          onClose={() => setStockDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['packaging-items'] });
            setStockDialog(null);
          }}
        />
      )}
    </div>
  );
}

function PackagingFormModal({ item, onClose, onSaved }: { item: PackagingItem | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: item?.name || '',
    format: item?.format || '',
    unit: item?.unit || 'piece',
    unit_cost: String(item?.unit_cost || ''),
    supplier: item?.supplier || '',
    category_id: item?.category_id || '',
    is_recyclable: item?.is_recyclable ?? false,
    is_compostable: item?.is_compostable ?? false,
    is_food_safe: item?.is_food_safe ?? true,
    notes: item?.notes || '',
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) => isEdit
      ? packagingApi.update(item!.id, data)
      : packagingApi.create(data),
    onSuccess: () => {
      notify.success(isEdit ? 'Consommable mis à jour' : 'Consommable créé');
      onSaved();
    },
    onError: () => notify.error('Erreur lors de la sauvegarde'),
  });

  const formRef = useRef<HTMLFormElement>(null);
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...form,
      unit_cost: parseFloat(form.unit_cost) || 0,
    });
  };

  return (
    <Modal title={isEdit ? `Modifier ${item?.name}` : 'Nouveau consommable'} label={isEdit ? 'Modifier le consommable' : 'Nouveau consommable'}
      onClose={onClose} locked={saveMutation.isPending} width={576}
      footer={<FormFooter onCancel={onClose} busy={saveMutation.isPending} onSubmit={() => formRef.current?.requestSubmit()}
        submitLabel={saveMutation.isPending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer le consommable'} />}>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <FormField label="Nom" htmlFor="pkg-f1" required>
            <input id="pkg-f1" type="text" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Caissette alvéolée brownie"
              className="ds-input" />
          </FormField>

          <FormField label="Catégorie" required>
            <CategoryCascadeSelector
              value={form.category_id}
              onChange={(cid) => setForm({ ...form, category_id: cid })}
              rootIds={CONSUMABLE_ROOT_IDS}
              type="expense"
              required
            />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Format" htmlFor="pkg-f2">
              <input id="pkg-f2" type="text" value={form.format}
                onChange={(e) => setForm({ ...form, format: e.target.value })}
                placeholder="24cm rond..."
                className="ds-input" />
            </FormField>
            <FormField label="Unité" htmlFor="pkg-f3">
              <select id="pkg-f3" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="ds-input">
                <option value="piece">pièce (unité)</option>
                <option value="m">m (mètre)</option>
                <option value="kg">kg</option>
              </select>
            </FormField>
            <FormField label={<>Coût unitaire ({currencySymbol()})</>} htmlFor="pkg-f4" required>
              <input id="pkg-f4" type="number" step="0.01" min="0" required value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                placeholder="0.30"
                className="ds-input" />
            </FormField>
          </div>

          <FormField label="Fournisseur" htmlFor="pkg-f5">
            <input id="pkg-f5" type="text" value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              placeholder="Nom du fournisseur"
              className="ds-input" />
          </FormField>

          <div className="grid grid-cols-3 gap-2 pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={form.is_recyclable}
                onChange={(e) => setForm({ ...form, is_recyclable: e.target.checked })} />
              Recyclable
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={form.is_compostable}
                onChange={(e) => setForm({ ...form, is_compostable: e.target.checked })} />
              Compostable
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={form.is_food_safe}
                onChange={(e) => setForm({ ...form, is_food_safe: e.target.checked })} />
              Food safe
            </label>
          </div>

          <FormField label="Notes" htmlFor="pkg-f6">
            <textarea id="pkg-f6" value={form.notes} rows={2}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="ds-input" />
          </FormField>

        </form>
    </Modal>
  );
}

function StockAdjustModal({ item, onClose, onSaved }: { item: PackagingItem; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'reception' | 'adjustment' | 'waste'>('reception');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState(String(item.unit_cost || ''));
  const [note, setNote] = useState('');

  const adjustMutation = useMutation({
    mutationFn: () => packagingApi.adjustStock(item.id, {
      quantity: parseFloat(quantity) * (type === 'reception' ? 1 : type === 'waste' ? -1 : 1),
      type,
      note,
      unitCost: type === 'reception' ? parseFloat(unitCost) || undefined : undefined,
    }),
    onSuccess: () => {
      notify.success('Mouvement enregistré');
      onSaved();
    },
    // Stock insuffisant (diminution > disponible) : message du serveur affiché tel quel.
    onError: (e: unknown) => notify.error(apiErrorMessage(e, 'Erreur')),
  });

  return (
    <Modal title="Mouvement de stock" subtitle={item.name} onClose={onClose} locked={adjustMutation.isPending} width={448}
      footer={
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" disabled={adjustMutation.isPending}>Annuler</button>
          <button type="button" onClick={() => adjustMutation.mutate()}
            disabled={adjustMutation.isPending || !quantity} aria-busy={adjustMutation.isPending || undefined}
            className={type === 'waste' ? 'ds-btn-danger solid' : 'odoo-btn-primary'}>
            {type === 'waste' ? 'Déclarer la perte' : 'Enregistrer le mouvement'}
          </button>
        </div>
      }>
        <div className="space-y-4">
          <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 4, padding: '8px 12px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--ds-muted)' }}>Stock actuel</span>
            <strong>{parseFloat(String(item.stock_quantity || 0)).toFixed(0)} {item.unit}</strong>
          </div>

          <FormField label="Type de mouvement">
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: 'reception', label: '+ Réception', color: 'var(--ds-success)' },
                { v: 'adjustment', label: '± Ajustement', color: 'var(--ds-accent-ink)' },
                { v: 'waste', label: '− Perte', color: 'var(--ds-danger)' },
              ] as const).map(opt => (
                <button key={opt.v} type="button" onClick={() => setType(opt.v)} aria-pressed={type === opt.v}
                  style={{ height: 40, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--ds-card)',
                    border: type === opt.v ? `2px solid ${opt.color}` : '1px solid var(--ds-line)', color: type === opt.v ? opt.color : 'var(--ds-body)' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="Quantité" htmlFor="pkg-f7" required>
            <input id="pkg-f7" type="number" step="0.01" min="0" value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="ds-input" />
          </FormField>

          {type === 'reception' && (
            <FormField label="Prix unitaire (met à jour le catalogue)" htmlFor="pkg-f8">
              <input id="pkg-f8" type="number" step="0.01" min="0" value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="ds-input" />
            </FormField>
          )}

          <FormField label="Note" htmlFor="pkg-f9">
            <input id="pkg-f9" type="text" value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: BC-2026-XXX, ajustement inventaire..."
              className="ds-input" />
          </FormField>

        </div>
    </Modal>
  );
}
