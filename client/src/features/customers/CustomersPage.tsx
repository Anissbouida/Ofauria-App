import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../api/customers.api';
import {
  Plus, Search, Pencil, Star, Trash2, Users, ShoppingCart, Receipt, X, Loader2, Phone, Mail,
  ArrowUpDown, ArrowUp, ArrowDown, Building2, MapPin, HeartHandshake, FileText, CreditCard, User,
  FileBadge2, UserPlus, CheckCircle2, Moon, AlertTriangle, Filter, Award, MessageSquare, Contact,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import {
  StagePipeline, SelectFilter, Pager, PAGE_SIZE, type StageDef,
} from '../../components/purchasing/ProcessBoard';

/**
 * Fichier clients (aligné sur le standard des listes ERP, cf. Achats › Fournisseurs) :
 * pipeline de situations cliquable, tableau trié et paginé, fiche en panneau.
 * Le volume reste faible : filtrage, tri et pagination côté client sur la liste complète.
 */

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

type CustomerType = 'particulier' | 'professionnel' | 'association' | 'revendeur';
type Customer = Record<string, any>;

const TYPE_META: Record<CustomerType, { label: string; icon: typeof User }> = {
  particulier: { label: 'Particulier', icon: User },
  professionnel: { label: 'Société', icon: Building2 },
  association: { label: 'Association', icon: HeartHandshake },
  revendeur: { label: 'Revendeur', icon: ShoppingCart },
};
const TYPE_OPTIONS = (Object.keys(TYPE_META) as CustomerType[]).map(k => ({ key: k, label: TYPE_META[k].label }));

function loyaltyTier(points: number): { key: string; label: string; tag: string } | null {
  if (points >= 5000) return { key: 'or', label: 'Or', tag: 'odoo-tag-yellow' };
  if (points >= 2000) return { key: 'argent', label: 'Argent', tag: 'odoo-tag-grey' };
  if (points >= 500) return { key: 'bronze', label: 'Bronze', tag: 'odoo-tag-orange' };
  return null;
}
const TIER_OPTIONS = [
  { key: 'or', label: 'Or (≥ 5 000 pts)' },
  { key: 'argent', label: 'Argent (≥ 2 000 pts)' },
  { key: 'bronze', label: 'Bronze (≥ 500 pts)' },
  { key: 'none', label: 'Sans niveau' },
];

function isMoral(t: string | undefined): boolean {
  return t === 'professionnel' || t === 'association' || t === 'revendeur';
}

function displayName(c: Customer): { primary: string; secondary: string | null } {
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
  incomplete: '#d9822b', new: '#3b82f6', active: '#28a745', dormant: '#adb5bd',
};

function needsIce(c: Customer): boolean {
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

const ORDER_STATUS: Record<string, { label: string; tag: string }> = {
  pending: { label: 'En attente', tag: 'odoo-tag-yellow' },
  confirmed: { label: 'Confirmée', tag: 'odoo-tag-blue' },
  in_production: { label: 'En production', tag: 'odoo-tag-purple' },
  ready: { label: 'Prête', tag: 'odoo-tag-green' },
  completed: { label: 'Terminée', tag: 'odoo-tag-green' },
  cancelled: { label: 'Annulée', tag: 'odoo-tag-grey' },
};
const PAYMENT_LABELS: Record<string, string> = { cash: 'Espèces', card: 'Carte', mixed: 'Mixte', transfer: 'Virement', check: 'Chèque' };

const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 };
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';
const sectionTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--theme-text-muted)', margin: '6px 0 2px' };
const muted: React.CSSProperties = { color: 'var(--theme-text-muted)' };
const panelStyle: React.CSSProperties = { width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 };
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total_spent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [searchTerm, typeFilter, tierFilter, cityFilter, stage, sortKey, sortDir]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['customers', searchTerm],
    queryFn: () => customersApi.list({ search: searchTerm, limit: '1000' }),
    placeholderData: (prev) => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: customersApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-global-stats'] });
      notify.success('Client supprimé');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Impossible de supprimer ce client (commandes ou ventes liées)')),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Customer) =>
      editing ? customersApi.update(editing.id as string, payload) : customersApi.create(payload),
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
  const customers = useMemo(
    () => ((data?.data || []) as Customer[]).map((c): Customer => ({ ...c, _stage: stageOf(c, today) })),
    [data, today],
  );

  // Filtres hors situation : la situation sert de pipeline, les cartes comptent sur ce sous-ensemble.
  const base = useMemo(() => customers.filter(c => {
    if (typeFilter && (c.customer_type || 'particulier') !== typeFilter) return false;
    if (cityFilter && (c.city || '').trim() !== cityFilter) return false;
    if (tierFilter) {
      const t = loyaltyTier(Number(c.loyalty_points) || 0);
      if (tierFilter === 'none' ? t !== null : t?.key !== tierFilter) return false;
    }
    return true;
  }), [customers, typeFilter, cityFilter, tierFilter]);

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
    <th onClick={() => toggleSort(key)} aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align, minWidth }}>
      {label}{' '}
      {sortKey !== key
        ? <ArrowUpDown size={10} style={{ opacity: 0.3, verticalAlign: 'middle' }} />
        : sortDir === 'asc' ? <ArrowUp size={10} style={{ verticalAlign: 'middle' }} /> : <ArrowDown size={10} style={{ verticalAlign: 'middle' }} />}
    </th>
  );

  const hasFilters = !!(typeFilter || tierFilter || cityFilter || searchTerm);
  const resetFilters = () => { setTypeFilter(''); setTierFilter(''); setCityFilter(''); setSearchInput(''); setSearchTerm(''); };

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (c: Customer) => { setSelectedId(null); setEditing(c); setShowForm(true); };
  const askDelete = async (c: Customer) => {
    const { primary } = displayName(c);
    if (await confirm(`Supprimer le client « ${primary} » ? Impossible s'il a des commandes ou des ventes.`, { title: 'Supprimer un client', confirmLabel: 'Supprimer', danger: true })) {
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
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <Users size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Clients</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">Fichier clients</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={openNew} className="odoo-btn-primary">
          <Plus size={13} /> Nouveau client
        </button>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {noIceCount > 0 && (
          <StatusBanner tone="warning" icon={AlertTriangle}
            title={`${noIceCount} client${noIceCount > 1 ? 's' : ''} professionnel${noIceCount > 1 ? 's' : ''} sans ICE`}
            actions={stage !== 'incomplete' ? (
              <button type="button" className="odoo-btn-secondary" onClick={() => setStage('incomplete')}>Les afficher</button>
            ) : undefined}>
            Une facture adressée à une entreprise doit porter son ICE : sans lui, elle n'est pas conforme et le client peut la refuser.
          </StatusBanner>
        )}

        <StagePipeline
          title="Où en sont mes clients"
          summary={`${base.length} client${base.length > 1 ? 's' : ''} · ${n(totalCa)} DH de CA · ${totalPoints.toLocaleString('fr-FR')} points`}
          stages={CUS_STAGES}
          stats={Object.fromEntries(CUS_STAGES.map(s => {
            const st = stageStats[s.key];
            const sub = s.key === 'active' || s.key === 'dormant' ? `${n(st.ca)} DH` : '';
            return [s.key, { count: st.count, sub, late: s.key === 'incomplete' ? st.noIce : 0, alertLabel: 'sans ICE' }];
          }))}
          isActive={k => stage === k}
          onPick={k => setStage(stage === k ? '' : k)}
        />

        <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
          <Search size={14} style={{ ...muted, flexShrink: 0 }} />
          <input type="text" placeholder="Rechercher par nom, société, téléphone, email, ville ou ICE"
            aria-label="Rechercher un client"
            value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input"
            style={{ flex: '1 1 220px', minWidth: 0 }} />
          {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={muted} />}
          <SelectFilter label="Type" icon={Filter} value={typeFilter} onChange={setTypeFilter} options={TYPE_OPTIONS} />
          <SelectFilter label="Fidélité" icon={Award} value={tierFilter} onChange={setTierFilter} options={TIER_OPTIONS} />
          <SelectFilter label="Ville" icon={MapPin} value={cityFilter} onChange={setCityFilter} options={cityOptions} allLabel="Toutes" />
          {stage && (
            <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Situation : {CUS_STAGES.find(s => s.key === stage)?.label}
              <button type="button" onClick={() => setStage('')} aria-label="Retirer le filtre de situation" style={{ display: 'inline-flex' }}>
                <X size={11} />
              </button>
            </span>
          )}
          {hasFilters && (
            <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <X size={12} /> Effacer les filtres
            </button>
          )}
        </div>

        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', ...muted }}>
            <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
            <p style={{ fontSize: '0.8125rem' }}>Chargement des clients...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', ...muted }}>
            <Users size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {stage ? 'Aucun client dans cette situation' : 'Aucun client'}
            </p>
            {(hasFilters || stage) && (
              <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>
                Aucun résultat pour ces filtres —{' '}
                <button type="button" onClick={() => { resetFilters(); setStage(''); }} style={{ textDecoration: 'underline', color: 'inherit' }}>les effacer</button>
              </p>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
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
                  {sortableTh('loyalty_points', 'Fidélité', 'right')}
                  {sortableTh('total_spent', 'CA cumulé', 'right')}
                  <th style={{ textAlign: 'right' }}>Prochaine action</th>
                  <th style={{ textAlign: 'right', width: 70 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(c => {
                  const type = (c.customer_type as CustomerType) || 'particulier';
                  const meta = TYPE_META[type] || TYPE_META.particulier;
                  const TypeIcon = meta.icon;
                  const { primary, secondary } = displayName(c);
                  const points = Number(c.loyalty_points) || 0;
                  const tier = loyaltyTier(points);
                  const spent = parseFloat(c.total_spent) || 0;
                  const action = nextAction(c);
                  const detail = stageDetail(c);
                  return (
                    <tr key={c.id as string} onClick={() => setSelectedId(c.id as string)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span style={{ fontWeight: 500 }}>{primary}</span>
                        {secondary && <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{secondary}{c.contact_role ? ` · ${c.contact_role}` : ''}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', ...muted }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><TypeIcon size={11} /> {meta.label}</span>
                      </td>
                      <td style={muted}>
                        {c.phone && <div>{c.phone}</div>}
                        {c.email && <div style={{ fontSize: '0.6875rem' }}>{c.email}</div>}
                        {!c.phone && !c.email && '—'}
                      </td>
                      <td style={muted}>{c.city || '—'}</td>
                      <td style={{ fontSize: '0.6875rem' }}>
                        {c.ice ? (
                          <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--odoo-text)' }}>{c.ice}</span>
                        ) : needsIce(c) ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#b85d1a', fontWeight: 600, fontSize: '0.75rem' }}>
                            <AlertTriangle size={11} /> À saisir
                          </span>
                        ) : <span style={muted}>—</span>}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--odoo-text)' }}>
                          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: STAGE_DOT[c._stage] }} />
                          {CUS_STAGES.find(s => s.key === c._stage)?.label}
                        </span>
                        {detail && <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginTop: 2, marginLeft: 14 }}>{detail}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', ...muted }}>
                        {fmtDate(c.last_purchase_at) ?? <span style={{ fontStyle: 'italic' }}>jamais</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{purchasesCount(c) || <span style={muted}>—</span>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {points > 0 ? <>{points.toLocaleString('fr-FR')} <span style={{ ...muted, fontSize: '0.6875rem' }}>pts</span></> : <span style={muted}>—</span>}
                        {tier && <div><span className={`odoo-tag ${tier.tag}`}>{tier.label}</span></div>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {spent > 0 ? <><span style={{ fontWeight: 600 }}>{n(spent)}</span> <span style={{ ...muted, fontSize: '0.6875rem' }}>DH</span></>
                          : <span style={muted}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        {action && <button type="button" onClick={action.run} className="odoo-btn-primary">{action.label}</button>}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          <button onClick={() => openEdit(c)} className="odoo-pager-btn" title="Modifier" aria-label="Modifier"><Pencil size={13} /></button>
                          <button onClick={() => askDelete(c)} className="odoo-pager-btn" title="Supprimer" aria-label="Supprimer" style={{ color: '#dc3545' }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={page} total={sorted.length} onPage={setPage}
              note={`Situation calculée sur le dernier achat (commande ou vente caisse) — dormant au-delà de ${DORMANT_DAYS} jours.`} />
          </div>
        )}
      </div>

      {selectedId && (
        <CustomerDetailPanel
          customerId={selectedId}
          onClose={() => setSelectedId(null)}
          onEdit={openEdit}
        />
      )}

      {showForm && (
        <CustomerFormModal
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSubmit={(payload) => saveMutation.mutate(payload)}
          isPending={saveMutation.isPending}
        />
      )}
    </div>
  );
}

/* ═══════════════════════ FICHE CLIENT ═══════════════════════ */
function CustomerDetailPanel({ customerId, onClose, onEdit }: {
  customerId: string;
  onClose: () => void;
  onEdit: (c: Customer) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-stats', customerId],
    queryFn: () => customersApi.stats(customerId),
  });
  const [tab, setTab] = useState<'fiche' | 'sales' | 'orders'>('fiche');
  // Situation de compte (mig 351) : ce que le client doit, en retard, plafond restant.
  const { data: situation } = useQuery({
    queryKey: ['customer-situation', customerId],
    queryFn: () => customersApi.situation(customerId),
  });

  const customer = data?.customer as Customer | undefined;
  const orders = data?.orders;
  const sales = data?.sales;
  const type = ((customer?.customer_type as CustomerType) || 'particulier');
  const meta = TYPE_META[type] || TYPE_META.particulier;
  const TypeIcon = meta.icon;
  const { primary, secondary } = customer ? displayName(customer) : { primary: '', secondary: null };
  const points = Number(customer?.loyalty_points) || 0;
  const tier = loyaltyTier(points);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ ...panelStyle, maxWidth: 760, height: 'min(92vh, 720px)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Users size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Client</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{primary || '…'}</span>
          </div>
          <div style={{ flex: 1 }} />
          {customer && (
            <div style={{ display: 'inline-flex', gap: 2, marginRight: 8 }}>
              <button type="button" onClick={() => setTab('fiche')} className={tab === 'fiche' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '3px 10px' }}>Fiche</button>
              <button type="button" onClick={() => setTab('sales')} className={tab === 'sales' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '3px 10px', display: 'inline-flex', gap: 4, alignItems: 'center' }}><Receipt size={12} /> Ventes · {sales?.count || 0}</button>
              <button type="button" onClick={() => setTab('orders')} className={tab === 'orders' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '3px 10px', display: 'inline-flex', gap: 4, alignItems: 'center' }}><ShoppingCart size={12} /> Commandes · {orders?.count || 0}</button>
              <button type="button" onClick={() => onEdit(customer)} className="odoo-btn-secondary" style={{ padding: '3px 10px', display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 6 }}><Pencil size={12} /> Modifier</button>
            </div>
          )}
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        {isLoading || !customer ? (
          <div style={{ padding: '3rem', textAlign: 'center', ...muted }}><Loader2 className="animate-spin" size={18} style={{ margin: '0 auto' }} /></div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Synthèse chiffrée */}
            <div className="odoo-stat-grid">
              <div className="odoo-stat-card" style={{ cursor: 'default' }}>
                <div className="odoo-stat-card-label">CA cumulé</div>
                <div className="odoo-stat-card-value">{n(parseFloat(customer.total_spent) || 0)}</div>
                <div className="odoo-stat-card-sub">DH</div>
              </div>
              <div className="odoo-stat-card" style={{ cursor: 'default' }}>
                <div className="odoo-stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Star size={11} /> Fidélité</div>
                <div className="odoo-stat-card-value">{points.toLocaleString('fr-FR')}</div>
                <div className="odoo-stat-card-sub">{tier ? `points · niveau ${tier.label}` : 'points'}</div>
              </div>
              <div className="odoo-stat-card" style={{ cursor: 'default' }}>
                <div className="odoo-stat-card-label">Ventes caisse</div>
                <div className="odoo-stat-card-value">{sales?.count || 0}</div>
                <div className="odoo-stat-card-sub">{n(parseFloat(sales?.total_amount) || 0)} DH</div>
              </div>
              <div className="odoo-stat-card" style={{ cursor: 'default' }}>
                <div className="odoo-stat-card-label">Commandes</div>
                <div className="odoo-stat-card-value">{orders?.count || 0}</div>
                <div className="odoo-stat-card-sub">{n(parseFloat(orders?.total_amount) || 0)} DH</div>
              </div>
              {situation && (
                <div className="odoo-stat-card" style={{ cursor: 'default' }}
                  title="Tickets portés sur son compte et factures non réglées (Ventes › Créances clients)">
                  <div className="odoo-stat-card-label">Doit</div>
                  <div className="odoo-stat-card-value" style={{ color: situation.overdue > 0 ? '#dc2626' : undefined }}>{n(situation.total)}</div>
                  <div className="odoo-stat-card-sub">
                    {situation.overdue > 0 ? <span style={{ color: '#dc2626' }}>dont {n(situation.overdue)} DH en retard</span> : 'DH · à jour'}
                    {situation.creditLimit != null && <> · disponible {n(Math.max(situation.available ?? 0, 0))} / {n(situation.creditLimit)}</>}
                  </div>
                </div>
              )}
            </div>

            {tab === 'fiche' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {needsIce(customer) && (
                  <StatusBanner tone="warning" icon={AlertTriangle} title="ICE manquant"
                    actions={<button type="button" className="odoo-btn-secondary" onClick={() => onEdit(customer)}>Compléter</button>}>
                    Les factures adressées à ce client ne seront pas conformes tant que son ICE n'est pas saisi.
                  </StatusBanner>
                )}
                {customer.notes && (
                  <StatusBanner tone="neutral" icon={MessageSquare} title="Notes internes">{customer.notes}</StatusBanner>
                )}

                <div style={sectionTitle}><Contact size={12} /> Identité et contact</div>
                <KvTable rows={[
                  ['Type', <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><TypeIcon size={12} /> {meta.label}</span>],
                  ...(isMoral(type) ? [['Raison sociale', customer.company_name] as [string, React.ReactNode]] : []),
                  [isMoral(type) ? 'Contact' : 'Nom', (secondary ?? primary) ? `${secondary ?? primary}${customer.contact_role ? ` (${customer.contact_role})` : ''}` : null],
                  ['Téléphone', customer.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {customer.phone}</span>],
                  ['Email', customer.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={11} /> {customer.email}</span>],
                  ['Contact préféré', ({ phone: 'Téléphone', email: 'Email', whatsapp: 'WhatsApp' } as Record<string, string>)[customer.preferred_contact as string]],
                  ['Adresse', [customer.address, customer.city].filter(Boolean).join(', ')],
                  ...(type === 'particulier' ? [
                    ['Date de naissance', customer.birthday ? format(new Date(customer.birthday), 'd MMMM yyyy', { locale: fr }) : null] as [string, React.ReactNode],
                    ['Allergies', customer.allergies] as [string, React.ReactNode],
                  ] : []),
                  ['Client depuis', format(new Date(customer.created_at), 'MMMM yyyy', { locale: fr })],
                ]} />

                {isMoral(type) && (
                  <>
                    <div style={sectionTitle}><FileText size={12} /> Identifiants légaux</div>
                    <KvTable mono rows={type === 'association' ? [
                      ['Récépissé', customer.association_recepisse],
                      ['IF', customer.if_fiscal],
                      ['Président', customer.president],
                      ['TVA', <span>{customer.tva_exonere ? 'Exonérée' : 'Assujettie'}</span>],
                    ] : [
                      ['Forme juridique', customer.forme_juridique],
                      ['ICE', customer.ice],
                      ['IF', customer.if_fiscal],
                      ['RC', customer.rc ? `${customer.rc}${customer.rc_ville ? ' — ' + customer.rc_ville : ''}` : null],
                      ['TP', customer.tp],
                      ['CNSS', customer.cnss],
                      ['TVA', <span>{customer.tva_exonere ? 'Exonérée' : 'Assujettie'}</span>],
                    ]} />
                  </>
                )}

                {type === 'revendeur' && (
                  <>
                    <div style={sectionTitle}><CreditCard size={12} /> Conditions commerciales</div>
                    <KvTable rows={[
                      ['Plafond de crédit', customer.credit_limit ? `${n(parseFloat(customer.credit_limit))} DH` : null],
                      ['Remise', customer.remise_pct ? `${customer.remise_pct} %` : null],
                      ['Délai de paiement', customer.delai_paiement_jours ? `${customer.delai_paiement_jours} jours` : null],
                    ]} />
                  </>
                )}
              </div>
            )}

            {tab === 'sales' && (
              <HistoryTable empty="Aucune vente caisse"
                rows={(sales?.history || []) as Customer[]}
                head={['N°', 'Date', 'Articles', 'Paiement', 'Total']}
                render={s => {
                  const items = Array.isArray(s.items) ? (s.items as Customer[]).filter(it => it?.name) : [];
                  return [
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.sale_number}</span>,
                    format(new Date(s.created_at), 'dd/MM/yyyy HH:mm'),
                    items.length === 0 ? '—' : (
                      <span title={items.map(it => `${it.quantity}× ${it.name}`).join('\n')}>
                        {items.slice(0, 2).map(it => `${it.quantity}× ${it.name}`).join(', ')}
                        {items.length > 2 && <span style={muted}> +{items.length - 2}</span>}
                      </span>
                    ),
                    PAYMENT_LABELS[s.payment_method as string] || s.payment_method || '—',
                    <span style={{ fontWeight: 600 }}>{n(parseFloat(s.total) || 0)} DH</span>,
                  ];
                }} />
            )}

            {tab === 'orders' && (
              <HistoryTable empty="Aucune commande"
                rows={(orders?.history || []) as Customer[]}
                head={['N°', 'Date', 'Statut', 'Paiement', 'Total']}
                render={o => {
                  const st = ORDER_STATUS[o.status as string] || { label: o.status, tag: 'odoo-tag-grey' };
                  return [
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{o.order_number}</span>,
                    format(new Date(o.created_at), 'dd/MM/yyyy HH:mm'),
                    <span className={`odoo-tag ${st.tag}`}>{st.label}</span>,
                    PAYMENT_LABELS[o.payment_method as string] || o.payment_method || '—',
                    <span style={{ fontWeight: 600 }}>{n(parseFloat(o.total) || 0)} DH</span>,
                  ];
                }} />
            )}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

/** Tableau libellé / valeur (les valeurs vides sont masquées). */
function KvTable({ rows, mono }: { rows: Array<[string, React.ReactNode]>; mono?: boolean }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (shown.length === 0) return <p style={{ fontSize: '0.8125rem', ...muted, margin: 0 }}>Non renseigné.</p>;
  return (
    <table className="odoo-table">
      <tbody>
        {shown.map(([k, v]) => (
          <tr key={k}>
            <td style={{ width: 180, ...muted }}>{k}</td>
            <td style={mono && typeof v === 'string' ? { fontFamily: 'ui-monospace, monospace' } : undefined}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryTable({ rows, head, render, empty }: {
  rows: Customer[]; head: string[]; render: (r: Customer) => React.ReactNode[]; empty: string;
}) {
  if (rows.length === 0) {
    return <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.8125rem', ...muted }}>{empty}</div>;
  }
  return (
    <div style={{ padding: 16 }}>
      <table className="odoo-table">
        <thead><tr>{head.map((h, i) => <th key={h} style={i === head.length - 1 ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id as string}>
              {render(r).map((cell, i) => (
                <td key={i} style={i === head.length - 1 ? { textAlign: 'right', whiteSpace: 'nowrap' } : i === 1 ? { whiteSpace: 'nowrap', ...muted } : i === 0 ? { whiteSpace: 'nowrap' } : undefined}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: '0.6875rem', ...muted, marginTop: 6 }}>20 dernières opérations.</p>
    </div>
  );
}

/* ═══════════════════════ FORMULAIRE CLIENT ═══════════════════════ */
function CustomerFormModal({ editing, onClose, onSubmit, isPending }: {
  editing: Customer | null;
  onClose: () => void;
  onSubmit: (data: Customer) => void;
  isPending: boolean;
}) {
  const [customerType, setCustomerType] = useState<CustomerType>(
    (editing?.customer_type as CustomerType) || 'particulier'
  );
  const [tvaExonere, setTvaExonere] = useState<boolean>(
    editing?.tva_exonere === true || editing?.customer_type === 'association'
  );
  const isMoralEntity = isMoral(customerType);
  const title = editing ? displayName(editing).primary : 'Nouveau';

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ ...panelStyle, maxWidth: 680 }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Users size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Client</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{title}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const payload: Customer = Object.fromEntries(fd);
          payload.tvaExonere = tvaExonere;
          onSubmit(payload);
        }} className="flex-1 overflow-y-auto">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={sectionTitle}><Users size={12} /> Type de client</div>
            <div className="odoo-view-switcher" role="radiogroup" aria-label="Type de client" style={{ alignSelf: 'flex-start' }}>
              {(Object.keys(TYPE_META) as CustomerType[]).map(t => {
                const Icon = TYPE_META[t].icon;
                const selected = customerType === t;
                return (
                  <button type="button" key={t} role="radio" aria-checked={selected}
                    onClick={() => {
                      setCustomerType(t);
                      if (t === 'association') setTvaExonere(true);
                      else if (t === 'particulier') setTvaExonere(false);
                    }}
                    style={{
                      padding: '0.35rem 0.85rem', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: selected ? 'var(--odoo-purple-light)' : 'transparent',
                      color: selected ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)',
                      fontWeight: selected ? 600 : 400,
                    }}>
                    <Icon size={13} /> {TYPE_META[t].label}
                  </button>
                );
              })}
            </div>
            <input type="hidden" name="customerType" value={customerType} />

            {isMoralEntity && (
              <>
                <div style={sectionTitle}><Building2 size={12} /> {customerType === 'association' ? 'Identité de l\'association' : 'Identité de l\'entreprise'}</div>
                <div>
                  <label style={fieldLabel}>Raison sociale *</label>
                  <input name="companyName" defaultValue={editing?.company_name} className={inputCls} required autoFocus
                    placeholder={customerType === 'association' ? 'Association X' : 'Pâtisserie du Coin SARL'} />
                </div>
                {customerType !== 'association' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label style={fieldLabel}>Forme juridique</label>
                      <select name="formeJuridique" defaultValue={editing?.forme_juridique || ''} className={inputCls}>
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
                      </select></div>
                    <div><label style={fieldLabel}>Ville RC</label>
                      <input name="rcVille" defaultValue={editing?.rc_ville} className={inputCls} placeholder="Casablanca" /></div>
                  </div>
                )}

                <div style={sectionTitle}><FileBadge2 size={12} /> Identifiants légaux</div>
                {customerType !== 'association' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label style={fieldLabel}>ICE{customerType === 'professionnel' || customerType === 'revendeur' ? ' (requis pour facturer)' : ''}</label>
                      <input name="ice" defaultValue={editing?.ice} className={inputCls} style={{ fontFamily: 'ui-monospace, monospace' }}
                        maxLength={15} pattern="[0-9]{15}" title="15 chiffres" placeholder="000000000000000" /></div>
                    <div><label style={fieldLabel}>IF (identifiant fiscal)</label>
                      <input name="ifFiscal" defaultValue={editing?.if_fiscal} className={inputCls} style={{ fontFamily: 'ui-monospace, monospace' }} placeholder="12345678" /></div>
                    <div><label style={fieldLabel}>RC (n°)</label>
                      <input name="rc" defaultValue={editing?.rc} className={inputCls} style={{ fontFamily: 'ui-monospace, monospace' }} placeholder="123456" /></div>
                    <div><label style={fieldLabel}>TP (taxe professionnelle)</label>
                      <input name="tp" defaultValue={editing?.tp} className={inputCls} style={{ fontFamily: 'ui-monospace, monospace' }} placeholder="30123456" /></div>
                    <div><label style={fieldLabel}>CNSS (employeur)</label>
                      <input name="cnss" defaultValue={editing?.cnss} className={inputCls} style={{ fontFamily: 'ui-monospace, monospace' }} placeholder="1234567" /></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label style={fieldLabel}>N° récépissé</label>
                      <input name="associationRecepisse" defaultValue={editing?.association_recepisse} className={inputCls} style={{ fontFamily: 'ui-monospace, monospace' }} placeholder="Récépissé de déclaration" /></div>
                    <div><label style={fieldLabel}>IF (si assujettie)</label>
                      <input name="ifFiscal" defaultValue={editing?.if_fiscal} className={inputCls} style={{ fontFamily: 'ui-monospace, monospace' }} placeholder="Optionnel" /></div>
                    <div><label style={fieldLabel}>Président</label>
                      <input name="president" defaultValue={editing?.president} className={inputCls} placeholder="Nom du président" /></div>
                  </div>
                )}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tvaExonere} onChange={(e) => setTvaExonere(e.target.checked)} />
                  Client exonéré de TVA
                </label>
              </>
            )}

            <div style={sectionTitle}><User size={12} /> {isMoralEntity ? 'Contact principal (optionnel)' : 'Identité'}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={fieldLabel}>Prénom{isMoralEntity ? '' : ' *'}</label>
                <input name="firstName" defaultValue={editing?.first_name} className={inputCls} required={!isMoralEntity} autoFocus={!isMoralEntity} placeholder="Mohamed" /></div>
              <div><label style={fieldLabel}>Nom{isMoralEntity ? '' : ' *'}</label>
                <input name="lastName" defaultValue={editing?.last_name} className={inputCls} required={!isMoralEntity} placeholder="Alami" /></div>
              {isMoralEntity ? (
                <div><label style={fieldLabel}>Fonction / rôle</label>
                  <input name="contactRole" defaultValue={editing?.contact_role} className={inputCls}
                    placeholder={customerType === 'association' ? 'Trésorier, secrétaire…' : 'Gérant, acheteur, comptable…'} /></div>
              ) : (
                <div><label style={fieldLabel}>Date de naissance</label>
                  <input name="birthday" type="date" defaultValue={editing?.birthday ? (editing.birthday as string).slice(0, 10) : ''} className={inputCls} /></div>
              )}
            </div>

            <div style={sectionTitle}><Phone size={12} /> Contact</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={fieldLabel}>Téléphone</label>
                <input name="phone" defaultValue={editing?.phone} className={inputCls} placeholder="06 XX XX XX XX" /></div>
              <div><label style={fieldLabel}>Email</label>
                <input name="email" type="email" defaultValue={editing?.email} className={inputCls} placeholder="client@exemple.com" /></div>
            </div>
            <div>
              <label style={fieldLabel}>Contact préféré</label>
              <div style={{ display: 'flex', gap: 16, fontSize: '0.8125rem' }}>
                {(['phone', 'email', 'whatsapp'] as const).map(m => (
                  <label key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name="preferredContact" value={m}
                      defaultChecked={(editing?.preferred_contact || 'phone') === m} />
                    {m === 'phone' ? 'Téléphone' : m === 'email' ? 'Email' : 'WhatsApp'}
                  </label>
                ))}
              </div>
            </div>

            <div style={sectionTitle}><MapPin size={12} /> {isMoralEntity ? 'Adresse du siège' : 'Adresse'}</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><label style={fieldLabel}>Adresse</label>
                <input name="address" defaultValue={editing?.address} className={inputCls} placeholder="123 rue Mohammed V" /></div>
              <div><label style={fieldLabel}>Ville</label>
                <input name="city" defaultValue={editing?.city} className={inputCls} placeholder="Casablanca" /></div>
            </div>

            {customerType === 'revendeur' && (
              <>
                <div style={sectionTitle}><CreditCard size={12} /> Conditions commerciales</div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label style={fieldLabel}>Plafond de crédit (DH)</label>
                    <input name="creditLimit" type="number" step="0.01" min="0" defaultValue={editing?.credit_limit} className={inputCls} placeholder="10000" /></div>
                  <div><label style={fieldLabel}>Remise (%)</label>
                    <input name="remisePct" type="number" step="0.01" min="0" max="100" defaultValue={editing?.remise_pct} className={inputCls} placeholder="5" /></div>
                  <div><label style={fieldLabel}>Délai de paiement (jours)</label>
                    <input name="delaiPaiementJours" type="number" step="1" min="0" defaultValue={editing?.delai_paiement_jours} className={inputCls} placeholder="30" /></div>
                </div>
              </>
            )}

            <div style={sectionTitle}><MessageSquare size={12} /> Préférences et notes</div>
            {customerType === 'particulier' && (
              <div><label style={fieldLabel}>Allergies / restrictions</label>
                <input name="allergies" defaultValue={editing?.allergies} className={inputCls} placeholder="Gluten, lactose, fruits à coque…" /></div>
            )}
            <div><label style={fieldLabel}>Notes internes</label>
              <textarea name="notes" defaultValue={editing?.notes} rows={2} className={inputCls} placeholder="Préférences, habitudes, informations utiles…" /></div>
          </div>

          <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isPending} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {isPending && <Loader2 size={12} className="animate-spin" />}
              {editing ? 'Enregistrer' : 'Créer le client'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
