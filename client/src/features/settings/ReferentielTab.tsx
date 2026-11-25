import { REF_BEHAVIOR_FIELDS } from '@ofauria/shared';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ChevronDown, ChevronRight, ChevronLeft, Plus, Pencil, Trash2, RotateCw, History, Download,
  Database, Wallet, Package, Factory, Users, Layers, RefreshCw, Undo2,
} from 'lucide-react';
import { referentielApi } from '../../api/referentiel.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useProdTerms } from '../../hooks/useProdTerms';
import { DataPanel, EmptyState, FormField, FormFooter, HeaderActions, LoadingState, Modal, NoResultState, SearchBar, SectionHeader, TableFooter, Toolbar } from '../../components/ds';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { RowMenu } from '../../components/ui/RowMenu';
import PurchaseTaxCodeSelect from '../../components/purchasing/PurchaseTaxCodeSelect';

/**
 * Référentiel : tables de valeurs paramétrables (catégories, unités, motifs…).
 * Même présentation que les autres écrans Paramètres : tableaux odoo-table,
 * étiquettes odoo-tag, boutons odoo-btn-*, confirmation par ConfirmDialog.
 */

type Row = Record<string, any>;

const DOMAINS: { key: string; label: string; icon: typeof Database; tableIds: string[] }[] = [
  { key: 'sales', label: 'Ventes et comptabilité', icon: Wallet, tableIds: ['expense_categories', 'revenue_categories', 'payment_methods'] },
  { key: 'products', label: 'Produits et ingrédients', icon: Package, tableIds: ['product_categories', 'units', 'ingredient_categories'] },
  { key: 'production', label: 'Production et pertes', icon: Factory, tableIds: ['production_categories', 'yield_units', 'loss_types', 'loss_reasons', 'production_loss_reasons', 'unsold_destinations'] },
  { key: 'hr', label: 'Ressources humaines', icon: Users, tableIds: ['absence_reasons', 'employee_roles', 'contract_types', 'leave_types'] },
];
const ACTIONS: Record<string, { tone: StatusTone; label: string }> = {
  create: { tone: 'done', label: 'Ajout' },
  update: { tone: 'progress', label: 'Modification' },
  deactivate: { tone: 'cancelled', label: 'Désactivation' },
  reactivate: { tone: 'todo', label: 'Réactivation' },
  follow_sector: { tone: 'progress', label: 'Retour au réglage du secteur' },
  restore_label: { tone: 'progress', label: 'Libellé d\'origine rétabli' },
};
// Mig 698 : une valeur du catalogue d'un autre secteur, jamais activée par la société.
const isOtherSector = (e: Row) => e.is_active === false && e.tier === 'sector' && e.applicable === false && e.activation === 'auto';
const LEVEL_LABELS = ['Catégorie', 'Sous-catégorie', 'Type'];
// Familles de mesure pour le référentiel « units » (conversions, mig 470).
// L'unité de base de chaque famille a un facteur 1 (g, ml, unité).
const UNIT_CATEGORIES: { v: string; label: string }[] = [
  { v: 'mass', label: 'Masse (base : g)' },
  { v: 'volume', label: 'Volume (base : ml)' },
  { v: 'count', label: 'Décompte (base : unité)' },
];
const unitCatLabel = (v: unknown) => UNIT_CATEGORIES.find(c => c.v === v)?.label.split(' (')[0] ?? '';
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
  const { ingredientsLc } = useProdTerms();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();
  const { canEdit } = usePermissions();
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['ref-dashboard'], queryFn: referentielApi.dashboard });
  const { data: scope } = useQuery({ queryKey: ['ref-scope'], queryFn: referentielApi.scope });
  const sync = useMutation({
    mutationFn: referentielApi.scopeSync,
    onSuccess: r => {
      queryClient.invalidateQueries({ queryKey: ['ref-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['ref-scope'] });
      queryClient.invalidateQueries({ queryKey: ['ref'] });
      notify.success(r.activated + r.deactivated > 0
        ? `Référentiels réalignés : ${r.activated} valeur(s) activée(s), ${r.deactivated} désactivée(s)`
        : 'Les référentiels sont déjà alignés sur le secteur');
    },
    onError: () => notify.error('Réalignement impossible'),
  });
  if (isLoading) return <LoadingState bare />;

  const allTables = (data?.tables || []) as Row[];
  // Mig 698 : seules les tables utiles au secteur et aux modules actifs sont proposées.
  const hiddenCount = allTables.filter(t => t.relevant === false).length;
  const tables = showAll ? allTables : allTables.filter(t => t.relevant !== false);
  const recent = (data?.recentChanges || []) as Row[];
  const totalActive = tables.reduce((s, t) => s + (Number(t.active_count) || 0), 0);
  const totalInactive = tables.reduce((s, t) => s + (Number(t.inactive_count) || 0), 0);
  const q = search.toLowerCase();
  const filtered = tables.filter(t => !q || String(t.label).toLowerCase().includes(q) || String(t.description || '').toLowerCase().includes(q));
  const domainOf = (id: string) => DOMAINS.find(d => d.tableIds.includes(id))?.key ?? 'other';
  const sections = [...DOMAINS, { key: 'other', label: 'Autres', icon: Database, tableIds: [] }]
    .map(d => ({ ...d, label: d.key === 'products' ? `Produits et ${ingredientsLc}` : d.label, tables: filtered.filter(t => domainOf(String(t.id)) === d.key) }))
    .filter(s => s.tables.length > 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {scope && scope.sectors.length > 0 && (
        <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', border: '1px solid var(--ds-sep)', borderRadius: 8, background: 'var(--ds-bg)', fontSize: 13 }}>
          <Layers size={15} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
          <span>
            Référentiels adaptés à <strong>{scope.sectors.map(x => x.label).join(' + ')}</strong>
            {scope.specializations.length > 0 && <> · spécialités : {scope.specializations.map(x => x.label).join(', ')}</>}.
            {' '}<span style={{ color: 'var(--ds-muted)' }}>Valeurs communes, valeurs du secteur et valeurs que vous ajoutez.</span>
          </span>
          <div style={{ flex: 1 }} />
          {canEdit('settings') && (
            <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={sync.isPending} onClick={() => sync.mutate()}
              title="Active les valeurs du secteur configuré et désactive celles des autres secteurs (jamais une valeur utilisée, ni un choix fait à la main)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={13} aria-hidden="true" /> Réaligner sur le secteur
            </button>
          )}
        </div>
      )}
      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher une table…" />
        {hiddenCount > 0 && (
          <label htmlFor="ref-show-all-tables" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input id="ref-show-all-tables" type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Afficher les {hiddenCount} tables hors secteur ou module inactif
          </label>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>
          {tables.length} tables · {totalActive} valeurs actives{totalInactive > 0 ? ` · ${totalInactive} inactives` : ''}
        </span>
      </Toolbar>

      {sections.length > 0 && (
        // Un seul tableau, groupé par domaine (lignes de groupe repliables) : même gabarit
        // que les listes des autres modules (barre d'outils + panneau standard).
        <DataPanel label="Tables du référentiel">
          <table className="odoo-table">
            <thead><tr><th style={{ width: '30%' }}>Table</th><th>Description</th><th className="ds-num" style={{ width: 90 }}>Actives</th><th style={{ width: 240 }}>État</th><th style={{ width: 44 }}><span className="sr-only">Ouvrir</span></th></tr></thead>
            {sections.map(s => {
              const Icon = s.icon;
              const isCollapsed = !search && collapsed[s.key];
              return (
                <tbody key={s.key}>
                  <tr className="ds-group">
                    <td colSpan={5}>
                      <button type="button" onClick={() => setCollapsed(c => ({ ...c, [s.key]: !c[s.key] }))} aria-expanded={!isCollapsed}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
                        {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                        <Icon size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
                        {s.label}
                        <small>{s.tables.length} table{s.tables.length > 1 ? 's' : ''}</small>
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed && s.tables.map(t => (
                    <tr key={String(t.id)} className="ds-clickable" onClick={() => onOpenTable(String(t.id))}>
                      <td className="ds-strong">
                        <button type="button" onClick={ev => { ev.stopPropagation(); onOpenTable(String(t.id)); }}
                          style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>{String(t.label)}</button>
                      </td>
                      <td style={{ color: 'var(--ds-muted)' }}>{String(t.description || '')}</td>
                      <td className="ds-num">{Number(t.active_count) || 0}</td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                          {t.relevant === false && <StatusTag tone="draft" label="Hors secteur" />}
                          {Number(t.sector_count) > 0 && <span className="odoo-tag odoo-tag-blue">{Number(t.sector_count)} du secteur</span>}
                          {Number(t.custom_count) > 0 && <span className="odoo-tag odoo-tag-purple">{Number(t.custom_count)} personnalisée{Number(t.custom_count) > 1 ? 's' : ''}</span>}
                          {Number(t.inactive_count) > 0 && <StatusTag tone="cancelled" label={`${Number(t.inactive_count)} inactive${Number(t.inactive_count) > 1 ? 's' : ''}`} />}
                        </span>
                      </td>
                      <td><ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} /></td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </DataPanel>
      )}
      {!sections.length && <NoResultState text="Aucune table ne correspond à la recherche." onReset={() => setSearch('')} />}

      {recent.length > 0 && (
        <section style={{ display: 'grid', gap: 6 }}>
          <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><History size={14} aria-hidden="true" /> Dernières modifications</span>} />
          <DataPanel label="Dernières modifications">
            <table className="odoo-table">
              <thead><tr><th style={{ width: 130 }}>Date</th><th style={{ width: 130 }}>Action</th><th>Table</th><th>Par</th></tr></thead>
              <tbody>
                {recent.slice(0, 10).map(l => (
                  <tr key={String(l.id)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(l.created_at, 'dd/MM/yyyy HH:mm')}</td>
                    <td><StatusTag tone={ACTIONS[String(l.action)]?.tone ?? 'draft'} label={ACTIONS[String(l.action)]?.label ?? String(l.action)} /></td>
                    <td className="ds-strong">{String(l.table_label || l.table_id)}</td>
                    <td>{who(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
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
  const [showCatalog, setShowCatalog] = useState(false);
  const [search, setSearch] = useState('');
  const [showAudit, setShowAudit] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<null | { id: string | null; label: string; code: string; description: string; color: string; metadata: Row }>(null);

  // Toujours chargé avec les inactives : le filtre se fait ici (inactives, catalogue des autres secteurs).
  const { data, isLoading } = useQuery({ queryKey: ['ref-entries', tableId], queryFn: () => referentielApi.entries(tableId, true) });
  const { data: audit } = useQuery({ queryKey: ['ref-audit', tableId], queryFn: () => referentielApi.audit(tableId), enabled: showAudit });

  const table = data?.table as Row | undefined;
  const allEntries = (data?.entries || []) as Row[];
  // Mig 698 : le catalogue des autres secteurs ne s'affiche que sur demande ; les valeurs
  // désactivées par la société suivent « Afficher les inactives ».
  const catalogCount = allEntries.filter(isOtherSector).length;
  const entries = allEntries.filter(e => (isOtherSector(e) ? showCatalog : e.is_active !== false || showInactive));
  const isNative = table?.source === 'native';
  const isHierarchical = tableId === 'expense_categories' || tableId === 'revenue_categories';

  const invalidate = () => {
    for (const key of [['ref-entries', tableId], ['ref-dashboard'], ['ref-audit', tableId], ['expense-categories'], ['categories'], ['ref', tableId]]) {
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
    onSuccess: () => { invalidate(); notify.success('Valeur activée'); },
  });
  const followSector = useMutation({
    mutationFn: (id: string) => referentielApi.followSector(tableId, id),
    onSuccess: () => { invalidate(); notify.success('La valeur suit de nouveau le secteur'); },
    onError: () => notify.error('Action impossible'),
  });
  const restoreLabel = useMutation({
    mutationFn: (id: string) => referentielApi.restoreLabel(tableId, id),
    onSuccess: () => { invalidate(); notify.success('Libellé d\'origine rétabli'); },
    onError: () => notify.error('Action impossible'),
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

  if (isLoading) return <LoadingState bare />;

  const activeCount = entries.filter(e => e.is_active !== false).length;
  const inactiveCount = entries.filter(e => e.is_active === false && !isOtherSector(e)).length;
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

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="odoo-btn-secondary" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={13} aria-hidden="true" /> Référentiel
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <SectionHeader title={String(table?.label || tableId)} />
        </div>
      </div>

      <HeaderActions>
        <button type="button" className="odoo-btn-secondary" onClick={() => referentielApi.exportCsv(tableId, entries, String(table?.label || tableId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} aria-hidden="true" /> Exporter
        </button>
        {canCreate('settings') && (
          <button type="button" className="odoo-btn-primary" onClick={() => openNew()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} aria-hidden="true" /> {isHierarchical ? 'Nouvelle catégorie' : 'Ajouter'}
          </button>
        )}
      </HeaderActions>

      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher par libellé, code…" label="Rechercher une valeur" />
        {!isNative && (
          <label htmlFor="ref-show-inactive" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input id="ref-show-inactive" type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Afficher les inactives
          </label>
        )}
        {!isNative && (catalogCount > 0 || showCatalog) && (
          <label htmlFor="ref-show-catalog" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            title="Valeurs livrées pour d'autres secteurs : vous pouvez en activer une au besoin">
            <input id="ref-show-catalog" type="checkbox" checked={showCatalog} onChange={e => setShowCatalog(e.target.checked)} />
            Catalogue des autres secteurs{catalogCount > 0 ? ` (${catalogCount})` : ''}
          </label>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="odoo-btn-secondary" aria-pressed={showAudit} onClick={() => setShowAudit(!showAudit)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...(showAudit ? { background: 'var(--ds-tint)', color: 'var(--ds-accent-ink)' } : {}) }}>
          <History size={13} aria-hidden="true" /> Historique
        </button>
      </Toolbar>

      {showAudit && (
        <DataPanel label="Historique de la table" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table className="odoo-table ds-dense">
            <thead><tr><th style={{ width: 140 }}>Date</th><th style={{ width: 130 }}>Action</th><th>Par</th></tr></thead>
            <tbody>
              {((audit as Row[]) || []).slice(0, 30).map(l => (
                <tr key={String(l.id)}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(l.created_at, 'dd/MM/yyyy HH:mm')}</td>
                  <td><StatusTag tone={ACTIONS[String(l.action)]?.tone ?? 'draft'} label={ACTIONS[String(l.action)]?.label ?? String(l.action)} /></td>
                  <td>{who(l)}</td>
                </tr>
              ))}
              {!(audit as Row[] | undefined)?.length && <tr><td colSpan={3}><EmptyState icon={History} title="Aucune modification enregistrée" bare /></td></tr>}
            </tbody>
          </table>
        </DataPanel>
      )}

      {rows.length === 0 ? (
        search
          ? <NoResultState text="Aucune valeur ne correspond à la recherche." onReset={() => setSearch('')} />
          : <EmptyState icon={Database} title="Table vide" text="Ajoutez la première valeur avec le bouton « Ajouter »." />
      ) : (
        <DataPanel label={String(table?.label || tableId)}
          footer={<TableFooter note={`${activeCount} valeur${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''}${inactiveCount > 0 ? ` · ${inactiveCount} inactive${inactiveCount > 1 ? 's' : ''}` : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Libellé</th>
                {isHierarchical && <th style={{ width: 130 }}>Niveau</th>}
                {hasCode && <th style={{ width: 120 }}>Code</th>}
                <th>Description</th>
                <th style={{ width: 150 }}>État</th>
                <th className="ds-actions" style={{ width: 110 }} aria-label="Actions"></th>
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
                            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ds-muted)', display: 'inline-flex' }}>
                            {collapsed[id] ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                          </button>
                        ) : <span style={{ width: 14, display: 'inline-block' }} />}
                        {e.color ? <span style={{ width: 10, height: 10, borderRadius: 2, background: String(e.color), display: 'inline-block' }} /> : null}
                        <span className={isHierarchical && depth === 0 ? 'ds-strong' : undefined}>{String(e.label)}</span>
                        {canHaveChildren && childCount > 0 && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>({childCount})</span>}
                      </span>
                    </td>
                    {isHierarchical && <td style={{ color: 'var(--ds-muted)' }}>{LEVEL_LABELS[level - 1] ?? ''}</td>}
                    {hasCode && <td className="ds-ref">{String(e.code || '')}</td>}
                    <td style={{ color: 'var(--ds-muted)' }}>{String(e.description || '')}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {Boolean(e._requires_po) && <span className="odoo-tag odoo-tag-purple">BC requis</span>}
                        {tableId === 'units' && (e.metadata as Row)?.category != null && (
                          <span className="odoo-tag odoo-tag-blue">
                            {unitCatLabel((e.metadata as Row).category)}
                            {Number((e.metadata as Row).to_base) > 1 && ` · ×${Number((e.metadata as Row).to_base)}`}
                            {Boolean((e.metadata as Row).is_base) && ' · base'}
                          </span>
                        )}
                        {e.tier === 'sector' && <span className="odoo-tag odoo-tag-blue" title={`Valeur livrée pour : ${[...(e.sectors as string[] || []), ...(e.specializations as string[] || [])].join(', ')}`}>{isOtherSector(e) ? 'Autre secteur' : 'Secteur'}</span>}
                        {e.tier === 'custom' && <span className="odoo-tag odoo-tag-purple" title="Valeur ajoutée par votre société">Personnalisée</span>}
                        {Boolean(e.overridden) && <span className="odoo-tag" title={`Libellé d'origine : ${String(e.system_label)}`}>Libellé modifié</span>}
                        {e.activation === 'forced_on' && e.tier === 'sector' && e.applicable === false && <span className="odoo-tag" title="Activée à la main alors qu'elle relève d'un autre secteur">Activée à la main</span>}
                        {inactive && !isOtherSector(e) && <StatusTag tone="cancelled" label="Inactive" />}
                      </span>
                    </td>
                    <td className="ds-actions">
                      {inactive ? (
                        canEdit('settings') && (
                          <button type="button" className="odoo-btn-secondary ds-btn-sm" aria-label={`Réactiver ${e.label}`} disabled={reactivate.isPending} onClick={() => reactivate.mutate(id)}>
                            <RotateCw size={13} aria-hidden="true" /> {isOtherSector(e) ? 'Activer' : 'Réactiver'}
                          </button>
                        )
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {canEdit('settings') && (
                            <button type="button" className="odoo-btn-secondary ds-btn-sm" aria-label={`Modifier ${e.label}`} onClick={() => openEdit(e)}>
                              <Pencil size={13} aria-hidden="true" /> Modifier
                            </button>
                          )}
                          <RowMenu label={`Plus d'actions pour ${e.label}`} items={[
                            ...(canHaveChildren && canCreate('settings') ? [{ label: level === 1 ? 'Ajouter une sous-catégorie' : 'Ajouter un type', icon: Plus, onSelect: () => openNew(e) }] : []),
                            ...(canEdit('settings') && e.overridden ? [{ label: 'Rétablir le libellé d\'origine', icon: Undo2, onSelect: () => restoreLabel.mutate(id) }] : []),
                            ...(canEdit('settings') && !isNative && e.origin === 'system' && e.activation !== 'auto' ? [{ label: 'Suivre le secteur', icon: Layers, onSelect: () => followSector.mutate(id) }] : []),
                            ...(canDelete('settings') ? [{ label: isNative ? 'Supprimer' : 'Désactiver', icon: Trash2, danger: true, onSelect: () => deactivate(e, depth) }] : []),
                          ]} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {form && (
        <Modal width={520} onClose={() => setForm(null)} locked={save.isPending}
          title={form.id ? 'Modifier la valeur' : isHierarchical && !form.metadata.parent_id ? 'Nouvelle catégorie' : 'Nouvelle valeur'}
          subtitle={parentLabel ? `sous « ${parentLabel} »` : undefined}
          footer={<FormFooter onCancel={() => setForm(null)} onSubmit={() => save.mutate(form)} busy={save.isPending}
            disabled={!form.label.trim()} submitLabel={form.id ? 'Enregistrer' : 'Ajouter'} />}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 200px' }}>
                <FormField label="Libellé" htmlFor="ref-form-label" required>
                  <input id="ref-form-label" className="ds-input" value={form.label} autoFocus onChange={e => setForm({ ...form, label: e.target.value })}
                    placeholder={isHierarchical ? 'Charges sociales' : 'Kilogramme'} />
                </FormField>
              </div>
              {!isHierarchical && (
                <div style={{ flex: '1 1 120px' }}>
                  <FormField label="Code" htmlFor="ref-form-code">
                    <input id="ref-form-code" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="kg" />
                  </FormField>
                </div>
              )}
            </div>
            <FormField label="Description" htmlFor="ref-form-description">
              <input id="ref-form-description" className="ds-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </FormField>
            {!isHierarchical && (
              <FormField label="Couleur" htmlFor="ref-form-color">
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <input id="ref-form-color" type="color" value={form.color || '#6b7280'} onChange={e => setForm({ ...form, color: e.target.value })}
                    style={{ width: 40, height: 36, border: '1px solid var(--ds-line)', borderRadius: 'var(--ds-r-field)', padding: 0, background: 'none' }} />
                  <input className="ds-input" style={{ fontFamily: 'ui-monospace, monospace', width: 120 }} value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} placeholder="Aucune" aria-label="Code couleur" />
                </span>
              </FormField>
            )}
            {/* Comportements lus par le code (types de client, de commande — mig 701). */}
            {(REF_BEHAVIOR_FIELDS[tableId] ?? []).map(f => f.kind === 'boolean' ? (
              <label key={f.key} htmlFor={`ref-form-b-${f.key}`} title={f.help} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14 }}>
                <input id={`ref-form-b-${f.key}`} type="checkbox" checked={form.metadata[f.key] === true} style={{ marginTop: 3 }}
                  onChange={e => setForm({ ...form, metadata: { ...form.metadata, [f.key]: e.target.checked } })} />
                <span>{f.label}<span className="odoo-setting-help" style={{ display: 'block', margin: 0 }}>{f.help}</span></span>
              </label>
            ) : (
              <FormField key={f.key} label={f.label} htmlFor={`ref-form-b-${f.key}`} hint={f.help}>
                <select id={`ref-form-b-${f.key}`} className="ds-input" value={String(form.metadata[f.key] ?? f.options[0].value)}
                  onChange={e => setForm({ ...form, metadata: { ...form.metadata, [f.key]: e.target.value } })}>
                  {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
            ))}
            {tableId === 'expense_categories' && (
              <label htmlFor="ref-form-po" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input id="ref-form-po" type="checkbox" checked={Boolean(form.metadata.requires_po)}
                  onChange={e => setForm({ ...form, metadata: { ...form.metadata, requires_po: e.target.checked } })} />
                Bon de commande requis pour les dépenses de cette catégorie
              </label>
            )}
            {tableId === 'expense_categories' && (
              <FormField label="TVA à l'achat par défaut" htmlFor="ref-form-tax"
                hint="Appliquée aux articles de la catégorie qui n'ont pas leur propre code, et aux lignes de service ou d'immobilisation : proposée sur le bon de commande, reprise sur la facture.">
                <PurchaseTaxCodeSelect id="ref-form-tax" value={String(form.metadata.default_tax_code || '')}
                  onChange={code => setForm({ ...form, metadata: { ...form.metadata, default_tax_code: code || null } })}
                  emptyLabel="Aucun — taux à préciser sur la ligne" />
              </FormField>
            )}
            {tableId === 'units' && (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '2 1 200px' }}>
                    <FormField label="Famille de mesure" htmlFor="ref-form-category">
                      <select id="ref-form-category" className="ds-input" value={String(form.metadata.category || '')}
                        onChange={e => setForm({ ...form, metadata: { ...form.metadata, category: e.target.value || undefined } })}>
                        <option value="">— (non convertible)</option>
                        {UNIT_CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
                      </select>
                    </FormField>
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <FormField label="Facteur vers la base" htmlFor="ref-form-tobase">
                      <input id="ref-form-tobase" type="number" min="0" step="any" className="ds-input"
                        value={form.metadata.to_base != null ? String(form.metadata.to_base) : ''}
                        disabled={Boolean(form.metadata.is_base)}
                        onChange={e => setForm({ ...form, metadata: { ...form.metadata, to_base: e.target.value === '' ? undefined : Number(e.target.value) } })}
                        placeholder="1000" />
                    </FormField>
                  </div>
                </div>
                <label htmlFor="ref-form-isbase" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input id="ref-form-isbase" type="checkbox" checked={Boolean(form.metadata.is_base)}
                    onChange={e => setForm({ ...form, metadata: { ...form.metadata, is_base: e.target.checked, ...(e.target.checked ? { to_base: 1 } : {}) } })} />
                  Unité de base de sa famille (facteur 1)
                </label>
                <p className="ds-field-hint" style={{ margin: 0 }}>
                  Le facteur exprime 1 unité dans l'unité de base (ex. 1 kg = 1000 g → facteur 1000). La conversion n'opère qu'entre unités d'une même famille.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
