import PersonalDataExportButton from '../../components/PersonalDataExportButton';
import { usePermissions } from '../../context/PermissionsContext';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Truck, X, CheckCircle2, RotateCcw, Trash2,
  AlertTriangle, History, FileBadge2, ClipboardList, Banknote, Archive,
  Filter, MapPin, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight,
} from 'lucide-react';
import SearchSelect from '../../components/ui/SearchSelect';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { suppliersApi, type SupplierIdentifierInput, type IdentifierType } from '../../api/accounting.api';
import { supplierScoreApi, STANDING_TAG } from '../../api/supplier-score.api';
import { apiErrorMessage } from '../../api/errors';
import { currenciesApi, BASE_CURRENCY } from '../../api/currencies.api';
import CustomFieldsEditor, { useCustomListColumns } from '../../components/custom-fields/CustomFieldsEditor';
import { useCustomFieldsForm, formatCfValue, type CfValues } from '../../api/custom-fields.api';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import {
  KpiGrid, KpiCard, Toolbar, SearchBar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState,
  Tabs, Alert, FormSection, FormField, FormFooter, Modal, ErrorState,
} from '../../components/ds';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import { PurHeaderActions } from './PurHeaderActions';
import { ribHint, ribLiveError } from '../../utils/rib';
import { money, currencySymbol } from '../../utils/money';

/**
 * Onglet Fournisseurs (refonte Achats D1, lot 1 — mig 304).
 *
 * La fiche porte l'identité d'usage, l'identité légale et les identifiants fiscaux.
 * Les identifiants ne sont pas des champs codés en dur : la liste vient du serveur
 * (types du pack pays), ce qui permet d'autres pays et secteurs sans toucher l'écran.
 */

type Supplier = {
  id: string; name: string; legal_name: string | null; legal_form: string | null;
  vat_regime: 'assujetti' | 'non_assujetti' | 'exonere';
  parent_supplier_id: string | null; parent_supplier_name: string | null;
  contact_name: string | null; phone: string | null; email: string | null;
  address: string | null; city: string | null; ice: string | null; notes: string | null;
  is_active: boolean; auxiliary_code: string | null; updated_at: string; currency_code?: string | null; custom_fields?: CfValues;
  identifiers: Array<{ typeCode: string; value: string; qualifier: string | null; label: string; requiredForVatDeduction: boolean }>;
};

const VAT_REGIME_LABELS: Record<Supplier['vat_regime'], string> = {
  assujetti: 'Assujetti à la TVA',
  non_assujetti: 'Non assujetti (particulier, marché)',
  exonere: 'Exonéré (produits sans TVA)',
};

const LEGAL_FORMS = ['SARL', 'SARL AU', 'SA', 'SAS', 'SNC', 'personne_physique', 'auto_entrepreneur', 'cooperative', 'association', 'autre'] as const;
const LEGAL_FORM_LABELS: Record<string, string> = {
  personne_physique: 'Personne physique', auto_entrepreneur: 'Auto-entrepreneur',
  cooperative: 'Coopérative', association: 'Association', autre: 'Autre',
};
// Intitulé complet, cherchable (« responsabilité » trouve SARL).
const LEGAL_FORM_FULL: Record<string, string> = {
  SARL: 'Société à responsabilité limitée', 'SARL AU': 'SARL à associé unique', SA: 'Société anonyme',
  SAS: 'Société par actions simplifiée', SNC: 'Société en nom collectif',
  personne_physique: 'Commerçant en nom propre', auto_entrepreneur: 'Statut auto-entrepreneur',
};
const LEGAL_FORM_OPTIONS = LEGAL_FORMS.map(f => ({ id: f, label: LEGAL_FORM_LABELS[f] ?? f, sublabel: LEGAL_FORM_FULL[f] }));

type FormState = {
  name: string; legalName: string; legalForm: string; vatRegime: Supplier['vat_regime'];
  parentSupplierId: string; contactName: string; phone: string; email: string;
  address: string; city: string; notes: string; currencyCode: string;
  rib: string; bankName: string;
  identifiers: Record<string, { value: string; qualifier: string }>;
};

function emptyForm(): FormState {
  return {
    name: '', legalName: '', legalForm: '', vatRegime: 'assujetti', parentSupplierId: '',
    contactName: '', phone: '', email: '', address: '', city: '', notes: '', currencyCode: BASE_CURRENCY, rib: '', bankName: '', identifiers: {},
  };
}

function formFromSupplier(s: Supplier): FormState {
  const identifiers: FormState['identifiers'] = {};
  for (const i of s.identifiers) identifiers[i.typeCode] = { value: i.value, qualifier: i.qualifier ?? '' };
  return {
    name: s.name, legalName: s.legal_name ?? '', legalForm: s.legal_form ?? '', vatRegime: s.vat_regime,
    parentSupplierId: s.parent_supplier_id ?? '', contactName: s.contact_name ?? '', phone: s.phone ?? '',
    email: s.email ?? '', address: s.address ?? '', city: s.city ?? '', notes: s.notes ?? '', currencyCode: (s.currency_code ?? BASE_CURRENCY).trim(),
    rib: (s as Supplier & { rib?: string | null }).rib ?? '', bankName: (s as Supplier & { bank_name?: string | null }).bank_name ?? '', identifiers,
  };
}

/**
 * Situation de la relation fournisseur (dérivée côté serveur, cf. supplierRepository._stagedCte).
 * Chaque fournisseur actif est dans UNE étape, la plus urgente ; les inactifs sont dans l'Historique.
 */
