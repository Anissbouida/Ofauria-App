import { money, currencySymbol } from '../../utils/money';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../api/customers.api';
import { loyaltyApi, tierOf, type LoyaltyTier } from '../../api/promotions.api';
import { usersApi } from '../../api/users.api';
import {
  Plus, Pencil, Users, ShoppingCart, X, ArrowUpDown, ArrowUp, ArrowDown, Building2, MapPin, HeartHandshake, User,
  FileBadge2, UserPlus, CheckCircle2, Moon, AlertTriangle, Filter, Award, Contact,
  Archive, RotateCcw } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import CustomFieldsEditor, { useCustomListColumns } from '../../components/custom-fields/CustomFieldsEditor';
import { customFieldsApi, useCustomFieldsForm, formatCfValue, type CfValues } from '../../api/custom-fields.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SelectFilter, PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';
import { RowMenu } from '../../components/ui/RowMenu';
import SalesPageShell from '../sales/SalesPageShell';
import { FilterChips } from '../sales/ListTemplate';
import { KpiGrid, KpiCard, Toolbar, SearchBar, Segmented, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

/**
 * Fichier clients (aligné sur le standard des listes ERP, cf. Achats › Fournisseurs) :
 * pipeline de situations cliquable, tableau trié et paginé, fiche en panneau.
 * Le volume reste faible : filtrage, tri et pagination côté client sur la liste complète.
 */

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export type CustomerType = 'particulier' | 'professionnel' | 'association' | 'revendeur';
type Customer = Record<string, any>;

export const TYPE_META: Record<CustomerType, { label: string; icon: typeof User }> = {
  particulier: { label: 'Particulier', icon: User },
  professionnel: { label: 'Société', icon: Building2 },
  association: { label: 'Association', icon: HeartHandshake },
  revendeur: { label: 'Revendeur', icon: ShoppingCart },
};
const TYPE_OPTIONS = (Object.keys(TYPE_META) as CustomerType[]).map(k => ({ key: k, label: TYPE_META[k].label }));

/** Niveau de fidélité (mig 372) : points gagnés sur 12 mois, niveaux paramétrés. */
function loyaltyTier(points12m: number, tiers: LoyaltyTier[]): { key: string; label: string; tag: string } | null {
  const t = tierOf(points12m, tiers);
  return t ? { key: t.code, label: t.label, tag: `odoo-tag-${t.color || 'blue'}` } : null;
}
function tierOptions(tiers: LoyaltyTier[]) {
  return [
    ...[...tiers].sort((a, b) => b.min_points - a.min_points).map(t => ({ key: t.code, label: `${t.label} (≥ ${t.min_points.toLocaleString('fr-FR')} pts / 12 mois)` })),
    { key: 'none', label: 'Sans niveau' },
  ];
}
function useLoyaltyTiers() {
  return useQuery({ queryKey: ['loyalty-tiers'], queryFn: loyaltyApi.tiers, staleTime: 300_000 }).data ?? [];
}

export function isMoral(t: string | undefined): boolean {
  return t === 'professionnel' || t === 'association' || t === 'revendeur';
}

export function displayName(c: Customer): { primary: string; secondary: string | null } {
  const personne = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  if (isMoral(c.customer_type) && c.company_name) {
    return { primary: c.company_name as string, secondary: personne || null };
  }
  return { primary: personne || 'Client', secondary: null };
}

/** Seuil au-delà duquel un client qui a déjà acheté est considéré comme dormant. */
const DORMANT_DAYS = 90;

/**
 * Situation de la relation client : une seule par client, la plus urgente d'abord.
 * - Fiche à compléter : société/revendeur sans ICE (facture non conforme) ou aucun moyen de contact.
 * - Jamais acheté, Dormant (> 90 j sans achat), Actif.
 */
const CUS_STAGES: StageDef[] = [
  { key: 'incomplete', label: 'Fiche à compléter', hint: 'ICE ou contact manquant', icon: FileBadge2 },
  { key: 'new', label: 'Sans achat', hint: 'jamais acheté', icon: UserPlus },
  { key: 'active', label: 'Actifs', hint: `achat < ${DORMANT_DAYS} j`, icon: CheckCircle2 },
  { key: 'dormant', label: 'Dormants', hint: `aucun achat depuis ${DORMANT_DAYS} j`, icon: Moon },
];
const STAGE_DOT: Record<string, string> = {
  incomplete: 'var(--ds-warning)', new: 'var(--ds-info)', active: 'var(--ds-success)', dormant: 'var(--ds-muted)',
};

export function needsIce(c: Customer): boolean {
  return (c.customer_type === 'professionnel' || c.customer_type === 'revendeur') && !c.ice;
}
function missingContact(c: Customer): boolean {
  return !c.phone && !c.email;
}
function purchasesCount(c: Customer): number {
  return (Number(c.orders_count) || 0) + (Number(c.sales_count) || 0);
}
function stageOf(c: Customer, today: Date): string {
  if (needsIce(c) || missingContact(c)) return 'incomplete';
  if (!c.last_purchase_at) return 'new';
  return differenceInDays(today, new Date(c.last_purchase_at)) > DORMANT_DAYS ? 'dormant' : 'active';
}

type SortKey = 'name' | 'city' | 'last_purchase' | 'purchases' | 'loyalty_points' | 'total_spent';

export const PAYMENT_LABELS: Record<string, string> = { cash: 'Espèces', card: 'Carte', mixed: 'Mixte', transfer: 'Virement', check: 'Chèque' };

const muted: React.CSSProperties = { color: 'var(--ds-muted)' };
const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), 'dd MMM yyyy', { locale: fr }) : null);

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [stage, setStage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const navigate = useNavigate();
  // ?edit=<id> : « Modifier » depuis la fiche client 360 ouvre le formulaire de cette page.
  const [urlParams, setUrlParams] = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>('total_spent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [archivedView, setArchivedView] = useState(false); // corbeille (phase 4.4)

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [searchTerm, typeFilter, tierFilter, cityFilter, stage, sortKey, sortDir, archivedView]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['customers', searchTerm, archivedView],
    queryFn: () => customersApi.list({ search: searchTerm, limit: '1000', ...(archivedView ? { archived: 'true' } : {}) }),
    placeholderData: (prev) => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: customersApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-global-stats'] });
      notify.success('Client archivé');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Impossible d\'archiver ce client')),
  });

  const restoreMutation = useMutation({
    mutationFn: customersApi.restore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      notify.success('Client restauré');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Impossible de restaurer ce client')),
  });

  const cfColumns = useCustomListColumns('customer');
  const saveMutation = useMutation({
    // Champs personnalisés (mig 369) enregistrés après la fiche, une fois l'id connu.
    mutationFn: async ({ payload, cf }: { payload: Customer; cf: CfValues | null }) => {
      const saved = editing ? await customersApi.update(editing.id as string, payload) : await customersApi.create(payload);
      const id = (editing?.id as string) ?? (saved as Customer)?.id;
      if (cf && id) await customFieldsApi.save('customer', id as string, cf);
      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-global-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      notify.success(editing ? 'Client mis à jour' : 'Client créé');
      setShowForm(false); setEditing(null);
    },
    onError: (e) => notify.error(apiErrorMessage(e, editing ? 'Impossible de mettre à jour le client' : 'Impossible de créer le client')),
  });

  const today = useMemo(() => new Date(), []);
  const tiers = useLoyaltyTiers();
  const customers = useMemo(
    () => ((data?.data || []) as Customer[]).map((c): Customer => ({ ...c, _stage: stageOf(c, today) })),
    [data, today],
  );

  // Filtres hors situation : la situation sert de pipeline, les cartes comptent sur ce sous-ensemble.
  const base = useMemo(() => customers.filter(c => {
    if (typeFilter && (c.customer_type || 'particulier') !== typeFilter) return false;
    if (cityFilter && (c.city || '').trim() !== cityFilter) return false;
    if (tierFilter) {
      const t = loyaltyTier(Number(c.points_12m) || 0, tiers);
      if (tierFilter === 'none' ? t !== null : t?.key !== tierFilter) return false;
    }
    return true;
  }), [customers, typeFilter, cityFilter, tierFilter, tiers]);

  const stageStats = useMemo(() => {
    const m: Record<string, { count: number; ca: number; noIce: number }> = {};
    for (const s of CUS_STAGES) m[s.key] = { count: 0, ca: 0, noIce: 0 };
    for (const c of base) {
      const st = m[c._stage];
      st.count++;
      st.ca += parseFloat(c.total_spent) || 0;
      if (needsIce(c)) st.noIce++;
    }
    return m;
  }, [base]);
  const totalCa = base.reduce((a, c) => a + (parseFloat(c.total_spent) || 0), 0);
  const totalPoints = base.reduce((a, c) => a + (Number(c.loyalty_points) || 0), 0);
  const noIceCount = customers.filter(needsIce).length;

  const cityOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customers) {
      const v = (c.city || '').trim();
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ key: k, label: `${k} (${v})` }));
  }, [customers]);

  const sorted = useMemo(() => {
    const rows = stage ? base.filter(c => c._stage === stage) : base;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = displayName(a).primary.localeCompare(displayName(b).primary); break;
        case 'city': cmp = (a.city || '').localeCompare(b.city || ''); break;
        case 'purchases': cmp = purchasesCount(a) - purchasesCount(b); break;
        case 'loyalty_points': cmp = (Number(a.loyalty_points) || 0) - (Number(b.loyalty_points) || 0); break;
        case 'total_spent': cmp = (parseFloat(a.total_spent) || 0) - (parseFloat(b.total_spent) || 0); break;
        case 'last_purchase': {
          const da = a.last_purchase_at ? new Date(a.last_purchase_at).getTime() : 0;
          const db = b.last_purchase_at ? new Date(b.last_purchase_at).getTime() : 0;
          cmp = da - db; break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [base, stage, sortKey, sortDir]);
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' || key === 'city' ? 'asc' : 'desc'); }
  };
  const sortableTh = (key: SortKey, label: string, align?: 'right', minWidth?: number) => (
    <th aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ textAlign: align, minWidth }}><button type="button" className="ds-sort" onClick={() => toggleSort(key)}>
      {label}{' '}
      {sortKey !== key
        ? <ArrowUpDown size={10} style={{ opacity: 0.3, verticalAlign: 'middle' }} />
        : sortDir === 'asc' ? <ArrowUp size={10} style={{ verticalAlign: 'middle' }} /> : <ArrowDown size={10} style={{ verticalAlign: 'middle' }} />}
    </button></th>
  );

  const hasFilters = !!(typeFilter || tierFilter || cityFilter || searchTerm);
  const resetFilters = () => { setTypeFilter(''); setTierFilter(''); setCityFilter(''); setSearchInput(''); setSearchTerm(''); };

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (c: Customer) => { setEditing(c); setShowForm(true); };
  const editId = urlParams.get('edit');
  useEffect(() => {
    if (!editId || !data) return;
    const target = ((data as { data?: Customer[] }).data ?? []).find(x => x.id === editId);
    if (target) openEdit(target);
    else customersApi.getById(editId).then(openEdit).catch(() => {});
    urlParams.delete('edit'); setUrlParams(urlParams, { replace: true });
  }, [editId, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const askDelete = async (c: Customer) => {
    const { primary } = displayName(c);
    // Archivage (phase 4.4) : le client garde son historique, il n'est pas effacé.
    if (await confirm(`Archiver le client « ${primary} » ? Il garde tout son historique et pourra être restauré.`, { title: 'Archiver un client', confirmLabel: 'Archiver', danger: true })) {
      deleteMutation.mutate(c.id as string);
    }
  };

  /** Prochaine action selon la situation (bouton principal de la ligne). */
  const nextAction = (c: Customer): { label: string; run: () => void } | null => {
    if (c._stage === 'incomplete') return { label: needsIce(c) ? 'Saisir l\'ICE' : 'Compléter la fiche', run: () => openEdit(c) };
    return null;
  };
  const stageDetail = (c: Customer): string | null => {
    if (c._stage === 'incomplete') return needsIce(c) ? 'ICE manquant' : 'ni téléphone ni email';
    if (c._stage === 'dormant' && c.last_purchase_at) return `${differenceInDays(today, new Date(c.last_purchase_at))} j sans achat`;
    return null;
  };

  return (
    <SalesPageShell icon={Users} parent="Ventes" title="Clients" list
      summary={`${base.length} client${base.length > 1 ? 's' : ''} · ${money(totalCa)} de CA`}
      actions={<button type="button" onClick={openNew} className="odoo-btn-primary"><Plus size={13} /> Nouveau client</button>}>
        {noIceCount > 0 && (
          <StatusBanner tone="warning" icon={AlertTriangle}
            title={`${noIceCount} client${noIceCount > 1 ? 's' : ''} professionnel${noIceCount > 1 ? 's' : ''} sans ICE`}
            actions={stage !== 'incomplete' ? (
              <button type="button" className="odoo-btn-secondary" onClick={() => setStage('incomplete')}>Les afficher</button>
            ) : undefined}>
            Une facture adressée à une entreprise doit porter son ICE : sans lui, elle n'est pas conforme et le client peut la refuser.
          </StatusBanner>
        )}

        <KpiGrid>
          <KpiCard label="Clients" value={String(base.length)} sub={`${totalPoints.toLocaleString('fr-FR')} points de fidélité`} />
          <KpiCard label="CA cumulé" value={money(totalCa)} sub="commandes et ventes en caisse" />
          <KpiCard label="Actifs" value={String(stageStats.active.count)} sub={money(stageStats.active.ca)} />
          <KpiCard label="Dormants" value={String(stageStats.dormant.count)} sub={`aucun achat depuis ${DORMANT_DAYS} j · ${money(stageStats.dormant.ca)}`} tone={stageStats.dormant.count ? 'orange' : undefined} />
        </KpiGrid>

        <FilterChips label="Filtrer par situation" value={stage} onChange={setStage} chips={[
          { key: '', label: 'Tous', count: base.length },
          ...CUS_STAGES.map(s => ({ key: s.key, label: s.label, count: stageStats[s.key].count, tone: s.key === 'incomplete' && stageStats[s.key].noIce ? 'late' as const : undefined })),
        ]} />

        <Toolbar>
          <SearchBar value={searchInput} onChange={setSearchInput} label="Rechercher un client"
            placeholder="Nom, société, téléphone, email, ville ou ICE…" busy={isFetching && !isLoading} />
          <SelectFilter label="Type" icon={Filter} value={typeFilter} onChange={setTypeFilter} options={TYPE_OPTIONS} />
          <SelectFilter label="Fidélité" icon={Award} value={tierFilter} onChange={setTierFilter} options={tierOptions(tiers)} />
          <SelectFilter label="Ville" icon={MapPin} value={cityFilter} onChange={setCityFilter} options={cityOptions} allLabel="Toutes" />
          {hasFilters && (
            <button type="button" onClick={resetFilters} className="ds-btn-ghost ds-btn-sm"><X size={12} /> Effacer les filtres</button>
          )}
          <Segmented label="Fiches" value={archivedView ? 'archived' : 'active'} onChange={k => setArchivedView(k === 'archived')} options={[
            { key: 'active', label: 'Actifs' },
            { key: 'archived', label: 'Archivés', icon: Archive },
          ]} />
        </Toolbar>

        {isLoading ? (
          <LoadingState label="Chargement des clients…" />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : sorted.length === 0 ? (
          hasFilters || stage
            ? <NoResultState onReset={() => { resetFilters(); setStage(''); }} text="Aucun client ne correspond aux filtres." />
            : <EmptyState icon={Users} title={archivedView ? 'Aucun client archivé' : 'Aucun client'}
                text={archivedView ? undefined : 'Les fiches clients servent aux commandes, aux factures et à la fidélité.'}
                action={archivedView ? undefined : <button type="button" onClick={openNew} className="odoo-btn-secondary ds-btn-sm"><Plus size={13} /> Nouveau client</button>} />
        ) : (
          <div style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <DataPanel label="Clients" footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={sorted.length} onPage={setPage}
            note={`client${sorted.length > 1 ? 's' : ''} · dormant au-delà de ${DORMANT_DAYS} jours sans achat`} />}>
            <table className="odoo-table">
              <thead>
                <tr>
                  {sortableTh('name', 'Client', undefined, 180)}
                  <th>Type</th>
                  <th>Contact</th>
                  {sortableTh('city', 'Ville')}
                  <th>ICE</th>
                  <th style={{ minWidth: 170 }}>Situation</th>
                  {sortableTh('last_purchase', 'Dernier achat')}
                  {sortableTh('purchases', 'Achats', 'right')}
                  {sortableTh('loyalty_points', 'Fidélité (pts)', 'right')}
                  {sortableTh('total_spent', `CA cumulé (${currencySymbol()})`, 'right')}
                  {cfColumns.map(d => <th key={d.id}>{d.label}</th>)}
                  <th className="ds-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(c => {
                  const type = (c.customer_type as CustomerType) || 'particulier';
                  const meta = TYPE_META[type] || TYPE_META.particulier;
                  const TypeIcon = meta.icon;
                  const { primary, secondary } = displayName(c);
                  const points = Number(c.loyalty_points) || 0;
                  const tier = loyaltyTier(Number(c.points_12m) || 0, tiers);
                  const spent = parseFloat(c.total_spent) || 0;
                  const action = nextAction(c);
                  const detail = stageDetail(c);
                  return (
                    <tr key={c.id as string} onClick={() => navigate(`/customers/${c.id as string}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span className="ds-strong">{primary}</span>
                        {secondary && <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{secondary}{c.contact_role ? ` · ${c.contact_role}` : ''}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', ...muted }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><TypeIcon size={11} /> {meta.label}</span>
                      </td>
                      <td style={muted}>
                        {c.phone && <div>{c.phone}</div>}
                        {c.email && <div style={{ fontSize: '12px' }}>{c.email}</div>}
                        {!c.phone && !c.email && '—'}
                      </td>
                      <td style={muted}>{c.city || '—'}</td>
                      <td style={{ fontSize: '12px' }}>
                        {c.ice ? (
                          <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--ds-ink)' }}>{c.ice}</span>
                        ) : needsIce(c) ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ds-warning)', fontWeight: 600, fontSize: '12px' }}>
                            <AlertTriangle size={11} /> À saisir
                          </span>
                        ) : <span style={muted}>—</span>}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '13px', fontWeight: 500, color: 'var(--ds-ink)' }}>
                          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: STAGE_DOT[c._stage] }} />
                          {CUS_STAGES.find(s => s.key === c._stage)?.label}
                        </span>
                        {detail && <div style={{ fontSize: '12px', color: 'var(--ds-muted)', marginTop: 2, marginLeft: 14 }}>{detail}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', ...muted }}>
                        {fmtDate(c.last_purchase_at) ?? <span style={{ fontStyle: 'italic' }}>jamais</span>}
                      </td>
                      <td className="ds-num">{purchasesCount(c) || <span style={muted}>—</span>}</td>
                      <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>
                        {points > 0 ? points.toLocaleString('fr-FR') : <span style={muted}>—</span>}
                        {tier && <div><span className={`odoo-tag ${tier.tag}`}>{tier.label}</span></div>}
                      </td>
                      <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>
                        {spent > 0 ? <span className="ds-strong">{n(spent)}</span> : <span style={muted}>—</span>}
                      </td>
                      {cfColumns.map(d => <td key={d.id} style={muted}>{formatCfValue(d, (c.custom_fields as CfValues | undefined)?.[d.code]) || '—'}</td>)}
                      <td className="ds-actions" onClick={e => e.stopPropagation()}>
                        {action && <button type="button" onClick={action.run} className="odoo-btn-secondary ds-btn-sm">{action.label}</button>}
                        <RowMenu items={[
                          { label: 'Voir la fiche', icon: Contact, onSelect: () => navigate(`/customers/${c.id as string}`) },
                          { label: 'Modifier', icon: Pencil, onSelect: () => openEdit(c) },
                          archivedView
                            ? { label: 'Restaurer', icon: RotateCcw, onSelect: () => restoreMutation.mutate(c.id as string) }
                            : { label: 'Archiver', icon: Archive, danger: true, onSelect: () => askDelete(c) },
                        ]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataPanel>
          </div>
        )}

      {showForm && (
        <CustomerFormModal
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSubmit={(payload, cf) => saveMutation.mutate({ payload, cf })}
          isPending={saveMutation.isPending}
        />
      )}
    </SalesPageShell>
  );
}

/* La fiche client est une page : CustomerRecordPage.tsx (route /customers/:id). */

/* ═══════════════════════ FORMULAIRE CLIENT ═══════════════════════ */
function CustomerFormModal({ editing, onClose, onSubmit, isPending }: {
  editing: Customer | null;
  onClose: () => void;
  onSubmit: (data: Customer, cf: CfValues | null) => void;
  isPending: boolean;
}) {
  const cf = useCustomFieldsForm('customer', editing?.custom_fields);
  // Type de client et conditions commerciales : direction seulement (O2C L0, G-CR-04).
  const { user } = useAuth();
  const direction = user?.role === 'admin' || user?.role === 'manager';
  const [customerType, setCustomerType] = useState<CustomerType>(
    (editing?.customer_type as CustomerType) || 'particulier'
  );
  const [tvaExonere, setTvaExonere] = useState<boolean>(
    editing?.tva_exonere === true || editing?.customer_type === 'association'
  );
  const [salespersonId, setSalespersonId] = useState<string>(
    (editing as Record<string, any> | null)?.salesperson_id || ''
  );
  const [parentCustomerId, setParentCustomerId] = useState<string>(
    (editing as Record<string, any> | null)?.parent_customer_id || ''
  );
  const [payerCustomerId, setPayerCustomerId] = useState<string>(
    (editing as Record<string, any> | null)?.payer_customer_id || ''
  );
  const isMoralEntity = isMoral(customerType);
  const title = editing ? displayName(editing).primary : 'Nouveau';
  // Partenaires possibles (entité mère / payeur) : autres clients B2B (phase 4.2).
  const { data: partnersResp } = useQuery({ queryKey: ['customers', 'partners'], queryFn: () => customersApi.list({ limit: '1000' }) });
  const partnerOptions = (((partnersResp?.data as Customer[]) || []).filter(c => isMoral(c.customer_type) && c.id !== editing?.id));
  const ed = editing as Record<string, any> | null;
  // Commercial attitré (phase 4.5) : utilisateurs actifs.
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const salespeople = ((users as Record<string, any>[]) || []).filter(u => u.isActive !== false);
  // Doublon d'ICE signalé (phase 4.3) : vérifié au blur, bloque rien (signal).
  const [iceDup, setIceDup] = useState<string | null>(null);
  const checkIce = async (val: string) => {
    const v = val.trim();
    if (!v || !/^\d{15}$/.test(v)) { setIceDup(null); return; }
    try {
      const dups = await customersApi.check({ ice: v, excludeId: editing?.id as string | undefined });
      setIceDup(dups.length ? `ICE déjà utilisé par « ${dups[0].name} »` : null);
    } catch { setIceDup(null); }
  };

  const [dirty, setDirty] = useState(false);
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, monospace' };

  return (
    <form onChange={() => setDirty(true)} onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload: Customer = Object.fromEntries(fd);
      payload.tvaExonere = tvaExonere;
      payload.salespersonId = salespersonId || '';
      payload.parentCustomerId = parentCustomerId || '';
      payload.payerCustomerId = payerCustomerId || '';
      const missing = cf.missing();
      if (missing.length) { notify.error(`À renseigner : ${missing.join(', ')}`); return; }
      onSubmit(payload, cf.defs.length ? cf.values : null);
    }}>
    <Modal title={editing ? title : 'Nouveau client'} subtitle={editing ? 'Client' : undefined} onClose={onClose} width={680} locked={isPending}
      footer={<FormFooter dirty={dirty} onCancel={onClose} busy={isPending} submitLabel={editing ? 'Enregistrer' : 'Créer le client'} />}>
      <FormSection title="Type de client">
        <div className="odoo-view-switcher" role="radiogroup" aria-label="Type de client" style={{ alignSelf: 'flex-start' }}>
          {(Object.keys(TYPE_META) as CustomerType[]).map(t => {
            const Icon = TYPE_META[t].icon;
            const selected = customerType === t;
            return (
              <button type="button" key={t} role="radio" aria-checked={selected}
                disabled={!direction && !selected}
                title={!direction && !selected ? 'Type de client : réservé à la direction' : undefined}
                onClick={() => {
                  setDirty(true);
                  setCustomerType(t);
                  if (t === 'association') setTvaExonere(true);
                  else if (t === 'particulier') setTvaExonere(false);
                }}
                style={{
                  padding: '0.35rem 0.85rem', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: selected ? 'var(--ds-tint)' : 'transparent',
                  color: selected ? 'var(--ds-accent)' : 'var(--ds-muted)',
                  fontWeight: selected ? 600 : 400,
                }}>
                <Icon size={13} /> {TYPE_META[t].label}
              </button>
            );
          })}
        </div>
        <input type="hidden" name="customerType" value={customerType} />
      </FormSection>

      {isMoralEntity && (
        <FormSection title={customerType === 'association' ? 'Identité de l\'association' : 'Identité de l\'entreprise'}>
          <FormField label="Raison sociale" htmlFor="cf-company" required>
            <input id="cf-company" name="companyName" defaultValue={editing?.company_name} className="ds-input" required autoFocus
              placeholder={customerType === 'association' ? 'Association X' : 'Pâtisserie du Coin SARL'} />
          </FormField>
          {customerType !== 'association' && (
            <div className="ds-form-grid">
              <FormField label="Forme juridique" htmlFor="cf-forme">
                <select id="cf-forme" name="formeJuridique" defaultValue={editing?.forme_juridique || ''} className="ds-input">
                  <option value="">—</option>
                  <option value="SARL">SARL</option>
                  <option value="SARL AU">SARL AU (associé unique)</option>
                  <option value="SA">SA</option>
                  <option value="SAS">SAS</option>
                  <option value="SNC">SNC</option>
                  <option value="AE">Auto-entrepreneur</option>
                  <option value="Coop">Coopérative</option>
                  <option value="GIE">GIE</option>
                  <option value="Autre">Autre</option>
                </select>
              </FormField>
              <FormField label="Ville RC" htmlFor="cf-rcville">
                <input id="cf-rcville" name="rcVille" defaultValue={editing?.rc_ville} className="ds-input" placeholder="Casablanca" />
              </FormField>
            </div>
          )}
        </FormSection>
      )}

      {isMoralEntity && (
        <FormSection title="Identifiants légaux">
          {customerType !== 'association' ? (
            <div className="ds-form-grid">
              <FormField label={`ICE${customerType === 'professionnel' || customerType === 'revendeur' ? ' (requis pour facturer)' : ''}`} htmlFor="cf-ice" hint="15 chiffres">
                <input id="cf-ice" name="ice" defaultValue={editing?.ice} className="ds-input" style={mono}
                  maxLength={15} pattern="[0-9]{15}" title="15 chiffres" placeholder="000000000000000"
                  onBlur={e => checkIce(e.target.value)} />
              </FormField>
              <FormField label="IF (identifiant fiscal)" htmlFor="cf-if">
                <input id="cf-if" name="ifFiscal" defaultValue={editing?.if_fiscal} className="ds-input" style={mono} placeholder="12345678" />
              </FormField>
              {iceDup && <div style={{ gridColumn: '1 / -1' }}><StatusBanner tone="warning" icon={AlertTriangle} title="Doublon d'ICE possible">{iceDup}</StatusBanner></div>}
              <FormField label="RC (n°)" htmlFor="cf-rc">
                <input id="cf-rc" name="rc" defaultValue={editing?.rc} className="ds-input" style={mono} placeholder="123456" />
              </FormField>
              <FormField label="TP (taxe professionnelle)" htmlFor="cf-tp">
                <input id="cf-tp" name="tp" defaultValue={editing?.tp} className="ds-input" style={mono} placeholder="30123456" />
              </FormField>
              <FormField label="CNSS (employeur)" htmlFor="cf-cnss">
                <input id="cf-cnss" name="cnss" defaultValue={editing?.cnss} className="ds-input" style={mono} placeholder="1234567" />
              </FormField>
            </div>
          ) : (
            <div className="ds-form-grid">
              <FormField label="N° récépissé" htmlFor="cf-recepisse">
                <input id="cf-recepisse" name="associationRecepisse" defaultValue={editing?.association_recepisse} className="ds-input" style={mono} placeholder="Récépissé de déclaration" />
              </FormField>
              <FormField label="IF (si assujettie)" htmlFor="cf-if-asso">
                <input id="cf-if-asso" name="ifFiscal" defaultValue={editing?.if_fiscal} className="ds-input" style={mono} placeholder="Optionnel" />
              </FormField>
              <FormField label="Président" htmlFor="cf-president">
                <input id="cf-president" name="president" defaultValue={editing?.president} className="ds-input" placeholder="Nom du président" />
              </FormField>
            </div>
          )}
          {/* Rôles partenaires (phase 4.2) : entité mère + payeur */}
          <div className="ds-form-grid">
            <FormField label="Entité mère">
              <SearchSelect value={parentCustomerId} onChange={v => { setDirty(true); setParentCustomerId(v); }}
                placeholder="— Aucune" width="100%" size="md" ariaLabel="Entité mère"
                options={partnerOptions.map(c => ({ id: c.id as string, label: displayName(c).primary }))} />
            </FormField>
            <FormField label="Payeur (si différent)" hint="La facture part au payeur ; le BL reste au nom du client.">
              <SearchSelect value={payerCustomerId} onChange={v => { setDirty(true); setPayerCustomerId(v); }}
                placeholder="— Le client paie lui-même" width="100%" size="md" ariaLabel="Payeur"
                options={partnerOptions.map(c => ({ id: c.id as string, label: displayName(c).primary }))} />
            </FormField>
          </div>
          {/* Commercial attitré (phase 4.5) : repris sur devis, commande, BL, facture */}
          <FormField label="Commercial attitré">
            <SearchSelect value={salespersonId} onChange={v => { setDirty(true); setSalespersonId(v); }}
              placeholder="— Aucun" width="100%" size="md" ariaLabel="Commercial attitré"
              options={salespeople.map(u => ({ id: u.id as string, label: `${u.firstName as string} ${u.lastName as string}` }))} />
          </FormField>
          <label htmlFor="cf-tva-exo" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
            <input id="cf-tva-exo" type="checkbox" checked={tvaExonere} disabled={!direction} onChange={(e) => setTvaExonere(e.target.checked)} />
            Client exonéré de TVA
          </label>
        </FormSection>
      )}

      <FormSection title={isMoralEntity ? 'Contact principal (optionnel)' : 'Identité'}>
        <div className="ds-form-grid">
          <FormField label="Prénom" htmlFor="cf-first" required={!isMoralEntity}>
            <input id="cf-first" name="firstName" defaultValue={editing?.first_name} className="ds-input" required={!isMoralEntity} autoFocus={!isMoralEntity} placeholder="Mohamed" />
          </FormField>
          <FormField label="Nom" htmlFor="cf-last" required={!isMoralEntity}>
            <input id="cf-last" name="lastName" defaultValue={editing?.last_name} className="ds-input" required={!isMoralEntity} placeholder="Alami" />
          </FormField>
          {isMoralEntity ? (
            <FormField label="Fonction / rôle" htmlFor="cf-role">
              <input id="cf-role" name="contactRole" defaultValue={editing?.contact_role} className="ds-input"
                placeholder={customerType === 'association' ? 'Trésorier, secrétaire…' : 'Gérant, acheteur, comptable…'} />
            </FormField>
          ) : (
            <FormField label="Date de naissance" htmlFor="cf-birthday">
              <input id="cf-birthday" name="birthday" type="date" defaultValue={editing?.birthday ? (editing.birthday as string).slice(0, 10) : ''} className="ds-input" />
            </FormField>
          )}
        </div>
      </FormSection>

      <FormSection title="Contact">
        <div className="ds-form-grid">
          <FormField label="Téléphone" htmlFor="cf-phone">
            <input id="cf-phone" name="phone" defaultValue={editing?.phone} className="ds-input" placeholder="06 XX XX XX XX" />
          </FormField>
          <FormField label="Email" htmlFor="cf-email">
            <input id="cf-email" name="email" type="email" defaultValue={editing?.email} className="ds-input" placeholder="client@exemple.com" />
          </FormField>
        </div>
        <div className="ds-field" role="radiogroup" aria-labelledby="cf-pref-label">
          <span id="cf-pref-label" className="ds-field-label">Contact préféré</span>
          <div style={{ display: 'flex', gap: 16, fontSize: '13px' }}>
            {(['phone', 'email', 'whatsapp'] as const).map(m => (
              <label key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="preferredContact" value={m}
                  defaultChecked={(editing?.preferred_contact || 'phone') === m} />
                {m === 'phone' ? 'Téléphone' : m === 'email' ? 'Email' : 'WhatsApp'}
              </label>
            ))}
          </div>
        </div>
      </FormSection>

      <FormSection title={isMoralEntity ? 'Adresse du siège' : 'Adresse'}>
        <div className="ds-form-grid">
          <FormField label="Adresse" htmlFor="cf-address">
            <input id="cf-address" name="address" defaultValue={editing?.address} className="ds-input" placeholder="123 rue Mohammed V" />
          </FormField>
          <FormField label="Ville" htmlFor="cf-city">
            <input id="cf-city" name="city" defaultValue={editing?.city} className="ds-input" placeholder="Casablanca" />
          </FormField>
        </div>
      </FormSection>

      {customerType !== 'particulier' && (
        <FormSection title={`Conditions commerciales${!direction ? ' (fixées par la direction)' : ''}`}>
          <div className="ds-form-grid cols-4">
            <FormField label={`Plafond de crédit (${currencySymbol()})`} htmlFor="cf-credit">
              <input id="cf-credit" name="creditLimit" disabled={!direction} type="number" step="0.01" min="0" defaultValue={editing?.credit_limit} className="ds-input" placeholder="10000" />
            </FormField>
            <FormField label="Remise (%)" htmlFor="cf-remise">
              <input id="cf-remise" name="remisePct" disabled={!direction} type="number" step="0.01" min="0" max="100" defaultValue={editing?.remise_pct} className="ds-input" placeholder="5" />
            </FormField>
            <FormField label="Délai de paiement (jours)" htmlFor="cf-delai">
              <input id="cf-delai" name="delaiPaiementJours" disabled={!direction} type="number" step="1" min="0" defaultValue={editing?.delai_paiement_jours} className="ds-input" placeholder="30" />
            </FormField>
            <FormField label="Facturation" htmlFor="cf-billing">
              <select id="cf-billing" name="billingFrequency" disabled={!direction} defaultValue={editing?.billing_frequency || 'monthly'} className="ds-input"
                title="À chaque livraison : la facture suit le bon de livraison. Mensuelle : les BL sont regroupés sur une facture.">
                <option value="monthly">Mensuelle (BL regroupés)</option>
                <option value="per_delivery">À chaque livraison</option>
              </select>
            </FormField>
          </div>
        </FormSection>
      )}

      <FormSection title="Préférences et notes">
        {customerType === 'particulier' && (
          <FormField label="Allergies / restrictions" htmlFor="cf-allergies">
            <input id="cf-allergies" name="allergies" defaultValue={editing?.allergies} className="ds-input" placeholder="Gluten, lactose, fruits à coque…" />
          </FormField>
        )}
        <FormField label="Notes internes" htmlFor="cf-notes">
          <textarea id="cf-notes" name="notes" defaultValue={editing?.notes} rows={2} className="ds-input" placeholder="Préférences, habitudes, informations utiles…" />
        </FormField>
        <CustomFieldsEditor entity="customer" values={cf.values} onChange={v => { setDirty(true); cf.setValues(v); }} />
      </FormSection>
    </Modal>
    </form>
  );
}
