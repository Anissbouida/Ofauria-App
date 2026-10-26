import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Truck, X, Loader2, Search, CheckCircle2, RotateCcw, Trash2,
  AlertTriangle, History, Building2, FileBadge2, Phone, ClipboardList, Banknote, Archive,
  Filter, MapPin, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight,
} from 'lucide-react';
import SearchSelect from '../../components/ui/SearchSelect';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { suppliersApi, type SupplierIdentifierInput, type IdentifierType } from '../../api/accounting.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter, Pager,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';

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
  is_active: boolean; auxiliary_code: string | null; updated_at: string;
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
  address: string; city: string; notes: string;
  identifiers: Record<string, { value: string; qualifier: string }>;
};

function emptyForm(): FormState {
  return {
    name: '', legalName: '', legalForm: '', vatRegime: 'assujetti', parentSupplierId: '',
    contactName: '', phone: '', email: '', address: '', city: '', notes: '', identifiers: {},
  };
}

function formFromSupplier(s: Supplier): FormState {
  const identifiers: FormState['identifiers'] = {};
  for (const i of s.identifiers) identifiers[i.typeCode] = { value: i.value, qualifier: i.qualifier ?? '' };
  return {
    name: s.name, legalName: s.legal_name ?? '', legalForm: s.legal_form ?? '', vatRegime: s.vat_regime,
    parentSupplierId: s.parent_supplier_id ?? '', contactName: s.contact_name ?? '', phone: s.phone ?? '',
    email: s.email ?? '', address: s.address ?? '', city: s.city ?? '', notes: s.notes ?? '', identifiers,
  };
}