const SUP_STAGES: StageDef[] = [
  { key: 'incomplete', label: 'Fiche à compléter', hint: 'ICE manquant', icon: FileBadge2 },
  { key: 'ordering', label: 'Commande en cours', hint: 'BC ouverts', icon: ClipboardList },
  { key: 'due', label: 'À régler', hint: 'factures non réglées', icon: Banknote },
  { key: 'ok', label: 'À jour', hint: 'achats 12 mois', icon: CheckCircle2 },
  { key: 'inactive', label: 'Inactifs', hint: 'voir l\'historique', icon: Archive },
];
const SUP_OPEN_STAGES = ['incomplete', 'ordering', 'due', 'ok'];
// Ton du statut de situation : une couleur = un sens (à traiter, en cours, terminé, inactif).
const STAGE_TONE: Record<string, StatusTone> = {
  incomplete: 'todo', ordering: 'progress', due: 'todo', ok: 'done', inactive: 'cancelled',
};
// Critères transverses : un fournisseur « Commande en cours » peut aussi avoir un reste dû, etc.
const SUP_FLAGS: Record<'open' | 'history', Array<{ key: string; label: string }>> = {
  open: [
    { key: 'missing_id', label: 'ICE manquant' },
    { key: 'open_po', label: 'BC ouvert' },
    { key: 'late_po', label: 'Livraison en retard' },
    { key: 'due', label: 'Reste à payer' },
    { key: 'overdue', label: 'Facture échue' },
    { key: 'never_ordered', label: 'Jamais commandé' },
    { key: 'dormant', label: 'Sans commande depuis 90 j' },
  ],
  history: [
    { key: 'due', label: 'Reste à payer' },
    { key: 'never_ordered', label: 'Jamais commandé' },
  ],
};

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function SuppliersTab({ onOpenOrders, onOpenInvoices }: {
  /** Bascule vers l'onglet Bons de commande filtré sur ce fournisseur. */
  onOpenOrders?: (supplierId: string) => void;
  /** Bascule vers l'onglet Factures reçues filtré sur ce fournisseur. */
  onOpenInvoices?: (supplierId: string) => void;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  // Vue « Actifs » (par situation) ou « Inactifs » ; filtrage, tri et pagination côté serveur.
  const [view, setView] = useState<'open' | 'history'>('open');
  const [stage, setStage] = useState('');
  const [flag, setFlag] = useState('');
  const [city, setCity] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // Période d'activité : au moins un BC commandé dans l'intervalle.
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('urgency');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [view, stage, flag, city, searchTerm, period, customFrom, customTo, sortBy, sortDir]);

  const boardParams = useMemo(() => {
    const p: Record<string, string> = { view, page: String(page), pageSize: String(PAGE_SIZE), sort: sortBy, dir: sortDir };
    if (view === 'open' && stage) p.stage = stage;
    if (flag) p.flag = flag;
    if (city) p.city = city;
    if (searchTerm) p.search = searchTerm;
    return { ...p, ...periodParams(period, customFrom, customTo) };
  }, [view, stage, flag, city, searchTerm, period, customFrom, customTo, page, sortBy, sortDir]);

  const { data: board, isLoading, isFetching, error: boardError, refetch: refetchBoard } = useQuery({
    queryKey: ['suppliers', 'board', boardParams],
    queryFn: () => suppliersApi.board(boardParams),
    placeholderData: (prev) => prev,
  });
  const { data: summary } = useQuery({ queryKey: ['suppliers', 'board-summary'], queryFn: suppliersApi.boardSummary });
  // Dernière note figée (mig 362) : badge A/B/C/D, détail dans Achats › Évaluation des fournisseurs.
  const { hasFeature } = usePermissions();
  const { data: latestScores = [] } = useQuery({ queryKey: ['supplier-scores', 'latest'], queryFn: supplierScoreApi.latest, enabled: hasFeature('evaluation_fournisseurs') });
  const scoreOf = (id: string) => latestScores.find(x => x.supplier_id === id);
  // Référentiel complet : seulement pour la fiche (choix de l'entité parente).
  const { data: allSuppliers = [] } = useQuery<Supplier[]>({ queryKey: ['suppliers'], queryFn: suppliersApi.list, enabled: showForm });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => suppliersApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); notify.success('Fournisseur désactivé'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Erreur lors de la désactivation')),
  });
  const reactivateMutation = useMutation({
    mutationFn: (id: string) => suppliersApi.update(id, { isActive: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); notify.success('Fournisseur réactivé'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Erreur lors de la réactivation')),
  });

  const rows = (board?.rows ?? []) as Array<Supplier & Record<string, any>>;
  const cfColumns = useCustomListColumns('supplier');
  const total = board?.total ?? 0;

  const stageStats = useMemo(() => {
    const m: Record<string, { count: number; due: number; openPo: number; p12: number; late: number }> = {};
    for (const s of summary?.stages ?? []) {
      m[s.stage] = {
        count: s.count, due: parseFloat(s.amount_due) || 0, openPo: parseFloat(s.open_po_amount) || 0,
        p12: parseFloat(s.purchased_12m) || 0, late: s.late_count,
      };
    }
    return m;
  }, [summary]);
  const openCount = SUP_OPEN_STAGES.reduce((a, k) => a + (stageStats[k]?.count ?? 0), 0);
  const openDue = SUP_OPEN_STAGES.reduce((a, k) => a + (stageStats[k]?.due ?? 0), 0);
  const inactiveCount = stageStats.inactive?.count ?? 0;
  const incompleteCount = stageStats.incomplete?.count ?? 0;
  const cityOptions = (summary?.cities ?? []).map(c => ({ key: c.city, label: `${c.city} (${c.count})` }));

  const defaultSort = (v: 'open' | 'history') => (v === 'history' ? 'name' : 'urgency');
  const switchView = (next: 'open' | 'history') => {
    if (next === view) return;
    setView(next); setStage(''); setFlag('');
    setSortBy(defaultSort(next)); setSortDir(next === 'history' ? 'asc' : 'desc');
  };
  const pickStage = (key: string) => {
    if (key === 'inactive') { switchView('history'); return; }
    switchView('open');
    setStage(stage === key ? '' : key);
  };
  const hasFilters = !!(flag || city || searchTerm || period !== 'all');
  const resetFilters = () => {
    setFlag(''); setCity(''); setSearchInput(''); setSearchTerm('');
    setPeriod('all'); setCustomFrom(''); setCustomTo('');
  };

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditing(null); };

  const askReactivate = async (s: Supplier) => {
    if (await confirm(`Réactiver le fournisseur « ${s.name} » ?`, { title: 'Réactiver un fournisseur', confirmLabel: 'Réactiver' })) {
      reactivateMutation.mutate(s.id);
    }
  };

  /** Actions secondaires d'une ligne (menu « ⋯ ») ; l'action visible ouvre la fiche. */
  const rowMenu = (s: Supplier & Record<string, any>): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (onOpenOrders) items.push({ label: 'Voir ses bons de commande', icon: ClipboardList, onSelect: () => onOpenOrders(s.id) });
    if (onOpenInvoices) items.push({ label: 'Voir ses factures', icon: Banknote, onSelect: () => onOpenInvoices(s.id) });
    if (!s.is_active) items.push({ label: 'Réactiver', icon: RotateCcw, onSelect: () => askReactivate(s) });
    else if (isAdmin) {
      items.push({
        label: 'Désactiver', icon: Trash2, danger: true,
        onSelect: async () => {
          if (await confirm(`Désactiver le fournisseur « ${s.name} » ? Il n'apparaîtra plus dans les sélections ; l'historique (BC, factures, paiements) est conservé.`, { title: 'Désactiver un fournisseur', confirmLabel: 'Désactiver', danger: true })) {
            deactivateMutation.mutate(s.id);
          }
        },
      });
    }
    return items;
  };

  /**
   * Complément de la situation : seulement ce que les autres colonnes ne disent pas
   * (l'ICE manquant est déjà signalé dans sa colonne, le reste dû dans la sienne).
   */
  const stageDetail = (s: Record<string, any>): string | null => {
    const k = Number(s.open_po_count) || 0;
    const openPo = k > 0 ? `${k} BC ouvert${k > 1 ? 's' : ''} · ${money(parseFloat(s.open_po_amount) || 0)}` : null;
    switch (s.stage as string) {
      case 'incomplete': return openPo;
      case 'ordering': return openPo;
      default: return null;
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortDir(field === 'name' || field === 'city' ? 'asc' : 'desc'); }
  };
  const sortableTh = (field: string, label: string, align?: 'right') => (
    <th aria-sort={sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={align ? 'ds-num' : undefined}><button type="button" className="ds-sort" onClick={() => toggleSort(field)}>
      {label}{' '}
      {sortBy !== field
        ? <ArrowUpDown size={10} aria-hidden="true" style={{ opacity: 0.3, verticalAlign: 'middle' }} />
        : sortDir === 'asc' ? <ArrowUp size={10} aria-hidden="true" style={{ verticalAlign: 'middle' }} /> : <ArrowDown size={10} aria-hidden="true" style={{ verticalAlign: 'middle' }} />}
    </button></th>
  );
  const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), 'dd MMM yyyy', { locale: fr }) : null);

  return (
    <>
      {incompleteCount > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle}
          title={`${incompleteCount} fournisseur${incompleteCount > 1 ? 's' : ''} assujetti${incompleteCount > 1 ? 's' : ''} sans ICE`}
          actions={stage !== 'incomplete' ? (
            <button type="button" className="odoo-btn-secondary" onClick={() => pickStage('incomplete')}>Les afficher</button>
          ) : undefined}>
          Sans ICE, la facture reçue n'est pas une pièce probante : la charge et la TVA peuvent être rejetées en contrôle.
        </StatusBanner>
      )}

      <KpiGrid>
        <KpiCard label="Restant dû" value={money(openDue)} sub={`${stageStats.due?.count ?? 0} fournisseur(s) à régler`} tone={openDue > 0 ? 'orange' : undefined} />
        <KpiCard label="Commandes ouvertes" value={money(SUP_OPEN_STAGES.reduce((a, k) => a + (stageStats[k]?.openPo ?? 0), 0))} sub={`${stageStats.ordering?.count ?? 0} fournisseur(s) avec BC en cours`} />
        <KpiCard label="Achats 12 mois" value={money(SUP_OPEN_STAGES.reduce((a, k) => a + (stageStats[k]?.p12 ?? 0), 0))} sub={`${openCount} fournisseur(s) actif(s)`} />
        <KpiCard label="Fiches sans ICE" value={String(incompleteCount)} sub="facture non probante" tone={incompleteCount ? 'red' : undefined} />
      </KpiGrid>

      <PurHeaderActions>
        <button type="button" onClick={openNew} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Nouveau fournisseur
        </button>
      </PurHeaderActions>

      {/* Situation de la relation : une pastille par étape, clic = filtre */}
      <StagePipeline
        title="Où en sont mes fournisseurs"
        summary={`${openCount} actif${openCount > 1 ? 's' : ''} · ${money(openDue)} restant dus`}
        stages={SUP_STAGES}
        stats={Object.fromEntries(SUP_STAGES.map(s => {
          const st = stageStats[s.key];
          if (!st) return [s.key, undefined];
          const sub = s.key === 'ordering' ? `${money(st.openPo)}`
            : s.key === 'due' || s.key === 'incomplete' ? (st.due > 0 ? `${money(st.due)} dus` : '')
            : s.key === 'ok' ? `${money(st.p12)}` : '';
          return [s.key, { count: st.count, sub, late: st.late }];
        }))}
        isActive={k => (k === 'inactive' ? view === 'history' : view === 'open' && stage === k)}
        onPick={pickStage}
      />

      <Toolbar>
        <SearchBar value={searchInput} onChange={setSearchInput} label="Rechercher un fournisseur"
          placeholder="Nom, raison sociale, contact, ville, ICE, IF…" busy={isFetching && !isLoading} />
        <SelectFilter label="Critère" icon={Filter} value={flag} onChange={setFlag} options={SUP_FLAGS[view]} />
        <SelectFilter label="Ville" icon={MapPin} value={city} onChange={setCity} options={cityOptions} allLabel="Toutes" />
        <PeriodFilter label="Commandé" title="Fournisseurs ayant au moins un BC commandé sur la période"
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="ds-btn-ghost ds-btn-sm"><X size={13} aria-hidden="true" /> Effacer</button>
        )}
        <ViewSwitch view={view} onChange={switchView}
          openLabel={`Actifs · ${openCount}`} historyLabel={`Inactifs · ${inactiveCount}`} ariaLabel="Fournisseurs actifs ou inactifs" />
      </Toolbar>

      {isLoading ? <LoadingState label="Chargement des fournisseurs…" /> : boardError && !board ? <ErrorState error={boardError} onRetry={() => { void refetchBoard(); }} /> : rows.length === 0 ? (
        hasFilters
          ? <NoResultState onReset={resetFilters} text="Aucun fournisseur ne correspond aux filtres." />
          : <EmptyState icon={Truck}
              title={view === 'open' ? (stage ? 'Aucun fournisseur dans cette situation' : 'Aucun fournisseur actif') : 'Aucun fournisseur inactif'}
              text={view === 'open' && !stage ? 'Créez la première fiche pour passer des commandes et enregistrer des factures.' : undefined}
              action={view === 'open' && !stage ? <button type="button" className="odoo-btn-primary ds-btn-sm" onClick={openNew}><Plus size={13} aria-hidden="true" /> Nouveau fournisseur</button> : undefined} />
      ) : (
        <div style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <DataPanel label="Fournisseurs"
            footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage}
              note={view === 'open'
                ? `fournisseurs actifs${period !== 'all' ? ` ayant commandé (${periodLabel(period, customFrom, customTo)})` : ''}`
                : 'fournisseurs désactivés, historique conservé'} />}>
            <table className="odoo-table">
              <thead>
                <tr>
                  {sortableTh('name', 'Fournisseur')}
                  <th>Contact</th>
                  {sortableTh('city', 'Ville')}
                  <th>ICE / TVA</th>
                  <th>Situation</th>
                  <th title="Dernière note figée (Achats › Évaluation des fournisseurs)">Note</th>
                  {sortableTh('last_order_date', 'Dernière commande')}
                  {sortableTh('purchased_12m', `Achats 12 mois (${currencySymbol()})`, 'right')}
                  {sortableTh('amount_due', `Reste dû (${currencySymbol()})`, 'right')}
                  {cfColumns.map(d => <th key={d.id}>{d.label}</th>)}
                  <th className="ds-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(s => {
                  const ice = s.identifiers.find(i => i.typeCode === 'MA_ICE')?.value ?? s.ice;
                  const due = parseFloat(s.amount_due) || 0;
                  const p12 = parseFloat(s.purchased_12m) || 0;
                  const overdue = Number(s.overdue_invoice_count) || 0;
                  const latePo = Number(s.late_po_count) || 0;
                  const sc = scoreOf(s.id);
                  const sub: React.CSSProperties = { fontSize: 12, color: 'var(--ds-muted)', fontWeight: 400 };
                  return (
                    <tr key={s.id} onClick={() => openEdit(s)} style={{ cursor: 'pointer' }}>
                      <td className="ds-strong">
                        {s.name}
                        {s.parent_supplier_name && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }} title="Enseigne de">{s.parent_supplier_name}</span>}
                        {s.legal_name && s.legal_name !== s.name && <div style={sub}>{s.legal_name}</div>}
                      </td>
                      <td>
                        <div>{s.contact_name || (s.phone ? '' : '—')}</div>
                        {s.phone && <div style={{ ...sub, whiteSpace: 'nowrap' }}>{s.phone}</div>}
                      </td>
                      <td>{s.city || '—'}</td>
                      <td>
                        {ice ? <div className="ds-ref" style={{ fontWeight: 400 }}>{ice}</div>
                          : s.missing_id ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ds-warning)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}
                              title="Assujetti sans ICE : ses factures ne sont pas des pièces probantes">
                              <AlertTriangle size={12} aria-hidden="true" /> ICE à saisir
                            </div>
                          ) : <div>—</div>}
                        <div style={sub}>{s.vat_regime === 'assujetti' ? 'Assujetti' : s.vat_regime === 'exonere' ? 'Exonéré' : 'Non assujetti'}</div>
                      </td>
                      <td>
                        <StatusTag tone={STAGE_TONE[s.stage as string] ?? 'draft'} label={SUP_STAGES.find(x => x.key === s.stage)?.label ?? '—'} />
                        {stageDetail(s) && <div style={{ ...sub, marginTop: 2, whiteSpace: 'nowrap' }}>{stageDetail(s)}</div>}
                        {(latePo > 0 || overdue > 0) && (
                          <div style={{ fontSize: 12, color: 'var(--ds-danger)', marginTop: 2, whiteSpace: 'nowrap' }}>
                            {[latePo > 0 && `${latePo} livraison${latePo > 1 ? 's' : ''} en retard`, overdue > 0 && `${overdue} facture${overdue > 1 ? 's' : ''} échue${overdue > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td>
                        {sc
                          ? <span className={`odoo-tag ${STANDING_TAG[sc.standing]}`} title={`Note ${sc.score ?? '—'} figée au ${fmtDate(sc.period_to) ?? ''}`}>{sc.standing === 'new' ? 'récent' : `${sc.standing} · ${Number(sc.score).toFixed(0)}`}</span>
                          : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.last_order_date as string) ?? <span style={{ color: 'var(--ds-muted)' }}>jamais</span>}</td>
                      <td className="ds-num">{p12 > 0 ? n(p12) : '—'}</td>
                      <td className="ds-num">
                        {due > 0.005 ? <span className="ds-strong" style={{ color: overdue > 0 ? 'var(--ds-danger)' : undefined }}>{n(due)}</span> : '—'}
                      </td>
                      {cfColumns.map(d => <td key={d.id}>{formatCfValue(d, s.custom_fields?.[d.code]) || '—'}</td>)}
                      <td className="ds-actions" onClick={e => e.stopPropagation()}>
                        <button type="button" onClick={() => openEdit(s)} className="odoo-btn-secondary ds-btn-sm">
                          {s.stage === 'incomplete' ? 'Compléter' : 'Ouvrir'}
                        </button>
                        <RowMenu label={`Plus d'actions pour ${s.name}`} items={rowMenu(s)} />
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
        <SupplierFormModal
          supplier={editing}
          suppliers={allSuppliers}
          onClose={closeForm}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); closeForm(); }}
        />
      )}
    </>
  );
}

