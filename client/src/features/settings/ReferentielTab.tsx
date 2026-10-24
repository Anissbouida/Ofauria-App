import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ChevronDown, ChevronRight, ChevronLeft, Search, Plus, Pencil, Trash2, RotateCw, History, Download,
  Database, Wallet, Package, Factory, Users, Loader2, X,
} from 'lucide-react';
import { referentielApi } from '../../api/referentiel.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/**
 * Référentiel : tables de valeurs paramétrables (catégories, unités, motifs…).
 * Même présentation que les autres écrans Paramètres : tableaux odoo-table,
 * étiquettes odoo-tag, boutons odoo-btn-*, confirmation par ConfirmDialog.
 */

type Row = Record<string, any>;

const DOMAINS: { key: string; label: string; icon: typeof Database; tableIds: string[] }[] = [
  { key: 'sales', label: 'Ventes et comptabilité', icon: Wallet, tableIds: ['expense_categories', 'revenue_categories', 'payment_methods'] },
  { key: 'products', label: 'Produits et ingrédients', icon: Package, tableIds: ['product_categories', 'units', 'ingredient_categories'] },
  { key: 'production', label: 'Production et pertes', icon: Factory, tableIds: ['yield_units', 'loss_types', 'loss_reasons', 'production_loss_reasons', 'unsold_destinations'] },
  { key: 'hr', label: 'Ressources humaines', icon: Users, tableIds: ['absence_reasons', 'employee_roles', 'contract_types', 'leave_types'] },
];
const ACTIONS: Record<string, { cls: string; label: string }> = {
  create: { cls: 'odoo-tag odoo-tag-green', label: 'Ajout' },
  update: { cls: 'odoo-tag odoo-tag-blue', label: 'Modification' },
  deactivate: { cls: 'odoo-tag odoo-tag-red', label: 'Désactivation' },
  reactivate: { cls: 'odoo-tag odoo-tag-orange', label: 'Réactivation' },
};
const LEVEL_LABELS = ['Catégorie', 'Sous-catégorie', 'Type'];
const fmt = (d: unknown, f: string) => (d ? format(new Date(String(d)), f, { locale: fr }) : '');
const who = (l: Row) => (l.first_name ? `${String(l.first_name)} ${String(l.last_name || '')}`.trim() : 'Système');

export default function ReferentielTab() {
  // Table ouverte dans l'URL (?page=referentiel&table=…) : lien direct et retour arrière.
  const [params, setParams] = useSearchParams();
  const tableId = params.get('table');
  const setTableId = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('table', id); else next.delete('table');
    setParams(next);
  };
  return (
    <div className="odoo-scope">
      {tableId ? <ParamTable tableId={tableId} onBack={() => setTableId(null)} /> : <RefDashboard onOpenTable={setTableId} />}
    </div>
  );
}

/* ─── Liste des tables ─── */