const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 };
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';
const sectionTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--theme-text-muted)', margin: '6px 0 2px' };

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
// Pastille de situation : un point de couleur + libellé (pas de pilule, pour ne pas
// répéter l'alerte déjà portée par la colonne ICE).
const STAGE_DOT: Record<string, string> = {
  incomplete: '#d9822b', ordering: '#3b82f6', due: '#c99a06', ok: '#28a745', inactive: '#adb5bd',
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

  const { data: board, isLoading, isFetching } = useQuery({
    queryKey: ['suppliers', 'board', boardParams],
    queryFn: () => suppliersApi.board(boardParams),
    placeholderData: (prev) => prev,
  });
  const { data: summary } = useQuery({ queryKey: ['suppliers', 'board-summary'], queryFn: suppliersApi.boardSummary });
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

  /** Prochaine action selon la situation (bouton principal de la ligne). */
  const nextAction = (s: Supplier & Record<string, any>): { label: string; run: () => void; cls: string } | null => {
    switch (s.stage as string) {
      case 'incomplete':
        return { label: 'Compléter la fiche', run: () => openEdit(s), cls: 'odoo-btn-primary' };
      case 'ordering':
        return onOpenOrders
          ? { label: 'Voir ses BC', run: () => onOpenOrders(s.id), cls: Number(s.late_po_count) > 0 ? 'odoo-btn-danger' : 'odoo-btn-primary' }
          : null;
      case 'due':
        return onOpenInvoices
          ? { label: 'Voir ses factures', run: () => onOpenInvoices(s.id), cls: Number(s.overdue_invoice_count) > 0 ? 'odoo-btn-danger' : 'odoo-btn-primary' }
          : null;
      case 'inactive':
        return { label: 'Réactiver', run: () => askReactivate(s), cls: 'odoo-btn-secondary' };
      default:
        return null;
    }
  };

  /**
   * Complément de la situation : seulement ce que les autres colonnes ne disent pas
   * (l'ICE manquant est déjà signalé dans sa colonne, le reste dû dans la sienne).
   */
  const stageDetail = (s: Record<string, any>): string | null => {
    const k = Number(s.open_po_count) || 0;
    const openPo = k > 0 ? `${k} BC ouvert${k > 1 ? 's' : ''} · ${n(parseFloat(s.open_po_amount) || 0)} DH` : null;
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
    <th onClick={() => toggleSort(field)} aria-sort={sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align }}>
      {label}{' '}
      {sortBy !== field
        ? <ArrowUpDown size={10} style={{ opacity: 0.3, verticalAlign: 'middle' }} />
        : sortDir === 'asc' ? <ArrowUp size={10} style={{ verticalAlign: 'middle' }} /> : <ArrowDown size={10} style={{ verticalAlign: 'middle' }} />}
    </th>
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

      {/* Situation de la relation : une carte par étape, clic = filtre */}
      <StagePipeline
        title="Où en sont mes fournisseurs"
        summary={`${openCount} actif${openCount > 1 ? 's' : ''} · ${n(openDue)} DH restant dus`}
        stages={SUP_STAGES}
        stats={Object.fromEntries(SUP_STAGES.map(s => {
          const st = stageStats[s.key];
          if (!st) return [s.key, undefined];
          const sub = s.key === 'ordering' ? `${n(st.openPo)} DH`
            : s.key === 'due' || s.key === 'incomplete' ? (st.due > 0 ? `${n(st.due)} DH dus` : '')
            : s.key === 'ok' ? `${n(st.p12)} DH` : '';
          return [s.key, { count: st.count, sub, late: st.late }];
        }))}
        isActive={k => (k === 'inactive' ? view === 'history' : view === 'open' && stage === k)}
        onPick={pickStage}
      />

      {/* Barre de vue + nouveau fournisseur */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <ViewSwitch view={view} onChange={switchView}
          openLabel={`Actifs · ${openCount}`} historyLabel={`Inactifs · ${inactiveCount}`} />
        {view === 'open' && stage && (
          <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Situation : {SUP_STAGES.find(s => s.key === stage)?.label}
            <button type="button" onClick={() => setStage('')} aria-label="Retirer le filtre de situation" style={{ display: 'inline-flex' }}>
              <X size={11} />
            </button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={openNew} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouveau fournisseur
        </button>
      </div>

      {/* Recherche + filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par nom, raison sociale, contact, ville ou identifiant (ICE, IF…)"
          aria-label="Rechercher un fournisseur"
          value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input"
          style={{ flex: '1 1 220px', minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        <SelectFilter label="Critère" icon={Filter} value={flag} onChange={setFlag} options={SUP_FLAGS[view]} />
        <SelectFilter label="Ville" icon={MapPin} value={city} onChange={setCity} options={cityOptions} allLabel="Toutes" />
        <PeriodFilter label="Commandé" title="Fournisseurs ayant au moins un BC commandé sur la période"
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des fournisseurs...</p>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Truck size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {view === 'open' ? (stage ? 'Aucun fournisseur dans cette situation' : 'Aucun fournisseur actif') : 'Aucun fournisseur inactif'}
          </p>
          {hasFilters && (
            <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>
              Aucun résultat pour ces filtres —{' '}
              <button type="button" onClick={resetFilters} style={{ textDecoration: 'underline', color: 'inherit' }}>les effacer</button>
            </p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                {sortableTh('name', 'Fournisseur')}
                <th>Contact</th>
                {sortableTh('city', 'Ville')}
                <th>ICE / TVA</th>
                <th style={{ minWidth: 190 }}>Situation</th>
                {sortableTh('last_order_date', 'Dernière commande')}
                {sortableTh('purchased_12m', 'Achats 12 mois', 'right')}
                {sortableTh('amount_due', 'Reste dû', 'right')}
                <th style={{ textAlign: 'right' }}>Prochaine action</th>
                <th style={{ textAlign: 'right', width: 70 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => {
                const ice = s.identifiers.find(i => i.typeCode === 'MA_ICE')?.value ?? s.ice;
                const due = parseFloat(s.amount_due) || 0;
                const p12 = parseFloat(s.purchased_12m) || 0;
                const overdue = Number(s.overdue_invoice_count) || 0;
                const latePo = Number(s.late_po_count) || 0;
                const action = nextAction(s);
                return (
                  <tr key={s.id} onClick={() => openEdit(s)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        <Truck size={11} style={{ color: 'var(--theme-accent)' }} />
                        {s.name}
                        {s.parent_supplier_name && <span className="odoo-tag odoo-tag-grey" title="Enseigne de">{s.parent_supplier_name}</span>}
                      </span>
                      {s.legal_name && s.legal_name !== s.name && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginLeft: 17 }}>{s.legal_name}</div>
                      )}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>
                      <div>{s.contact_name || (s.phone ? '' : '—')}</div>
                      {s.phone && <div style={{ fontSize: '0.6875rem' }}>{s.phone}</div>}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{s.city || '—'}</td>
                    <td style={{ fontSize: '0.6875rem' }}>
                      {ice ? (
                        <div style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--odoo-text)' }}>{ice}</div>
                      ) : s.missing_id ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#b85d1a', fontWeight: 600, fontSize: '0.75rem' }}
                          title="Assujetti sans ICE : ses factures ne sont pas des pièces probantes">
                          <AlertTriangle size={11} /> ICE à saisir
                        </div>
                      ) : (
                        <div style={{ color: 'var(--theme-text-muted)' }}>—</div>
                      )}
                      <div style={{ color: 'var(--theme-text-muted)' }}>{s.vat_regime === 'assujetti' ? 'Assujetti' : s.vat_regime === 'exonere' ? 'Exonéré' : 'Non assujetti'}</div>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--odoo-text)' }}>
                        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: STAGE_DOT[s.stage as string] ?? '#adb5bd' }} />
                        {SUP_STAGES.find(x => x.key === s.stage)?.label}
                      </span>
                      {stageDetail(s) && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginTop: 2, marginLeft: 14 }}>{stageDetail(s)}</div>
                      )}
                      {(latePo > 0 || overdue > 0) && (
                        <div style={{ fontSize: '0.6875rem', color: '#dc3545', marginTop: 2, marginLeft: 14 }}>
                          {[latePo > 0 && `${latePo} livraison${latePo > 1 ? 's' : ''} en retard`, overdue > 0 && `${overdue} facture${overdue > 1 ? 's' : ''} échue${overdue > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>
                      {fmtDate(s.last_order_date as string) ?? <span style={{ fontStyle: 'italic' }}>jamais</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p12 > 0 ? <><span style={{ fontWeight: 600 }}>{n(p12)}</span> <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>DH</span></>
                        : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {due > 0.005 ? <><span style={{ fontWeight: 700, color: overdue > 0 ? '#dc3545' : undefined }}>{n(due)}</span> <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>DH</span></>
                        : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      {action && <button type="button" onClick={action.run} className={action.cls}>{action.label}</button>}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 2 }}>
                        <button onClick={() => openEdit(s)} className="odoo-pager-btn" title="Modifier" aria-label="Modifier"><Pencil size={13} /></button>
                        {s.is_active ? (isAdmin && (
                          <button className="odoo-pager-btn" title="Désactiver" aria-label="Désactiver" style={{ color: '#dc3545' }}
                            onClick={async () => {
                              if (await confirm(`Désactiver le fournisseur « ${s.name} » ? Il n'apparaîtra plus dans les sélections ; l'historique (BC, factures, paiements) est conservé.`, { title: 'Désactiver un fournisseur', confirmLabel: 'Désactiver', danger: true })) {
                                deactivateMutation.mutate(s.id);
                              }
                            }}>
                            <Trash2 size={13} />
                          </button>
                        )) : (
                          <button className="odoo-pager-btn" title="Réactiver" aria-label="Réactiver" style={{ color: '#28a745' }}
                            onClick={() => askReactivate(s)}>
                            <RotateCcw size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} total={total} onPage={setPage}
            note={view === 'open'
              ? `Fournisseurs actifs${period !== 'all' ? ` ayant commandé (${periodLabel(period, customFrom, customTo)})` : ''} — les inactifs sont dans l'onglet Inactifs.`
              : 'Fournisseurs désactivés : l\'historique (BC, factures, paiements) reste consultable.'} />
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
    mutationFn: () => {
      const identifiers: SupplierIdentifierInput[] = Object.entries(form.identifiers)
        .filter(([, v]) => v.value.trim())
        .map(([typeCode, v]) => ({ typeCode, value: v.value.trim(), qualifier: v.qualifier.trim() || null }));
      const payload = {
        name: form.name.trim(), legalName: form.legalName, legalForm: form.legalForm || null, vatRegime: form.vatRegime,
        parentSupplierId: form.parentSupplierId || null, contactName: form.contactName, phone: form.phone, email: form.email,
        address: form.address, city: form.city, notes: form.notes, identifiers,
      };
      return supplier ? suppliersApi.update(supplier.id, payload) : suppliersApi.create(payload);
    },
    onSuccess: () => { notify.success(supplier ? 'Fournisseur modifié' : 'Fournisseur créé'); onSaved(); },
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const errorText = (k: string) => fieldErrors[k] ? <div style={{ color: '#dc3545', fontSize: '0.75rem', marginTop: 2 }}>{fieldErrors[k]}</div> : null;

  const renderIdentifier = (t: IdentifierType, required: boolean) => {
    const st = idStatus(t);
    return (
      <div key={t.code}>
        <label style={fieldLabel}>{t.label}{required ? ' *' : ''}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={form.identifiers[t.code]?.value ?? ''} onChange={e => setIdent(t.code, { value: e.target.value })}
            className={inputCls} inputMode={t.pattern?.startsWith('^[0-9]') ? 'numeric' : undefined}
            style={{ fontFamily: 'ui-monospace, monospace', ...(st ? { borderColor: st.ok ? '#28a745' : '#d97706' } : {}) }} />
          {t.code.endsWith('_RC') && (
            <input value={form.identifiers[t.code]?.qualifier ?? ''} onChange={e => setIdent(t.code, { qualifier: e.target.value })}
              className={inputCls} placeholder="Ville du tribunal" style={{ maxWidth: 150 }} />
          )}
        </div>
        <div style={{ fontSize: '0.6875rem', marginTop: 3, color: st ? (st.ok ? '#28a745' : '#b45309') : 'var(--theme-text-muted)' }}>
          {st ? (st.ok ? '✓ ' : '') + st.msg : t.description}
        </div>
      </div>
    );
  };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 720, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Truck size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="odoo-breadcrumb-current">{supplier ? supplier.name : 'Nouveau fournisseur'}</span>
          </div>
          <div style={{ flex: 1 }} />
          {supplier && (
            <div style={{ display: 'inline-flex', gap: 2, marginRight: 8 }}>
              <button type="button" onClick={() => setTab('fiche')} className={tab === 'fiche' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '3px 10px' }}>Fiche</button>
              <button type="button" onClick={() => setTab('historique')} className={tab === 'historique' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '3px 10px', display: 'inline-flex', gap: 4, alignItems: 'center' }}><History size={12} /> Historique</button>
            </div>
          )}
          <button type="button" onClick={onClose} className="odoo-pager-btn" title="Fermer (Échap)"><X size={14} /></button>
        </div>

        {tab === 'historique' && supplier ? (
          <SupplierHistory rows={history as HistoryRow[]} loading={historyLoading} />
        ) : (
          <form onSubmit={e => { e.preventDefault(); setFieldErrors({}); saveMutation.mutate(); }} className="flex-1 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              {duplicates.length > 0 && (
                <StatusBanner tone="danger" icon={AlertTriangle} title="Doublon probable">
                  {duplicates.map(d => <div key={d.id + d.reason}>« {d.name} » porte déjà {d.reason === 'name' ? 'ce nom' : `cet identifiant ${d.reason}`}.</div>)}
                </StatusBanner>
              )}

              {/* 1. Type : pilote les identifiants exigés (remplace le « Régime TVA »). */}
              <div>
                <div style={sectionTitle}><Building2 size={12} /> Type de fournisseur</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2" style={{ marginTop: 6 }}>
                  {SUPPLIER_KINDS.map(k => {
                    const active = form.vatRegime === k.regime;
                    return (
                      <button key={k.regime} type="button" onClick={() => set('vatRegime', k.regime)} aria-pressed={active}
                        style={{ textAlign: 'left', padding: '0.6rem 0.75rem', borderRadius: 6, cursor: 'pointer',
                          border: `1px solid ${active ? 'var(--theme-accent)' : 'var(--theme-bg-separator)'}`,
                          backgroundColor: active ? 'var(--theme-accent-light, #eef4ff)' : '#fff' }}>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: '0.8125rem', color: active ? 'var(--theme-accent)' : 'var(--theme-text-strong)' }}>{k.label}</span>
                        <span style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>{k.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. L'essentiel : ce qu'on saisit au quotidien. */}
              <div>
                <div style={sectionTitle}><Phone size={12} /> L'essentiel</div>
                <div className="grid grid-cols-2 gap-3" style={{ marginTop: 6 }}>
                  <div className="col-span-2"><label style={fieldLabel}>Nom du fournisseur *</label>
                    <input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} required minLength={2} maxLength={200} autoFocus
                      placeholder="Tel qu'on l'appelle au quotidien, ex : Ovotec, Marjane, Souk Ahmed" />
                    {errorText('name')}
                  </div>
                  <div><label style={fieldLabel}>Téléphone</label>
                    <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls} maxLength={20} placeholder="06 12 34 56 78" /></div>
                  <div><label style={fieldLabel}>Personne à contacter</label>
                    <input value={form.contactName} onChange={e => set('contactName', e.target.value)} className={inputCls} maxLength={100} placeholder="Commercial, livreur…" /></div>
                  <div><label style={fieldLabel}>Ville</label>
                    <input value={form.city} onChange={e => set('city', e.target.value)} className={inputCls} maxLength={100} /></div>
                  <div><label style={fieldLabel}>Email</label>
                    <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} maxLength={255} placeholder="Pour l'envoi des BC" />
                    {errorText('email')}</div>
                </div>
              </div>

              {/* 3. Identifiants fiscaux : ICE / IF en tête, contrôlés à la frappe. */}
              {identifierTypes.length > 0 && (
                <div>
                  <div style={sectionTitle}><FileBadge2 size={12} /> Identifiants fiscaux
                    {!needsFiscalIds && <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 0 }}>— facultatifs</span>}
                  </div>
                  {brandMode ? (
                    <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 6 }}>
                      Enseigne d'un groupe : l'ICE et l'IF sont ceux de l'entité juridique choisie plus bas.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3" style={{ marginTop: 6 }}>
                        {mainIdTypes.map(t => renderIdentifier(t, needsFiscalIds && form.vatRegime === 'assujetti'))}
                      </div>
                      {missingIce && form.name.trim().length >= 2 && (
                        <p style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 6, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                          Sans ICE, les factures de ce fournisseur ne permettent pas de déduire la TVA. Vous pouvez enregistrer et compléter plus tard.
                        </p>
                      )}
                      {otherIdTypes.length > 0 && (
                        <Disclosure label={`Autres identifiants (${otherIdTypes.map(t => t.label).join(', ')})`} defaultOpen={hasOtherIds}>
                          <div className="grid grid-cols-2 gap-3">{otherIdTypes.map(t => renderIdentifier(t, false))}</div>
                        </Disclosure>
                      )}
                    </>
                  )}
                  {errorText('identifiers')}
                </div>
              )}

              {/* 4. Identité légale et groupe : rarement utile, replié. */}
              <Disclosure label="Identité légale et groupe" hint="raison sociale, forme juridique, enseigne d'un groupe"
                defaultOpen={!!(form.legalName || form.legalForm || isGroupBrand)}>
                <div className="grid grid-cols-2 gap-3">
                  <div><label style={fieldLabel}>Raison sociale</label>
                    <input value={form.legalName} onChange={e => set('legalName', e.target.value)} className={inputCls} maxLength={200} placeholder="Si différente du nom" /></div>
                  <div><label style={fieldLabel}>Forme juridique</label>
                    <SearchSelect options={LEGAL_FORM_OPTIONS} value={form.legalForm} onChange={id => set('legalForm', id)}
                      placeholder="Rechercher : SARL, SA, coopérative…" width="100%" size="md" /></div>
                  <label className="col-span-2" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.8125rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={brandMode} style={{ marginTop: 3 }}
                      onChange={e => { setBrandMode(e.target.checked); if (!e.target.checked) set('parentSupplierId', ''); }} />
                    <span>C'est une enseigne d'un groupe
                      <span style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>Ex : Supeco appartient à Label'Vie — les identifiants fiscaux sont ceux du groupe.</span>
                    </span>
                  </label>
                  {brandMode && (
                    <div className="col-span-2"><label style={fieldLabel}>Groupe (entité juridique) *</label>
                      <SearchSelect options={parentOptions} value={form.parentSupplierId} onChange={id => set('parentSupplierId', id)}
                        placeholder="Rechercher le groupe…" width="100%" size="md" />
                      {errorText('parentSupplierId')}
                    </div>
                  )}
                </div>
              </Disclosure>

              {/* 5. Adresse et notes : replié. */}
              <Disclosure label="Adresse et notes" defaultOpen={!!(form.address || form.notes)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div><label style={fieldLabel}>Adresse</label><input value={form.address} onChange={e => set('address', e.target.value)} className={inputCls} /></div>
                  <div><label style={fieldLabel}>Notes</label><textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} className={inputCls}
                    placeholder="Jours de livraison, conditions, minimum de commande…" /></div>
                </div>
              </Disclosure>

              {supplier?.auxiliary_code && (
                <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', margin: 0 }}>
                  Compte auxiliaire : <span style={{ fontFamily: 'ui-monospace, monospace' }}>{supplier.auxiliary_code}</span>
                  {' · '}dernière modification {format(new Date(supplier.updated_at), 'd MMM yyyy HH:mm', { locale: fr })}
                </p>
              )}
            </div>
            <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ marginRight: 'auto', fontSize: '0.75rem', color: missingIce ? '#b45309' : 'var(--theme-text-muted)' }}>
                {missingIce ? 'ICE à compléter' : brandMode && !form.parentSupplierId ? 'Choisissez le groupe' : ''}
              </span>
              <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
              <button type="submit" disabled={saveMutation.isPending || (brandMode && !form.parentSupplierId)} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                {supplier ? 'Enregistrer' : 'Créer le fournisseur'}
              </button>
            </div>
          </form>
        )}
      </div>
    </ModalBackdrop>
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
    <div style={{ borderTop: '1px solid var(--theme-bg-separator)', paddingTop: 8, marginTop: 4 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--theme-text-strong)', width: '100%', textAlign: 'left' }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
        {hint && !open && <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>— {hint}</span>}
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
  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}><Loader2 className="animate-spin" size={18} /></div>;
  }
  if (rows.length === 0) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>Aucune modification journalisée depuis l'activation de la piste d'audit.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
      <table className="odoo-table">
        <thead><tr><th>Quand</th><th>Qui</th><th>Objet</th><th>Changement</th></tr></thead>
        <tbody>
          {rows.map(r => {
            const objet = r.table_name === 'suppliers' ? 'Fiche'
              : `Identifiant ${(r.new_row?.type_code ?? r.old_row?.type_code ?? '') as string}`.trim();
            return (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--theme-text-muted)' }}>{format(new Date(r.changed_at), 'd MMM yyyy HH:mm', { locale: fr })}</td>
                <td>{r.changed_by_name || <span style={{ color: 'var(--theme-text-muted)' }}>système</span>}</td>
                <td>{objet}</td>
                <td>
                  {r.operation === 'INSERT' && <span className="odoo-tag odoo-tag-green">création</span>}
                  {r.operation === 'DELETE' && <span className="odoo-tag odoo-tag-grey">suppression</span>}
                  {r.operation === 'UPDATE' && r.diff && (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: '0.8125rem' }}>
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
    </div>
  );
}