/* ═══════════════════════ FICHE FOURNISSEUR ═══════════════════════ */

function SupplierFormModal({ supplier, suppliers, onClose, onSaved }: {
  supplier: Supplier | null;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<'fiche' | 'historique'>('fiche');
  const [form, setForm] = useState<FormState>(() => (supplier ? formFromSupplier(supplier) : emptyForm()));
  const cf = useCustomFieldsForm('supplier', supplier?.custom_fields);
  const { data: currencies = [] } = useQuery({ queryKey: ['currencies'], queryFn: () => currenciesApi.list(), staleTime: 60_000 });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<Array<{ id: string; name: string; reason: string }>>([]);

  const { data: identifierTypes = [] } = useQuery<IdentifierType[]>({
    queryKey: ['supplier-identifier-types'], queryFn: () => suppliersApi.identifierTypes(), staleTime: 5 * 60_000,
  });
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['supplier-history', supplier?.id],
    queryFn: () => suppliersApi.history(supplier!.id),
    enabled: !!supplier && tab === 'historique',
  });

  // Pré-contrôle de doublon à la frappe (nom et identifiants uniques).
  useEffect(() => {
    const name = form.name.trim();
    const uniqueIds = identifierTypes.filter(t => t.is_unique).map(t => ({ typeCode: t.code, value: form.identifiers[t.code]?.value?.trim() })).filter(x => x.value);
    if (name.length < 2 && uniqueIds.length === 0) { setDuplicates([]); return; }
    const handle = setTimeout(async () => {
      try {
        const found: Array<{ id: string; name: string; reason: string }> = [];
        const byName = await suppliersApi.check({ name, excludeId: supplier?.id });
        found.push(...byName);
        for (const u of uniqueIds) {
          const r = await suppliersApi.check({ typeCode: u.typeCode, value: u.value, excludeId: supplier?.id });
          found.push(...r.filter(x => !found.some(f => f.id === x.id && f.reason === x.reason)));
        }
        setDuplicates(found);
      } catch { /* contrôle facultatif */ }
    }, 400);
    return () => clearTimeout(handle);
  }, [form.name, form.identifiers, identifierTypes, supplier?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const identifiers: SupplierIdentifierInput[] = Object.entries(form.identifiers)
        .filter(([, v]) => v.value.trim())
        .map(([typeCode, v]) => ({ typeCode, value: v.value.trim(), qualifier: v.qualifier.trim() || null }));
      const payload = {
        name: form.name.trim(), legalName: form.legalName, legalForm: form.legalForm || null, vatRegime: form.vatRegime,
        parentSupplierId: form.parentSupplierId || null, contactName: form.contactName, phone: form.phone, email: form.email,
        address: form.address, city: form.city, notes: form.notes, currencyCode: form.currencyCode, identifiers,
        rib: form.rib, bankName: form.bankName,
      };
      const saved = supplier ? await suppliersApi.update(supplier.id, payload) : await suppliersApi.create(payload);
      // Champs personnalisés (mig 369) : enregistrés une fois l'id connu.
      await cf.save(supplier?.id ?? (saved as { id?: string })?.id);
      return saved;
    },
    onSuccess: (saved) => {
      notify.success(supplier ? 'Fournisseur modifié' : 'Fournisseur créé');
      // Plan compta, étape 22 : le changement de RIB attend l'approbation d'un autre utilisateur.
      if ((saved as { rib_pending_approval?: boolean } | null)?.rib_pending_approval) {
        notify.warning('Le nouveau RIB attend l\'approbation d\'un administrateur : le RIB actuel reste utilisé pour les virements en attendant.');
      }
      onSaved();
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: { field?: string; message?: string; details?: Record<string, string[]> } } } };
      const details = err.response?.data?.error?.details;
      const field = err.response?.data?.error?.field;
      const next: Record<string, string> = {};
      if (details) for (const [k, msgs] of Object.entries(details)) next[k.split('.')[0]] = msgs[0];
      if (field) next[field] = err.response?.data?.error?.message ?? 'Valeur refusée';
      setFieldErrors(next);
      notify.error(apiErrorMessage(e, 'Enregistrement impossible'));
    },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));
  const setIdent = (code: string, patch: Partial<{ value: string; qualifier: string }>) =>
    setForm(f => {
      const current = f.identifiers[code] ?? { value: '', qualifier: '' };
      return { ...f, identifiers: { ...f.identifiers, [code]: { ...current, ...patch } } };
    });

  // Échap ferme la fenêtre : géré par le Modal commun.
  const formRef = useRef<HTMLFormElement>(null);

  const isGroupBrand = !!form.parentSupplierId;
  const [brandMode, setBrandMode] = useState(isGroupBrand);
  const needsFiscalIds = form.vatRegime !== 'non_assujetti' && !brandMode;
  // Identifiants exigés pour déduire la TVA (ICE, IF) en tête ; les autres repliés.
  const mainIdTypes = identifierTypes.filter(t => t.required_for_vat_deduction);
  const otherIdTypes = identifierTypes.filter(t => !t.required_for_vat_deduction);
  const hasOtherIds = otherIdTypes.some(t => form.identifiers[t.code]?.value?.trim());
  const requiredType = identifierTypes.find(t => t.required_for_vat_deduction);
  const missingIce = form.vatRegime === 'assujetti' && !!requiredType && !form.identifiers[requiredType.code]?.value?.trim() && !form.parentSupplierId;
  const parentOptions = useMemo(() => suppliers
    .filter(s => s.id !== supplier?.id && !s.parent_supplier_id && s.is_active)
    .map(s => ({ id: s.id, label: s.name, sublabel: s.legal_name ?? undefined })), [suppliers, supplier?.id]);

  // Contrôle de format à la frappe (motif du pack pays) : guide sans bloquer, le serveur tranche.
  const idStatus = (t: IdentifierType): { ok: boolean; msg: string } | null => {
    const v = form.identifiers[t.code]?.value?.trim();
    if (!v || !t.pattern) return null;
    const ok = new RegExp(t.pattern).test(v);
    if (ok) return { ok, msg: 'Format valide' };
    const digits = /^\^\[0-9\]\{(\d+)\}\$$/.exec(t.pattern);
    return { ok, msg: digits ? `${v.replace(/\D/g, '').length}/${digits[1]} chiffres` : 'Format inattendu' };
  };

  // Modifications non enregistrées (pied de formulaire).
  const [initialForm] = useState(() => JSON.stringify(form));
  const dirty = JSON.stringify(form) !== initialForm;

  const renderIdentifier = (t: IdentifierType, required: boolean) => {
    const st = idStatus(t);
    const id = `supplier-id-${t.code}`;
    return (
      <FormField key={t.code} label={t.label} htmlFor={id} required={required}
        error={fieldErrors[t.code] ?? (st && !st.ok ? `${t.label} : ${st.msg}` : undefined)}
        hint={st?.ok ? 'Format valide' : t.description}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input id={id} value={form.identifiers[t.code]?.value ?? ''} onChange={e => setIdent(t.code, { value: e.target.value })}
            className="ds-input" inputMode={t.pattern?.startsWith('^[0-9]') ? 'numeric' : undefined}
            aria-invalid={(!!fieldErrors[t.code] || (!!st && !st.ok)) || undefined}
            style={{ fontFamily: 'ui-monospace, monospace' }} />
          {t.code.endsWith('_RC') && (
            <input value={form.identifiers[t.code]?.qualifier ?? ''} onChange={e => setIdent(t.code, { qualifier: e.target.value })}
              className="ds-input" placeholder="Ville du tribunal" aria-label="Ville du tribunal" style={{ maxWidth: 150 }} />
          )}
        </div>
      </FormField>
    );
  };

  return (
    <Modal title={supplier ? supplier.name : 'Nouveau fournisseur'} subtitle={supplier ? 'Fiche du fournisseur' : undefined} width={760}
      onClose={onClose} locked={saveMutation.isPending}
      aside={supplier?.id && tab === 'fiche' ? <PersonalDataExportButton kind="supplier" id={supplier.id as string} label="Exporter les données" /> : undefined}
      footer={tab === 'historique' && supplier ? undefined : (
        <FormFooter dirty={dirty} onCancel={onClose} busy={saveMutation.isPending}
          disabled={brandMode && !form.parentSupplierId}
          onSubmit={() => formRef.current?.requestSubmit()}
          submitLabel={supplier ? 'Enregistrer' : 'Créer le fournisseur'} />
      )}>
        {supplier && (
          <Tabs label="Fiche du fournisseur" value={tab} onChange={setTab}
            tabs={[{ key: 'fiche', label: 'Fiche' }, { key: 'historique', label: 'Historique' }]} />
        )}

        {tab === 'historique' && supplier ? (
          <SupplierHistory rows={history as HistoryRow[]} loading={historyLoading} />
        ) : (
          <form ref={formRef} onSubmit={e => {
            e.preventDefault(); if (saveMutation.isPending) return; setFieldErrors({});
            const missing = cf.missing();
            if (missing.length) { notify.error(`À renseigner : ${missing.join(', ')}`); return; }
            const ribErr = ribLiveError(form.rib);
            if (ribErr) { setFieldErrors({ rib: ribErr }); notify.error(`RIB : ${ribErr}`); return; }
            saveMutation.mutate();
          }} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {duplicates.length > 0 && (
                <StatusBanner tone="danger" icon={AlertTriangle} title="Doublon probable">
                  {duplicates.map(d => <div key={d.id + d.reason}>« {d.name} » porte déjà {d.reason === 'name' ? 'ce nom' : `cet identifiant ${d.reason}`}.</div>)}
                </StatusBanner>
              )}

              {/* 1. Identité : le type pilote les identifiants exigés (remplace le « Régime TVA »). */}
              <FormSection title="Identité">
                <div className="ds-field">
                  <span className="ds-field-label" id="supplier-kind-label">Type de fournisseur</span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2" role="group" aria-labelledby="supplier-kind-label">
                    {SUPPLIER_KINDS.map(k => {
                      const active = form.vatRegime === k.regime;
                      return (
                        <button key={k.regime} type="button" onClick={() => set('vatRegime', k.regime)} aria-pressed={active}
                          style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                            border: `1px solid ${active ? 'var(--ds-accent)' : 'var(--ds-line)'}`,
                            background: active ? 'var(--ds-tint)' : 'var(--ds-card)' }}>
                          <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: active ? 'var(--ds-accent-ink)' : 'var(--ds-ink)' }}>{k.label}</span>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)', marginTop: 2 }}>{k.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <FormField label="Nom du fournisseur" htmlFor="supplier-name" required error={fieldErrors.name}>
                  <input id="supplier-name" value={form.name} onChange={e => set('name', e.target.value)} className="ds-input" required minLength={2} maxLength={200} autoFocus
                    aria-invalid={!!fieldErrors.name || undefined}
                    placeholder="Tel qu'on l'appelle au quotidien, ex : Ovotec, Marjane, Souk Ahmed" />
                </FormField>
                {/* Identité légale et groupe : rarement utile, replié. */}
                <Disclosure label="Identité légale et groupe" hint="raison sociale, forme juridique, enseigne d'un groupe"
                  defaultOpen={!!(form.legalName || form.legalForm || isGroupBrand)}>
                  <div className="ds-form-grid">
                    <FormField label="Raison sociale" htmlFor="supplier-legal-name">
                      <input id="supplier-legal-name" value={form.legalName} onChange={e => set('legalName', e.target.value)} className="ds-input" maxLength={200} placeholder="Si différente du nom" />
                    </FormField>
                    <FormField label="Forme juridique">
                      <SearchSelect options={LEGAL_FORM_OPTIONS} value={form.legalForm} onChange={id => set('legalForm', id)}
                        placeholder="Rechercher : SARL, SA, coopérative…" width="100%" size="md" ariaLabel="Forme juridique" />
                    </FormField>
                    <label style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, cursor: 'pointer' }}>
                      <input type="checkbox" checked={brandMode} style={{ marginTop: 3 }}
                        onChange={e => { setBrandMode(e.target.checked); if (!e.target.checked) set('parentSupplierId', ''); }} />
                      <span>C'est une enseigne d'un groupe
                        <span className="ds-field-hint" style={{ display: 'block' }}>Ex : Supeco appartient à Label'Vie — les identifiants fiscaux sont ceux du groupe.</span>
                      </span>
                    </label>
                    {brandMode && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <FormField label="Groupe (entité juridique)" required
                          error={fieldErrors.parentSupplierId} hint={!form.parentSupplierId ? 'Choisissez le groupe pour enregistrer.' : undefined}>
                          <SearchSelect options={parentOptions} value={form.parentSupplierId} onChange={id => set('parentSupplierId', id)}
                            placeholder="Rechercher le groupe…" width="100%" size="md" ariaLabel="Groupe (entité juridique)" />
                        </FormField>
                      </div>
                    )}
                  </div>
                </Disclosure>
              </FormSection>

              {/* 2. Contact : ce qu'on saisit au quotidien. */}
              <FormSection title="Contact">
                <div className="ds-form-grid">
                  <FormField label="Téléphone" htmlFor="supplier-phone">
                    <input id="supplier-phone" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className="ds-input" maxLength={20} placeholder="06 12 34 56 78" />
                  </FormField>
                  <FormField label="Personne à contacter" htmlFor="supplier-contact">
                    <input id="supplier-contact" value={form.contactName} onChange={e => set('contactName', e.target.value)} className="ds-input" maxLength={100} placeholder="Commercial, livreur…" />
                  </FormField>
                  <FormField label="Email" htmlFor="supplier-email" error={fieldErrors.email} hint="Pour l'envoi des bons de commande">
                    <input id="supplier-email" type="email" value={form.email} onChange={e => set('email', e.target.value)} className="ds-input" maxLength={255}
                      aria-invalid={!!fieldErrors.email || undefined} />
                  </FormField>
                  <FormField label="Ville" htmlFor="supplier-city">
                    <input id="supplier-city" value={form.city} onChange={e => set('city', e.target.value)} className="ds-input" maxLength={100} />
                  </FormField>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FormField label="Adresse" htmlFor="supplier-address">
                      <input id="supplier-address" value={form.address} onChange={e => set('address', e.target.value)} className="ds-input" />
                    </FormField>
                  </div>
                </div>
              </FormSection>

              {/* 3. Fiscalité : ICE / IF en tête, contrôlés à la frappe. */}
              {identifierTypes.length > 0 && (
                <FormSection title={needsFiscalIds ? 'Fiscalité' : 'Fiscalité (identifiants facultatifs)'}>
                  {brandMode ? (
                    <p className="ds-field-hint" style={{ margin: 0 }}>
                      Enseigne d'un groupe : l'ICE et l'IF sont ceux de l'entité juridique choisie dans Identité.
                    </p>
                  ) : (
                    <>
                      <div className="ds-form-grid">
                        {mainIdTypes.map(t => renderIdentifier(t, needsFiscalIds && form.vatRegime === 'assujetti'))}
                      </div>
                      {missingIce && form.name.trim().length >= 2 && (
                        <Alert tone="warning" icon={AlertTriangle}>
                          Sans ICE, les factures de ce fournisseur ne permettent pas de déduire la TVA. Vous pouvez enregistrer et compléter plus tard.
                        </Alert>
                      )}
                      {otherIdTypes.length > 0 && (
                        <Disclosure label={`Autres identifiants (${otherIdTypes.map(t => t.label).join(', ')})`} defaultOpen={hasOtherIds}>
                          <div className="ds-form-grid">{otherIdTypes.map(t => renderIdentifier(t, false))}</div>
                        </Disclosure>
                      )}
                    </>
                  )}
                  {fieldErrors.identifiers && <Alert tone="danger" icon={AlertTriangle}>{fieldErrors.identifiers}</Alert>}
                </FormSection>
              )}

              {/* 4. Conditions d'achat : devise, coordonnées bancaires (virements groupés, G4-01), notes. */}
              <FormSection title="Conditions d'achat">
                <div className="ds-form-grid">
                  <FormField label="Devise des achats"
                    hint={form.currencyCode !== BASE_CURRENCY ? `Proposée sur ses BC et devis ; le stock reste valorisé en ${currencySymbol()}.` : undefined}>
                    <SearchSelect value={form.currencyCode} onChange={v => set('currencyCode', v)}
                      placeholder="Devise" width="100%" size="md" ariaLabel="Devise des achats" clearable={false}
                      options={(currencies.length ? currencies : [{ code: BASE_CURRENCY, label: 'Dirham marocain' }]).map(c => ({ id: c.code, label: `${c.code} — ${c.label}` }))} />
                  </FormField>
                  <FormField label="Banque" htmlFor="supplier-bank">
                    <input id="supplier-bank" value={form.bankName} onChange={e => set('bankName', e.target.value)} className="ds-input" maxLength={100} />
                  </FormField>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FormField label="RIB (24 chiffres)" htmlFor="supplier-rib" error={fieldErrors.rib ?? ribLiveError(form.rib)}
                      hint={form.rib.trim() ? `${ribHint(form.rib)} · pour les virements groupés` : 'Pour les virements groupés'}>
                      <input id="supplier-rib" value={form.rib} onChange={e => set('rib', e.target.value)} className="ds-input" maxLength={40} inputMode="numeric"
                        aria-invalid={!!(fieldErrors.rib ?? ribLiveError(form.rib)) || undefined} style={{ fontFamily: 'ui-monospace, monospace' }} />
                    </FormField>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FormField label="Notes" htmlFor="supplier-notes">
                      <textarea id="supplier-notes" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} className="ds-input"
                        placeholder="Jours de livraison, conditions, minimum de commande…" />
                    </FormField>
                  </div>
                </div>
              </FormSection>

              {/* 5. Champs personnalisés (mig 369) : affichés seulement s'il en existe. */}
              <CustomFieldsEditor entity="supplier" values={cf.values} onChange={cf.setValues} />

              {supplier?.auxiliary_code && (
                <p className="ds-field-hint" style={{ margin: 0 }}>
                  Compte auxiliaire : <span style={{ fontFamily: 'ui-monospace, monospace' }}>{supplier.auxiliary_code}</span>
                  {' · '}dernière modification {format(new Date(supplier.updated_at), 'd MMM yyyy HH:mm', { locale: fr })}
                </p>
              )}
          </form>
        )}
    </Modal>
  );
}