function RefDashboard({ onOpenTable }: { onOpenTable: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { data, isLoading } = useQuery({ queryKey: ['ref-dashboard'], queryFn: referentielApi.dashboard });
  if (isLoading) return <Loader2 className="animate-spin" size={18} />;

  const tables = (data?.tables || []) as Row[];
  const recent = (data?.recentChanges || []) as Row[];
  const totalActive = tables.reduce((s, t) => s + (Number(t.active_count) || 0), 0);
  const totalInactive = tables.reduce((s, t) => s + (Number(t.inactive_count) || 0), 0);
  const q = search.toLowerCase();
  const filtered = tables.filter(t => !q || String(t.label).toLowerCase().includes(q) || String(t.description || '').toLowerCase().includes(q));
  const domainOf = (id: string) => DOMAINS.find(d => d.tableIds.includes(id))?.key ?? 'other';
  const sections = [...DOMAINS, { key: 'other', label: 'Autres', icon: Database, tableIds: [] }]
    .map(d => ({ ...d, tables: filtered.filter(t => domainOf(String(t.id)) === d.key) }))
    .filter(s => s.tables.length > 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '1 1 260px', maxWidth: 420 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--odoo-text-muted)' }} />
          <input id="ref-search" className="odoo-search-input" style={{ paddingLeft: 26, width: '100%' }} placeholder="Rechercher une table…"
            value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher une table" />
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          {tables.length} tables · {totalActive} valeurs actives{totalInactive > 0 ? ` · ${totalInactive} inactives` : ''}
        </span>
      </div>

      {sections.map(s => {
        const Icon = s.icon;
        const isCollapsed = !search && collapsed[s.key];
        return (
          <section key={s.key} style={{ display: 'grid', gap: 6 }}>
            <button type="button" onClick={() => setCollapsed(c => ({ ...c, [s.key]: !c[s.key] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--odoo-text-muted)' }}>
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <Icon size={14} />
              <span style={{ fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: '0.8125rem' }}>({s.tables.length})</span>
            </button>
            {!isCollapsed && (
              <div style={{ overflowX: 'auto' }}>
                {/* Largeurs fixes : les colonnes restent alignees d'un domaine a l'autre. */}
                <table className="odoo-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <thead><tr><th style={{ width: '30%' }}>Table</th><th>Description</th><th style={{ textAlign: 'right', width: 90 }}>Actives</th><th style={{ width: 120 }}></th><th style={{ width: 36 }}></th></tr></thead>
                  <tbody>
                    {s.tables.map(t => (
                      <tr key={String(t.id)} onClick={() => onOpenTable(String(t.id))} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 500 }}>{String(t.label)}</td>
                        <td style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>{String(t.description || '')}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(t.active_count) || 0}</td>
                        <td>{Number(t.inactive_count) > 0 && <span className="odoo-tag odoo-tag-orange">{Number(t.inactive_count)} inactive(s)</span>}</td>
                        <td><ChevronRight size={14} style={{ color: 'var(--odoo-text-muted)' }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {!sections.length && <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.875rem' }}>Aucune table ne correspond à la recherche.</p>}

      {recent.length > 0 && (
        <section style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--odoo-text-muted)' }}>
            <History size={14} />
            <span style={{ fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Dernières modifications</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th style={{ width: 130 }}>Date</th><th style={{ width: 130 }}>Action</th><th>Table</th><th>Par</th></tr></thead>
              <tbody>
                {recent.slice(0, 10).map(l => (
                  <tr key={String(l.id)}>
                    <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.created_at, 'dd/MM/yyyy HH:mm')}</td>
                    <td><span className={ACTIONS[String(l.action)]?.cls ?? 'odoo-tag odoo-tag-grey'}>{ACTIONS[String(l.action)]?.label ?? String(l.action)}</span></td>
                    <td>{String(l.table_label || l.table_id)}</td>
                    <td>{who(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/* ─── Valeurs d'une table (liste plate ou arborescence) ─── */

function ParamTable({ tableId, onBack }: { tableId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { canCreate, canEdit, canDelete } = usePermissions();
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [showAudit, setShowAudit] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<null | { id: string | null; label: string; code: string; description: string; color: string; metadata: Row }>(null);

  const { data, isLoading } = useQuery({ queryKey: ['ref-entries', tableId, showInactive], queryFn: () => referentielApi.entries(tableId, showInactive) });
  const { data: audit } = useQuery({ queryKey: ['ref-audit', tableId], queryFn: () => referentielApi.audit(tableId), enabled: showAudit });

  const table = data?.table as Row | undefined;
  const entries = (data?.entries || []) as Row[];
  const isNative = table?.source === 'native';
  const isHierarchical = tableId === 'expense_categories' || tableId === 'revenue_categories';

  const invalidate = () => {
    for (const key of [['ref-entries', tableId], ['ref-dashboard'], ['ref-audit', tableId], ['expense-categories'], ['categories']]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const save = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => {
      const payload = {
        label: f.label.trim(), code: f.code.trim() || undefined, description: f.description.trim() || undefined,
        color: f.color || undefined, metadata: Object.keys(f.metadata).length ? f.metadata : undefined,
      };
      return f.id ? referentielApi.update(tableId, f.id, payload) : referentielApi.create(tableId, payload);
    },
    onSuccess: (_r, f) => { invalidate(); notify.success(f.id ? 'Valeur modifiée' : 'Valeur ajoutée'); setForm(null); },
    onError: () => notify.error('Enregistrement impossible'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => referentielApi.remove(tableId, id),
    onSuccess: () => { invalidate(); notify.success(isNative ? 'Valeur supprimée' : 'Valeur désactivée'); },
    onError: (err: Error & { response?: { data?: { error?: { message?: string } } } }) => notify.error(err.response?.data?.error?.message || 'Suppression impossible'),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => referentielApi.reactivate(tableId, id),
    onSuccess: () => { invalidate(); notify.success('Valeur réactivée'); },
  });

  // Lignes à afficher, dans l'ordre de l'arborescence (catégorie > sous-catégorie > type).
  const rows = useMemo(() => {
    const q = search.toLowerCase();
    const match = (e: Row) => !q || [e.label, e.code, e.description].some(v => String(v || '').toLowerCase().includes(q));
    const filtered = entries.filter(match);
    if (!isHierarchical || q || !filtered.some(e => e._level === 1)) {
      return filtered.map(e => ({ entry: e, depth: 0, childCount: 0 }));
    }
    const children = (id: string, level: number) => filtered.filter(e => e._level === level && String(e._parent_id) === id);
    const out: { entry: Row; depth: number; childCount: number }[] = [];
    for (const cat of filtered.filter(e => e._level === 1)) {
      const subs = children(String(cat.id), 2);
      const direct = children(String(cat.id), 3);
      out.push({ entry: cat, depth: 0, childCount: subs.length + direct.length });
      if (collapsed[String(cat.id)]) continue;
      for (const sub of subs) {
        const types = children(String(sub.id), 3);
        out.push({ entry: sub, depth: 1, childCount: types.length });
        if (!collapsed[String(sub.id)]) types.forEach(t => out.push({ entry: t, depth: 2, childCount: 0 }));
      }
      direct.forEach(t => out.push({ entry: t, depth: 1, childCount: 0 }));
    }
    return out;
  }, [entries, search, isHierarchical, collapsed]);

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;

  const activeCount = entries.filter(e => e.is_active !== false).length;
  const inactiveCount = entries.filter(e => e.is_active === false).length;
  const hasCode = !isHierarchical && entries.some(e => e.code);
  const openNew = (parent?: Row) => setForm({
    id: null, label: '', code: '', description: '', color: '',
    metadata: parent ? { parent_id: String(parent.id), level: (Number(parent._level) || Number(parent.metadata?.level) || 1) + 1 } : {},
  });
  const openEdit = (e: Row) => setForm({
    id: String(e.id), label: String(e.label || ''), code: String(e.code || ''), description: String(e.description || ''),
    color: String(e.color || ''), metadata: (e.metadata as Row) || {},
  });
  const deactivate = async (e: Row, depth: number) => {
    const msg = isHierarchical && depth === 0 ? `Désactiver « ${e.label} » et toutes ses sous-catégories ?` : `Désactiver « ${e.label} » ?`;
    if (await confirm(msg, { danger: true, confirmLabel: isNative ? 'Supprimer' : 'Désactiver' })) remove.mutate(String(e.id));
  };
  const parentLabel = form?.metadata.parent_id ? String(entries.find(e => String(e.id) === String(form.metadata.parent_id))?.label || '') : '';
  const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
  const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
  const iconBtn: React.CSSProperties = { padding: '2px 6px', display: 'inline-flex', alignItems: 'center' };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="odoo-btn-secondary" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={13} /> Référentiel
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{String(table?.label || tableId)}</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
            {activeCount} active(s){inactiveCount > 0 ? ` · ${inactiveCount} inactive(s)` : ''}
          </div>
        </div>
      </div>

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '1 1 240px', maxWidth: 420 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--odoo-text-muted)' }} />
          <input id="ref-entry-search" className="odoo-search-input" style={{ paddingLeft: 26, width: '100%' }} placeholder="Rechercher par libellé, code…"
            value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher une valeur" />
        </span>
        {!isNative && (
          <label htmlFor="ref-show-inactive" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
            <input id="ref-show-inactive" type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Afficher les inactives
          </label>
        )}
        <div style={{ flex: 1 }} />
        <button className={showAudit ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setShowAudit(!showAudit)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <History size={13} /> Historique
        </button>
        <button className="odoo-btn-secondary" onClick={() => referentielApi.exportCsv(tableId, entries, String(table?.label || tableId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> Exporter
        </button>
        {canCreate('settings') && (
          <button className="odoo-btn-primary" onClick={() => openNew()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> {isHierarchical ? 'Nouvelle catégorie' : 'Ajouter'}
          </button>
        )}
      </div>

      {showAudit && (
        <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th style={{ width: 140 }}>Date</th><th style={{ width: 130 }}>Action</th><th>Par</th></tr></thead>
            <tbody>
              {((audit as Row[]) || []).slice(0, 30).map(l => (
                <tr key={String(l.id)}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.created_at, 'dd/MM/yyyy HH:mm')}</td>
                  <td><span className={ACTIONS[String(l.action)]?.cls ?? 'odoo-tag odoo-tag-grey'}>{ACTIONS[String(l.action)]?.label ?? String(l.action)}</span></td>
                  <td>{who(l)}</td>
                </tr>
              ))}
              {!(audit as Row[] | undefined)?.length && <tr><td colSpan={3} style={{ color: 'var(--odoo-text-muted)', textAlign: 'center' }}>Aucune modification enregistrée</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 ? (
        <StatusBanner tone="neutral" icon={Database} title={search ? 'Aucun résultat' : 'Table vide'}>
          {search ? 'Aucune valeur ne correspond à la recherche.' : 'Ajoutez la première valeur avec le bouton « Ajouter ».'}
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Libellé</th>
                {isHierarchical && <th style={{ width: 130 }}>Niveau</th>}
                {hasCode && <th style={{ width: 120 }}>Code</th>}
                <th>Description</th>
                <th style={{ width: 150 }}></th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry: e, depth, childCount }) => {
                const id = String(e.id);
                const inactive = e.is_active === false;
                const level = Number(e._level) || 1;
                const canHaveChildren = isHierarchical && level < 3 && !search;
                return (
                  <tr key={id} style={{ opacity: inactive ? 0.55 : 1 }}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: depth * 22 }}>
                        {canHaveChildren && childCount > 0 ? (
                          <button type="button" onClick={() => setCollapsed(c => ({ ...c, [id]: !c[id] }))}
                            aria-label={collapsed[id] ? 'Déplier' : 'Replier'}
                            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--odoo-text-muted)', display: 'inline-flex' }}>
                            {collapsed[id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                        ) : <span style={{ width: 14, display: 'inline-block' }} />}
                        {e.color ? <span style={{ width: 10, height: 10, borderRadius: 2, background: String(e.color), display: 'inline-block' }} /> : null}
                        <span style={{ fontWeight: isHierarchical && depth === 0 ? 600 : 400 }}>{String(e.label)}</span>
                        {canHaveChildren && childCount > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>({childCount})</span>}
                      </span>
                    </td>
                    {isHierarchical && <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{LEVEL_LABELS[level - 1] ?? ''}</td>}
                    {hasCode && <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>{String(e.code || '')}</td>}
                    <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{String(e.description || '')}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {Boolean(e._requires_po) && <span className="odoo-tag odoo-tag-purple">BC requis</span>}
                        {inactive && <span className="odoo-tag odoo-tag-grey">Inactive</span>}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {inactive ? (
                        canEdit('settings') && (
                          <button className="odoo-btn-secondary" style={iconBtn} title="Réactiver" aria-label={`Réactiver ${e.label}`} onClick={() => reactivate.mutate(id)}>
                            <RotateCw size={13} />
                          </button>
                        )
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          {canHaveChildren && canCreate('settings') && (
                            <button className="odoo-btn-secondary" style={iconBtn} title={level === 1 ? 'Ajouter une sous-catégorie' : 'Ajouter un type'}
                              aria-label={`Ajouter sous ${e.label}`} onClick={() => openNew(e)}>
                              <Plus size={13} />
                            </button>
                          )}
                          {canEdit('settings') && (
                            <button className="odoo-btn-secondary" style={iconBtn} title="Modifier" aria-label={`Modifier ${e.label}`} onClick={() => openEdit(e)}>
                              <Pencil size={13} />
                            </button>
                          )}
                          {canDelete('settings') && (
                            <button className="odoo-btn-secondary" style={iconBtn} title={isNative ? 'Supprimer' : 'Désactiver'} aria-label={`Désactiver ${e.label}`} onClick={() => deactivate(e, depth)}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <ModalBackdrop onClose={() => setForm(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="odoo-scope" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--odoo-bg)', borderRadius: 6, border: '1px solid var(--odoo-border)', width: '100%', maxWidth: 520, margin: '0 16px', display: 'grid' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
              <div style={{ fontWeight: 600 }}>
                {form.id ? 'Modifier la valeur' : isHierarchical && !form.metadata.parent_id ? 'Nouvelle catégorie' : 'Nouvelle valeur'}
                {parentLabel && <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)', marginLeft: 6 }}>sous « {parentLabel} »</span>}
              </div>
              <button type="button" onClick={() => setForm(null)} aria-label="Fermer" style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--odoo-text-muted)' }}><X size={16} /></button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ ...lab, flex: '2 1 200px' }}>Libellé
                  <input id="ref-form-label" style={field} value={form.label} autoFocus onChange={e => setForm({ ...form, label: e.target.value })}
                    placeholder={isHierarchical ? 'Charges sociales' : 'Kilogramme'} />
                </label>
                {!isHierarchical && (
                  <label style={{ ...lab, flex: '1 1 120px' }}>Code
                    <input id="ref-form-code" style={{ ...field, fontFamily: 'ui-monospace, monospace' }} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="kg" />
                  </label>
                )}
              </div>
              <label style={lab}>Description
                <input id="ref-form-description" style={field} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </label>
              {!isHierarchical && (
                <label style={lab}>Couleur
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                    <input id="ref-form-color" type="color" value={form.color || '#6b7280'} onChange={e => setForm({ ...form, color: e.target.value })}
                      style={{ width: 36, height: 30, border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 0, background: 'none' }} />
                    <input style={{ ...field, fontFamily: 'ui-monospace, monospace', width: 120 }} value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} placeholder="Aucune" aria-label="Code couleur" />
                  </span>
                </label>
              )}
              {tableId === 'expense_categories' && (
                <label htmlFor="ref-form-po" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
                  <input id="ref-form-po" type="checkbox" checked={Boolean(form.metadata.requires_po)}
                    onChange={e => setForm({ ...form, metadata: { ...form.metadata, requires_po: e.target.checked } })} />
                  Bon de commande requis pour les dépenses de cette catégorie
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--odoo-border)' }}>
              <button className="odoo-btn-secondary" onClick={() => setForm(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={!form.label.trim() || save.isPending} onClick={() => save.mutate(form)}>
                {form.id ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