/* Type de fournisseur = régime TVA, formulé en langage métier. */
const SUPPLIER_KINDS: Array<{ regime: Supplier['vat_regime']; label: string; hint: string }> = [
  { regime: 'assujetti', label: 'Entreprise', hint: 'Facture avec TVA — ICE et IF demandés' },
  { regime: 'non_assujetti', label: 'Commerçant / marché', hint: 'Souk, particulier, sans facture TVA' },
  { regime: 'exonere', label: 'Exonéré', hint: 'Produits vendus sans TVA (ex. farine, lait)' },
];

/** Section repliable : garde l'écran court, s'ouvre seule si elle contient déjà des valeurs. */
function Disclosure({ label, hint, defaultOpen, children }: { label: string; hint?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="ds-btn-ghost ds-btn-sm">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        {label}
        {hint && !open && <span style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>— {hint}</span>}
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

/* ═══════════════════════ HISTORIQUE (journal SGBD) ═══════════════════════ */

type HistoryRow = {
  id: number; table_name: string; operation: 'INSERT' | 'UPDATE' | 'DELETE'; changed_at: string;
  diff: Record<string, { old: unknown; new: unknown }> | null; changed_by_name: string | null;
  new_row: Record<string, unknown> | null; old_row: Record<string, unknown> | null;
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nom', legal_name: 'Raison sociale', legal_form: 'Forme juridique', vat_regime: 'Régime TVA',
  parent_supplier_id: 'Entité parente', contact_name: 'Contact', phone: 'Téléphone', email: 'Email',
  address: 'Adresse', city: 'Ville', notes: 'Notes', is_active: 'Actif', ice: 'ICE (miroir)',
  value: 'Valeur', qualifier: 'Complément', type_code: 'Type',
};

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  return String(v);
}

function SupplierHistory({ rows, loading }: { rows: HistoryRow[]; loading: boolean }) {
  if (loading) return <LoadingState bare />;
  if (rows.length === 0) {
    return <EmptyState bare icon={History} title="Aucune modification journalisée" text="Les changements de la fiche et de ses identifiants s'affichent ici depuis l'activation de la piste d'audit." />;
  }
  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '16px 24px' }}>
      <DataPanel label="Historique des modifications">
      <table className="odoo-table ds-dense">
        <thead><tr><th>Quand</th><th>Qui</th><th>Objet</th><th>Changement</th></tr></thead>
        <tbody>
          {rows.map(r => {
            const objet = r.table_name === 'suppliers' ? 'Fiche'
              : `Identifiant ${(r.new_row?.type_code ?? r.old_row?.type_code ?? '') as string}`.trim();
            return (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(r.changed_at), 'd MMM yyyy HH:mm', { locale: fr })}</td>
                <td>{r.changed_by_name || <span style={{ color: 'var(--ds-muted)' }}>système</span>}</td>
                <td>{objet}</td>
                <td>
                  {r.operation === 'INSERT' && <StatusTag tone="done" label="Création" />}
                  {r.operation === 'DELETE' && <StatusTag tone="cancelled" label="Suppression" />}
                  {r.operation === 'UPDATE' && r.diff && (
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {Object.entries(r.diff).map(([k, d]) => (
                        <li key={k}><b>{FIELD_LABELS[k] ?? k}</b> : {fmtVal(d.old)} → {fmtVal(d.new)}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </DataPanel>
    </div>
  );
}
