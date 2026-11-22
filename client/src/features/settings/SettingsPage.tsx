import { currencySymbol } from '../../utils/money';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettings } from '../../context/SettingsContext';
import { usePermissions } from '../../context/PermissionsContext';
import { allowedSettingsSections } from '@ofauria/shared';
import { settingsApi } from '../../api/settings.api';
import SalesChannelsManager from '../sales/SalesChannelsManager';
import { Upload, Image, Eye, Check, Search, Lock, Users, ExternalLink, ChevronDown, ChevronRight, EyeOff, History, Menu } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { FormField } from '../../components/ds';
import PrinterSettingsCard from './PrinterSettingsCard';
import SachetsTab from './SachetsTab';
import SectorTab from './SectorTab';
import WorkshopsCard from './WorkshopsCard';
import ProductionMarkupTab from './ProductionMarkupTab';
import AuditLogTab from './AuditLogTab';
import NumberingTab from './NumberingTab';
import ParametersPanel, { RulesSummary } from './ParametersPanel';
import { purchasingSettingsApi } from '../../api/purchasing-settings.api';
import SodMonitor from './SodMonitor';
import ProductCategoriesTab from './ProductCategoriesTab';
import CompanyPage from './CompanyPage';
import StoresPanel from './StoresPanel';
import TaxCodesTab from './TaxCodesTab';
import CountryPackTab from './CountryPackTab';
import CurrenciesTab from './CurrenciesTab';
import MailTab from './MailTab';
import CustomFieldsTab from './CustomFieldsTab';
import JobsTab from './JobsTab';
import DocumentsTab from './DocumentsTab';
import NotificationsTab from './NotificationsTab';
import DataTab from './DataTab';
import DataQualityTab from './DataQualityTab';
import ApprovalsTab from './ApprovalsTab';
import IntegrationsTab from './IntegrationsTab';
import RfqCriteriaCard from './RfqCriteriaCard';
import ReceptionQcCategoriesCard from './ReceptionQcCategoriesCard';
import RevenueFamiliesCard from './RevenueFamiliesCard';
import ReferentielTab from './ReferentielTab';
import UnitsTab from './UnitsTab';
import SettingsSearch from './SettingsSearch';
import SetupHome from './SetupHome';
import { tableLabel } from './AuditLogTab';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { SettingsSection, SettingItem, SettingsTabs, SETTINGS_REVEAL_EVENT, PageNote } from './SettingsPrimitives';
import { DirtyFormsProvider, SaveBar, useDirtyForm, useDirtyForms, useDraft } from './DirtyForms';
import { HOME_PAGE, LEGACY_PAGES, SETTINGS_GROUPS, SETTINGS_PAGES, USERS_GROUP, type SearchEntry, type SettingsPageKey } from './settingsPages';
import '../projects/projects.css';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Breadcrumb, HeaderSlotContext } from '../../components/ds';

export default function SettingsPage() {
  const { hasModule } = usePermissions();
  // Acces par le droit « Parametres » (ecran Utilisateurs), eventuellement
  // restreint a certaines sections ; meme regle que le serveur.
  if (!hasModule('settings')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p style={{ color: 'var(--ds-muted)' }}>Vous n'avez pas accès aux paramètres.</p>
      </div>
    );
  }
  return (
    <DirtyFormsProvider>
      <SettingsShell />
    </DirtyFormsProvider>
  );
}

/* ============ COQUILLE : navigation groupee, fil d'Ariane, ⌘K ============ */

function SettingsShell() {
  const { hasModule, canEdit, getModuleConfig, moduleActive, sectorLabel } = usePermissions();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const dirtyForms = useDirtyForms();
  const [searchOpen, setSearchOpen] = useState(false);
  // Écran étroit (lot S5) : le menu est un tiroir replié sous un bouton « page courante ».
  const [navOpen, setNavOpen] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const allowedSections = allowedSettingsSections(getModuleConfig('settings'));
  const readOnly = !canEdit('settings');
  // Pages permises par le droit « Paramètres », puis masquage de celles dont aucun module
  // n'est activé pour la société (lot S1) ; libellés selon le vocabulaire du secteur.
  const permitted = useMemo(
    () => (allowedSections
      ? SETTINGS_PAGES.filter(p => [p.section, ...(p.alsoSections ?? [])].some(s => allowedSections.includes(s)))
      : SETTINGS_PAGES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(allowedSections)],
  );
  const canSection = (s: string) => !allowedSections || allowedSections.includes(s as (typeof allowedSections)[number]);
  const isActive = (p: (typeof SETTINGS_PAGES)[number]) => !p.modules || p.modules.some(m => moduleActive(m));
  const pages = permitted.filter(isActive)
    .map(p => (p.labelKey ? { ...p, label: sectorLabel(p.labelKey, p.label) } : p));
  const hiddenCount = permitted.length - pages.length;

  // Pastilles du menu (lot S2) : points « à faire » du bilan de paramétrage, par page.
  const { data: setup } = useQuery({ queryKey: ['settings', 'setup'], queryFn: settingsApi.setup, staleTime: 60_000 });
  const todoByPage = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of setup?.checks ?? []) {
      const page = LEGACY_PAGES[c.page] ?? c.page;
      if (c.status === 'todo') m.set(page, (m.get(page) ?? 0) + 1);
    }
    return m;
  }, [setup]);
  const todoBadge = (n: number, what: string) => (n > 0
    ? <span className="odoo-settings-nav-badge" title={`${n} point${n > 1 ? 's' : ''} à faire ${what}`}>{n}</span>
    : null);
  const canOpenSector = pages.some(p => p.key === 'sector');

  // Groupes repliables : celui de la page ouverte reste déplié ; l'état est retenu par
  // navigateur (commodité seulement, l'écran marche sans stockage).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('kalum.settings.collapsed') ?? '[]') as string[]); } catch { return new Set(); }
  });
  const toggleGroup = (group: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(group)) next.delete(group); else next.add(group);
    try { localStorage.setItem('kalum.settings.collapsed', JSON.stringify([...next])); } catch { /* stockage indisponible */ }
    return next;
  });
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const rawPage = params.get('page');
  const requested = (rawPage ? LEGACY_PAGES[rawPage] ?? rawPage : null) as SettingsPageKey | null;
  // Page absente, inconnue ou non permise : accueil de la configuration (lot B).
  const current = pages.find(p => p.key === requested) ?? HOME_PAGE;
  const isHome = current.key === 'home';

  /** Quitte les brouillons en cours apres confirmation ; true si on peut continuer. */
  const confirmLeave = useCallback(async () => {
    if (!dirtyForms?.hasChanges()) return true;
    const ok = await confirm('Les modifications non enregistrées de cette page seront perdues.', {
      title: 'Quitter sans enregistrer ?', confirmLabel: 'Quitter sans enregistrer', cancelLabel: 'Rester', danger: true,
    });
    if (ok) dirtyForms.resetAll();
    return ok;
  }, [dirtyForms, confirm]);

  const goTo = useCallback(async (page: SettingsPageKey, opts: { anchor?: string; extra?: Record<string, string> } = {}) => {
    if (page !== current?.key && !(await confirmLeave())) return;
    const next = new URLSearchParams({ page, ...(opts.extra ?? {}) });
    if (next.toString() !== params.toString()) setParams(next);
    setNavOpen(false);
    if (opts.anchor) setPendingAnchor(opts.anchor);
  }, [current?.key, confirmLeave, params, setParams]);

  const leaveTo = async (href: string) => { if (await confirmLeave()) navigate(href); };

  // ⌘K / Ctrl+K : recherche dans les reglages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Apres une recherche : attend que le reglage soit affiche (donnees chargees), le fait
  // defiler a l'ecran et le surligne brievement.
  useEffect(() => {
    if (!pendingAnchor) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(pendingAnchor);
      if (el || ++tries > 40) {
        window.clearInterval(timer);
        setPendingAnchor(null);
        if (!el) return;
        // Réglage dans un onglet inactif (lot S3) : l'onglet s'ouvre, puis on défile.
        const hidden = !!el.closest('[hidden]');
        if (hidden) el.dispatchEvent(new CustomEvent(SETTINGS_REVEAL_EVENT, { bubbles: true }));
        window.setTimeout(() => {
          const target = (el.closest('tr') as HTMLElement | null) ?? el;
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.remove('odoo-setting-flash');
          void target.offsetWidth;
          target.classList.add('odoo-setting-flash');
          window.setTimeout(() => target.classList.remove('odoo-setting-flash'), 2000);
          target.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
        }, hidden ? 60 : 0);
      }
    }, 75);
    return () => window.clearInterval(timer);
  }, [pendingAnchor, current?.key]);

  const onSearchSelect = (e: SearchEntry) => { void goTo(e.page, { anchor: e.anchor, extra: e.extra }); };

  if (!pages.length) {
    return <div className="odoo-scope"><p className="odoo-settings-subtitle">Aucune section des paramètres ne vous est ouverte.</p></div>;
  }

  const pageContent: Record<SettingsPageKey, React.ReactNode> = {
    home: <SetupHome pages={pages} onOpen={(page, anchor) => void goTo(page, { anchor })} onOpenUsers={() => void leaveTo('/users')} />,
    company: <CompanyPage onOpen={(page, anchor) => void goTo(page, { anchor })} onLeave={href => void leaveTo(href)} />,
    sector: <SectorTab />,
    stores: <StoresPanel />,
    appearance: <AppearanceTab />,
    print: <PrintTab />,
    channels: <SalesChannelsTab />,
    production: (
      <SettingsTabs label="Réglages de production" tabs={[
        { key: 'workshops', label: 'Ateliers', content: <WorkshopsCard /> },
        { key: 'costs', label: 'Coûts et prix',
          content: <ParametersPanel keys={['production.fixed_charges', 'production.steps_blocking', 'pricing.rounding', 'stock.negative_policy', 'stock.dlc_alerts']} /> },
        { key: 'markup', label: 'Majoration', content: <ProductionMarkupTab /> },
      ]} />
    ),
    purchasing: (
      <div style={{ display: 'grid', gap: 16 }}>
        <PurchasingOverview />
        <ParametersPanel domains={['purchasing']} extras={{
          'Réception': <ReceptionQcCategoriesCard />,
          'Contrôles internes': <SodMonitor compact />,
          'Fournisseurs': <RfqCriteriaCard />,
        }} />
      </div>
    ),
    salesRules: <ParametersPanel keys={['sales.quotes', 'sales.dunning', 'sales.pricing', 'sales.legal_mentions', 'sales.vat_regime', 'sales.stamp_duty', 'sales.returns']} />,
    // Règles de caisse + contrôle des sachets (ex-page Sachets, lot S3) : chaque partie
    // suit sa section du droit « Paramètres ».
    posRules: (
      <>
        {canSection('business') && <ParametersPanel keys={['sales.pos_stock', 'sales.person_sizes', 'sales.closure', 'sales.staff_discount']} />}
        {canSection('sachets') && <SachetsTab />}
      </>
    ),
    productCategories: <ProductCategoriesTab />,
    tax: <TaxCodesTab />,
    countryPack: <CountryPackTab />,
    currencies: <CurrenciesTab />,
    numbering: <NumberingTab />,
    documents: <DocumentsTab />,
    ledger: (
      <div style={{ display: 'grid', gap: 16 }}>
        <ParametersPanel keys={['ledger.posting_mode', 'accounting.card_commission']} />
        <RevenueFamiliesCard />
      </div>
    ),
    referentiel: <ReferentielTab />,
    units: <UnitsTab />,
    data: <DataTab />,
    dataQuality: <DataQualityTab />,
    // G1-12 : les seuils des échéances du personnel se règlent avec les notifications.
    notifications: <><NotificationsTab /><ParametersPanel keys={['hr.documents_due']} /></>,
    mail: <MailTab />,
    customFields: <CustomFieldsTab />,
    jobs: <JobsTab />,
    approvals: <ApprovalsTab />,
    integrations: <IntegrationsTab />,
    audit: <AuditLogTab />,
  };
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  return (
    <div className="odoo-scope odoo-settings-shell" style={{ background: 'transparent' }}>
      <div className="odoo-settings">
        <aside className={`odoo-settings-nav${navOpen ? ' open' : ''}`} aria-label="Pages des paramètres">
          <button type="button" className="odoo-settings-nav-toggle" aria-expanded={navOpen} aria-controls="settings-nav-body"
            onClick={() => setNavOpen(o => !o)}>
            <Menu size={15} aria-hidden="true" />
            <span>{isHome ? HOME_PAGE.label : `${current.group} › ${current.label}`}</span>
            {navOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
          <button type="button" className="odoo-settings-nav-search" onClick={() => setSearchOpen(true)}>
            <Search size={14} /> Rechercher…
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <div id="settings-nav-body" className="odoo-settings-nav-body">
          <div className="odoo-settings-nav-group" style={{ borderTop: 'none', paddingTop: 0 }}>
            <button type="button" className={`odoo-settings-nav-item${isHome ? ' active' : ''}`}
              aria-current={isHome ? 'page' : undefined} onClick={() => void goTo('home')}>
              <HOME_PAGE.icon size={15} /> {HOME_PAGE.label}
            </button>
          </div>
          {SETTINGS_GROUPS.map(group => {
            const items = pages.filter(p => p.group === group);
            const usersLink = group === USERS_GROUP && hasModule('users');
            if (!items.length && !usersLink) return null;
            const open = !collapsed.has(group) || items.some(p => p.key === current.key);
            const GroupIcon = open ? ChevronDown : ChevronRight;
            const groupTodo = items.reduce((n, p) => n + (todoByPage.get(p.key) ?? 0), 0) + (usersLink ? todoByPage.get('users') ?? 0 : 0);
            return (
              <nav key={group} className="odoo-settings-nav-group" aria-label={group}>
                <button type="button" className="odoo-settings-nav-group-title" aria-expanded={open} onClick={() => toggleGroup(group)}>
                  {group}
                  <span className="odoo-settings-nav-group-end">
                    {!open && todoBadge(groupTodo, 'dans ce groupe')}
                    <GroupIcon size={13} aria-hidden="true" />
                  </span>
                </button>
                {open && items.map(p => {
                  const Icon = p.icon;
                  const active = p.key === current.key;
                  return (
                    <button key={p.key} type="button" className={`odoo-settings-nav-item${active ? ' active' : ''}`}
                      aria-current={active ? 'page' : undefined} onClick={() => void goTo(p.key)}>
                      <Icon size={15} /> {p.label}
                      {active && dirtyForms?.hasChanges()
                        ? <span className="odoo-settings-nav-dot" title="Modifications non enregistrées" />
                        : todoBadge(todoByPage.get(p.key) ?? 0, 'sur cette page')}
                    </button>
                  );
                })}
                {open && usersLink && (
                  <button type="button" className="odoo-settings-nav-item" onClick={() => void leaveTo('/users')}>
                    <Users size={15} /> Utilisateurs et droits
                    <span className="odoo-settings-nav-group-end">{todoBadge(todoByPage.get('users') ?? 0, 'sur cet écran')}<ExternalLink size={12} /></span>
                  </button>
                )}
              </nav>
            );
          })}
          {hiddenCount > 0 && (
            <div className="odoo-settings-nav-hidden">
              <EyeOff size={13} aria-hidden="true" />
              <span>
                {hiddenCount} page{hiddenCount > 1 ? 's' : ''} masquée{hiddenCount > 1 ? 's' : ''} (modules inactifs)
                {canOpenSector && <> · <button type="button" onClick={() => void goTo('sector')}>Gérer</button></>}
              </span>
            </div>
          )}
          </div>
        </aside>

        <div className="odoo-settings-main">
          {/* Design Ventes (2026-11-18) : barre de fil d'Ariane + actions de la page, puis grand titre. */}
          <div className="odoo-control-bar odoo-settings-bar">
            <Breadcrumb items={[
              { label: 'Paramètres', onClick: () => void goTo('home') },
              ...(!isHome ? [{ label: current.group }] : []),
              { label: current.label },
            ]} />
            <div style={{ flex: 1 }} />
            {current.auditTable && (
              <PageHistory table={current.auditTable}
                onOpen={pages.some(p => p.key === 'audit') ? () => void goTo('audit', { extra: { table: current.auditTable! } }) : undefined} />
            )}
            {/* Actions de la page (exports, action principale) : même place que dans les modules. */}
            <div ref={setHeaderSlot} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} />
          </div>
          <div className="odoo-settings-body kl-page">
            <header className="kl-largetitle">
              <h1>{current.label}</h1>
              {current.description && <p>{current.description}</p>}
            </header>
            {readOnly && !isHome && current.key !== 'audit' && (
              <StatusBanner tone="info" icon={Lock} title="Consultation seule">
                Votre droit « Paramètres » ne permet pas de modifier : les enregistrements seront refusés.
                Un administrateur peut l'étendre depuis Utilisateurs.
              </StatusBanner>
            )}
            {!isHome && <PageToc key={`toc-${current.key}`} />}
            <HeaderSlotContext.Provider value={headerSlot}>
              <div key={current.key} style={{ display: 'grid', gap: '1.5rem', minWidth: 0 }}>
                {pageContent[current.key]}
              </div>
            </HeaderSlotContext.Provider>
          </div>
          <SaveBar readOnly={readOnly} />
        </div>
      </div>

      {/* Monte a l'ouverture seulement : chaque recherche repart d'une saisie vide. */}
      {searchOpen && <SettingsSearch open onClose={() => setSearchOpen(false)} pages={pages} onSelect={onSearchSelect} />}
    </div>
  );
}

/* ============ ACHATS : résumé des contrôles et circuit ============ */

function PurchasingOverview() {
  const { data: sod } = useQuery({ queryKey: ['purchasing-sod'], queryFn: purchasingSettingsApi.getSod, staleTime: 30_000 });
  const gaps = (sod?.violations ?? []).reduce((n, v) => n + Number(v.occurrences), 0);
  const steps = ["Demande d'achat", 'Bon de commande', 'Réception', 'Facture', 'Paiement'];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <RulesSummary domains={['purchasing']} extra={sod?.rules?.length ? { label: 'Écarts journalisés · 90 j', value: gaps } : undefined} />
      <div className="odoo-params-flow">
        <span>Le circuit :</span>
        {steps.map((s, i) => <span key={s} className="odoo-params-flow-step">{i > 0 && <em>→</em>}<b>{s}</b></span>)}
        <span>· chaque bloc ci-dessous règle une étape</span>
      </div>
    </div>
  );
}

/* ============ EN-TÊTE DE PAGE : historique et sommaire (lot S4) ============ */

/** Dernière modification de l'objet suivi par la page, et lien vers son historique. */
function PageHistory({ table, onOpen }: { table: string; onOpen?: () => void }) {
  const { data } = useQuery({
    queryKey: ['audit-log', 'last', table],
    queryFn: () => settingsApi.auditLog({ table, limit: 1 }),
    staleTime: 30_000, retry: 0,
  });
  const last = data?.rows[0];
  return (
    <div className="odoo-settings-history" title={`Objet suivi par le journal : ${tableLabel(table)}`}>
      {last && (
        <span>
          Modifié le {format(new Date(last.changed_at), 'd MMM yyyy à HH:mm', { locale: fr })}
          {last.changed_by_name ? ` par ${last.changed_by_name}` : ''}
        </span>
      )}
      {onOpen && (
        <button type="button" onClick={onOpen}><History size={13} aria-hidden="true" /> Historique de cette page</button>
      )}
    </div>
  );
}

/**
 * « Sur cette page » : raccourcis vers les blocs de la page (titres marqués data-toc),
 * affichés à partir de 3 blocs ; suit l'onglet ouvert et le chargement des données.
 */
function PageToc() {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const body = ref.current?.parentElement;
    if (!body) return;
    const scan = () => {
      const found = [...body.querySelectorAll<HTMLElement>('[data-toc]')]
        .filter(el => el.id && !el.closest('[hidden]') && !el.parentElement?.closest('[data-toc]'))
        .map(el => ({ id: el.id, label: el.dataset.toc ?? '' }));
      setItems(prev => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found));
    };
    scan();
    const obs = new MutationObserver(scan);
    obs.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    return () => obs.disconnect();
  }, []);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav ref={ref} className="odoo-settings-toc" aria-label="Sur cette page" hidden={items.length < 3}>
      <span className="odoo-settings-toc-title">Sur cette page</span>
      {items.map(it => <button key={it.id} type="button" onClick={() => go(it.id)}>{it.label}</button>)}
    </nav>
  );
}

/* ============ APPEARANCE TAB ============ */

const THEME_PRESETS = [
  {
    name: 'Dore',
    desc: 'Clair, chaud, boulangerie',
    icon: '🥖',
    values: {
      themeBgPage: '#FAF6F1', themeBgCard: '#FFFDF9', themeBgSecondary: '#F3ECE2', themeBgSeparator: '#E8DDD0',
      themeTextStrong: '#2D1810', themeTextBody: '#5C3D2E', themeTextMuted: '#8B7355',
      themeAccent: '#C4872B', themeAccentHover: '#A8721F', themeAccentLight: '#F5E6CC',
      themeCtaColor: '#C4872B', themeCtaText: '#FFFFFF',
    },
  },
  {
    name: 'Terroir',
    desc: 'Sombre, chaud, immersif',
    icon: '🌿',
    values: {
      themeBgPage: '#1E1714', themeBgCard: '#2A211C', themeBgSecondary: '#362B25', themeBgSeparator: '#4A3D35',
      themeTextStrong: '#F5EDE7', themeTextBody: '#D4C4B8', themeTextMuted: '#A89585',
      themeAccent: '#7FA37E', themeAccentHover: '#6B8E6A', themeAccentLight: '#2D3D2C',
      themeCtaColor: '#7FA37E', themeCtaText: '#FFFFFF',
    },
  },
  {
    name: 'Classique',
    desc: 'Blanc neutre, standard',
    icon: '📋',
    values: {
      themeBgPage: '#F9FAFB', themeBgCard: '#FFFFFF', themeBgSecondary: '#F3F4F6', themeBgSeparator: '#E5E7EB',
      themeTextStrong: '#111827', themeTextBody: '#374151', themeTextMuted: '#6B7280',
      themeAccent: '#714B67', themeAccentHover: '#5f3d57', themeAccentLight: '#F3E8F0',
      themeCtaColor: '#714B67', themeCtaText: '#FFFFFF',
    },
  },
  {
    name: 'Ocean',
    desc: 'Bleu, frais, professionnel',
    icon: '🌊',
    values: {
      themeBgPage: '#F0F4F8', themeBgCard: '#FFFFFF', themeBgSecondary: '#E2E8F0', themeBgSeparator: '#CBD5E1',
      themeTextStrong: '#0F172A', themeTextBody: '#334155', themeTextMuted: '#64748B',
      themeAccent: '#2563EB', themeAccentHover: '#1D4ED8', themeAccentLight: '#DBEAFE',
      themeCtaColor: '#2563EB', themeCtaText: '#FFFFFF',
    },
  },
];

type ThemeKey = keyof typeof THEME_PRESETS[0]['values'];

const THEME_FIELDS: { key: ThemeKey; label: string; group: string }[] = [
  { key: 'themeBgPage', label: 'Fond de page', group: 'Surfaces' },
  { key: 'themeBgCard', label: 'Cartes / Panneaux', group: 'Surfaces' },
  { key: 'themeBgSecondary', label: 'Zones secondaires', group: 'Surfaces' },
  { key: 'themeBgSeparator', label: 'Bordures / Séparateurs', group: 'Surfaces' },
  { key: 'themeTextStrong', label: 'Titres', group: 'Texte' },
  { key: 'themeTextBody', label: 'Corps de texte', group: 'Texte' },
  { key: 'themeTextMuted', label: 'Texte secondaire', group: 'Texte' },
  { key: 'themeAccent', label: 'Accent principal', group: 'Accents' },
  { key: 'themeAccentHover', label: 'Accent survol', group: 'Accents' },
  { key: 'themeAccentLight', label: 'Accent léger (fond)', group: 'Accents' },
  { key: 'themeCtaColor', label: 'Bouton action (CTA)', group: 'Bouton principal' },
  { key: 'themeCtaText', label: 'Texte du bouton', group: 'Bouton principal' },
];

function AppearanceTab() {
  const { settings, updateSettings } = useSettings();
  const { draft: theme, setDraft: setTheme, set: setColor, mark, changes, reset, adopt } = useDraft<Record<ThemeKey, string>>(
    Object.fromEntries(THEME_FIELDS.map(f => [f.key, (settings as unknown as Record<string, string>)[f.key]])) as Record<ThemeKey, string>,
  );
  const invalidColor = THEME_FIELDS.find(f => !/^#[0-9a-fA-F]{6}$/.test(theme[f.key] ?? ''));
  useDirtyForm('appearance', {
    dirty: changes > 0, changes, reset,
    invalid: invalidColor ? `Couleur « ${invalidColor.label} » incomplète (format #RRGGBB).` : null,
    save: async () => { await updateSettings(theme); adopt(); },
  });

  const applyPreset = (preset: typeof THEME_PRESETS[0]) => {
    setTheme(preset.values);
  };

  const groups = [...new Set(THEME_FIELDS.map(f => f.group))];

  return (
    <>
      <SettingsSection
        title="Thèmes prédéfinis"
        description="Sélectionnez un thème de base puis personnalisez les couleurs"
        columns={1}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {THEME_PRESETS.map(preset => {
            const isActive = Object.entries(preset.values).every(([k, v]) => theme[k as ThemeKey] === v);
            return (
              <button key={preset.name} type="button" onClick={() => applyPreset(preset)} aria-pressed={isActive}
                className="relative flex flex-col items-center gap-2 p-4 rounded-2xl transition-all text-left"
                style={{
                  background: 'var(--theme-bg-card)',
                  boxShadow: isActive
                    ? '0 0 0 2px var(--theme-accent), 0 6px 20px rgba(15, 23, 42, .08)'
                    : 'inset 0 0 0 1px var(--theme-bg-separator)',
                }}>
                {isActive && (
                  <span className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--theme-accent)' }}>
                    <Check size={12} style={{ color: 'var(--theme-cta-text, #fff)' }} />
                  </span>
                )}
                {/* Mini preview */}
                <div className="w-full h-16 rounded-lg overflow-hidden "
                  style={{ background: preset.values.themeBgPage, border: '1px solid var(--ds-line)' }}>
                  <div className="h-4 flex items-center px-2" style={{ background: preset.values.themeAccent }}>
                    <span className="text-[6px] font-bold" style={{ color: preset.values.themeCtaText }}>{settings.companyName}</span>
                  </div>
                  <div className="p-1.5 flex gap-1">
                    <div className="w-5 h-5 rounded" style={{ background: preset.values.themeBgCard, border: `1px solid ${preset.values.themeBgSeparator}` }} />
                    <div className="w-5 h-5 rounded" style={{ background: preset.values.themeBgCard, border: `1px solid ${preset.values.themeBgSeparator}` }} />
                    <div className="flex-1 rounded" style={{ background: preset.values.themeBgSecondary }} />
                  </div>
                </div>
                <span className="text-lg">{preset.icon}</span>
                <span className="font-semibold text-sm" style={{ color: 'var(--theme-text-strong)' }}>{preset.name}</span>
                <span className="text-xs text-center" style={{ color: 'var(--ds-muted)' }}>{preset.desc}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      {/* Custom color pickers by group */}
      {groups.map(group => (
        <SettingsSection key={group} title={group}>
          {THEME_FIELDS.filter(f => f.group === group).map(field => (
            <SettingItem key={field.key} {...mark(field.key)} htmlFor={`theme-${field.key}`} title={field.label}>
              <div className="flex gap-2">
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(theme[field.key]) ? theme[field.key] : '#000000'}
                  onChange={e => setColor(field.key, e.target.value)} aria-label={`${field.label} : couleur`}
                  className="ds-input" style={{ width: 48, padding: 2, cursor: 'pointer' }} />
                <input id={`theme-${field.key}`} type="text" value={theme[field.key]}
                  onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value) || e.target.value === '') setColor(field.key, e.target.value); }}
                  className="ds-input" aria-invalid={!/^#[0-9a-fA-F]{6}$/.test(theme[field.key])} style={{ fontFamily: 'ui-monospace, monospace', maxWidth: 140 }} placeholder="#000000" maxLength={7} />
              </div>
            </SettingItem>
          ))}
        </SettingsSection>
      ))}

      <SettingsSection title="Aperçu en direct" columns={1}>
        <div className="rounded-2xl overflow-hidden" style={{ boxShadow: 'inset 0 0 0 1px var(--theme-bg-separator)' }}>
          {/* Header preview */}
          <div className="h-14 flex items-center px-5" style={{ background: theme.themeAccent }}>
            <span className="font-bold tracking-wide" style={{ color: theme.themeCtaText }}>{settings.companyName}</span>
            <span className="text-sm ml-2" style={{ color: theme.themeCtaText, opacity: 0.6 }}>/ Caisse</span>
            <div className="flex-1" />
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: `${theme.themeCtaText}33`, color: theme.themeCtaText }}>SF</div>
          </div>

          {/* Content preview */}
          <div className="p-5 flex gap-4" style={{ background: theme.themeBgPage }}>
            {/* Product cards */}
            <div className="flex-1 space-y-3">
              <div className="flex gap-3">
                {['Pain complet', 'Croissant', 'Muffin'].map(name => (
                  <div key={name} className="flex-1 rounded-xl p-3"
                    style={{ background: theme.themeBgCard, border: `1px solid ${theme.themeBgSeparator}` }}>
                    <div className="text-center text-2xl mb-2">{name === 'Pain complet' ? '🥖' : name === 'Croissant' ? '🥐' : '🧁'}</div>
                    <p className="text-sm font-semibold" style={{ color: theme.themeTextStrong }}>{name}</p>
                    <p className="text-sm font-bold" style={{ color: theme.themeAccent }}>8.00 {currencySymbol()}</p>
                    <p className="text-xs" style={{ color: theme.themeTextMuted }}>Stock: 24</p>
                  </div>
                ))}
              </div>
              {/* Category chips */}
              <div className="flex gap-2">
                <span className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: theme.themeAccentLight, color: theme.themeAccent }}>
                  Tous
                </span>
                <span className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: theme.themeBgSecondary, color: theme.themeTextMuted }}>
                  Pains
                </span>
                <span className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: theme.themeBgSecondary, color: theme.themeTextMuted }}>
                  Patisseries
                </span>
              </div>
            </div>

            {/* Cart preview */}
            <div className="w-48 rounded-xl flex flex-col"
              style={{ background: theme.themeBgCard, border: `1px solid ${theme.themeBgSeparator}` }}>
              <div className="px-3 py-2.5" style={{ borderBottom: `1px solid ${theme.themeBgSecondary}` }}>
                <span className="font-bold text-sm" style={{ color: theme.themeTextStrong }}>Panier</span>
              </div>
              <div className="px-3 py-2 text-xs space-y-2 flex-1">
                <div className="flex justify-between">
                  <span style={{ color: theme.themeTextBody }}>Pain complet x2</span>
                  <span className="font-semibold" style={{ color: theme.themeTextStrong }}>16.00</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.themeTextBody }}>Croissant x3</span>
                  <span className="font-semibold" style={{ color: theme.themeTextStrong }}>10.50</span>
                </div>
                <div className="pt-2 flex justify-between font-bold text-sm"
                  style={{ borderTop: `1px solid ${theme.themeBgSeparator}`, color: theme.themeAccent }}>
                  <span>Total</span><span>26.50 {currencySymbol()}</span>
                </div>
              </div>
              <div className="p-2">
                <button type="button" className="w-full py-2.5 rounded-lg text-sm font-bold transition-colors"
                  style={{ background: theme.themeCtaColor, color: theme.themeCtaText }}>
                  Encaisser
                </button>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

/* ============ PRINT TAB ============ */

const PRINT_KEYS = [
  'logoUrl', 'receiptShowLogo', 'receiptLogoSize', 'receiptHeader', 'receiptFooter', 'receiptFontSize', 'receiptPaperWidth',
  'receiptShowCashier', 'receiptShowDate', 'receiptShowPaymentDetail', 'receiptExtraLines', 'receiptAutoPrint',
  'receiptOpenDrawer', 'receiptNumCopies',
] as const;
type PrintDraft = Pick<ReturnType<typeof useSettings>['settings'], typeof PRINT_KEYS[number]>;

function PrintTab() {
  const { settings, updateSettings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { draft, set, mark, changes, reset, adopt } = useDraft<PrintDraft>(
    Object.fromEntries(PRINT_KEYS.map(k => [k, settings[k]])) as PrintDraft,
  );
  useDirtyForm('print', {
    dirty: changes > 0, changes, reset,
    save: async () => { await updateSettings(draft); adopt(); },
  });
  const {
    logoUrl, receiptShowLogo, receiptLogoSize, receiptHeader, receiptFooter, receiptFontSize, receiptPaperWidth,
    receiptShowCashier, receiptShowDate, receiptShowPaymentDetail, receiptExtraLines, receiptAutoPrint, receiptOpenDrawer, receiptNumCopies,
  } = draft;
  const setter = <K extends keyof PrintDraft>(k: K) => (v: PrintDraft[K]) => set(k, v);
  const setLogoUrl = setter('logoUrl');
  const setReceiptShowLogo = setter('receiptShowLogo');
  const setReceiptLogoSize = setter('receiptLogoSize');
  const setReceiptHeader = setter('receiptHeader');
  const setReceiptFooter = setter('receiptFooter');
  const setReceiptFontSize = setter('receiptFontSize');
  const setReceiptPaperWidth = setter('receiptPaperWidth');
  const setReceiptShowCashier = setter('receiptShowCashier');
  const setReceiptShowDate = setter('receiptShowDate');
  const setReceiptShowPaymentDetail = setter('receiptShowPaymentDetail');
  const setReceiptExtraLines = setter('receiptExtraLines');
  const setReceiptAutoPrint = setter('receiptAutoPrint');
  const setReceiptOpenDrawer = setter('receiptOpenDrawer');
  const setReceiptNumCopies = setter('receiptNumCopies');

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify.error('Le fichier ne doit pas dépasser 10 Mo');
      return;
    }
    setUploading(true);
    try {
      const result = await settingsApi.uploadLogo(file);
      setLogoUrl(result.url);
      notify.success('Logo téléchargé');
    } catch {
      notify.error('Erreur lors du téléchargement');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
  };

  // Resolve logo source — /uploads paths are proxied to the API server
  const logoSrc = logoUrl || '/images/logo-horizontal.png';

  const nowStr = format(new Date(), "dd MMMM yyyy 'a' HH:mm", { locale: fr });

  return (
    <div className="odoo-settings-with-preview">
      {/* Reglages */}
      <div style={{ display: 'grid', gap: '1.5rem', minWidth: 0 }}>
        <PrinterSettingsCard />

        <SettingsSection title="Logo" columns={1}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem' }}>
            <div style={{ flexShrink: 0, width: 128, height: 80, borderRadius: 6, border: '2px dashed var(--odoo-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--odoo-bg-alt)', overflow: 'hidden' }}>
              {logoUrl ? (
                <img src={logoSrc} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>
                  <Image size={24} style={{ margin: '0 auto 4px' }} />
                  <span style={{ fontSize: 10 }}>Logo par défaut</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1, display: 'grid', gap: 8 }}>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={handleLogoUpload} style={{ display: 'none' }} />
              <p className="odoo-setting-help">Logo affiché sur les reçus et tickets (PNG, JPG, SVG — 10 Mo maximum)</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="odoo-btn-secondary">
                  <Upload size={13} />
                  {uploading ? 'Téléchargement…' : 'Télécharger un logo'}
                </button>
                {logoUrl && (
                  <button type="button" onClick={handleRemoveLogo} className="odoo-btn-danger">Supprimer</button>
                )}
              </div>
            </div>
          </div>
          <SettingItem
            {...mark('receiptShowLogo')} title="Afficher le logo sur le reçu"
            description="Le logo apparaît en haut du ticket imprimé"
            toggle={{ checked: receiptShowLogo, onChange: setReceiptShowLogo }}
          >
            {receiptShowLogo && (
              <div style={{ maxWidth: 320 }}>
                <FormField label={`Taille du logo (px) : ${receiptLogoSize}`} htmlFor="receipt-logo-size">
                  <input id="receipt-logo-size" type="range" min="20" max="80" value={receiptLogoSize}
                    onChange={(e) => setReceiptLogoSize(parseInt(e.target.value))} style={{ accentColor: 'var(--ds-accent)' }} />
                </FormField>
              </div>
            )}
          </SettingItem>
        </SettingsSection>

        <SettingsSection title="Contenu du reçu" columns={1}>
          <SettingItem {...mark('receiptHeader')} htmlFor="receipt-header" title="En-tête supplémentaire" description="Affiché sous le sous-titre (adresse, téléphone, ICE…)">
            <input id="receipt-header" type="text" value={receiptHeader} onChange={(e) => setReceiptHeader(e.target.value)}
              className="ds-input" style={{ maxWidth: 448 }} placeholder="Ex. : adresse, téléphone, ICE…" />
          </SettingItem>
          <SettingItem {...mark('receiptFooter')} htmlFor="receipt-footer" title="Message de pied de page" description="Texte de remerciement en bas du ticket">
            <input id="receipt-footer" type="text" value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)}
              className="ds-input" style={{ maxWidth: 448 }} placeholder="Merci pour votre visite !" />
          </SettingItem>
          <SettingItem {...mark('receiptExtraLines')} htmlFor="receipt-extra" title="Lignes supplémentaires" description="Chaque ligne sera affichée en bas du reçu">
            <textarea id="receipt-extra" value={receiptExtraLines} onChange={(e) => setReceiptExtraLines(e.target.value)}
              className="ds-input" style={{ maxWidth: 448 }} rows={3}
              placeholder="Ex. : horaires d'ouverture, conditions de retour…" />
          </SettingItem>
        </SettingsSection>

        <SettingsSection title="Options d'affichage">
          <SettingItem {...mark('receiptShowCashier')} title="Nom du caissier" description="Affiche le caissier sur le ticket"
            toggle={{ checked: receiptShowCashier, onChange: setReceiptShowCashier }} />
          <SettingItem {...mark('receiptShowDate')} title="Date et heure" description="Affiche la date de la vente"
            toggle={{ checked: receiptShowDate, onChange: setReceiptShowDate }} />
          <SettingItem {...mark('receiptShowPaymentDetail')} title="Détail du paiement" description="Espèces reçues et monnaie rendue"
            toggle={{ checked: receiptShowPaymentDetail, onChange: setReceiptShowPaymentDetail }} />
        </SettingsSection>

        <SettingsSection title="Imprimante thermique">
          <SettingItem
            {...mark('receiptAutoPrint')} title="Impression automatique"
            description="Le reçu s'imprime après chaque encaissement sans cliquer sur Imprimer"
            toggle={{ checked: receiptAutoPrint, onChange: setReceiptAutoPrint }}
          />
          <SettingItem
            {...mark('receiptOpenDrawer')} title="Ouvrir le tiroir-caisse"
            description="Le tiroir s'ouvre à chaque impression (tiroir connecté à l'imprimante)"
            toggle={{ checked: receiptOpenDrawer, onChange: setReceiptOpenDrawer }}
          />
          <SettingItem {...mark('receiptNumCopies')} htmlFor="receipt-copies" title="Nombre de copies" description="Nombre de reçus imprimés à chaque vente">
            <select id="receipt-copies" value={receiptNumCopies} onChange={(e) => setReceiptNumCopies(parseInt(e.target.value))}
              className="ds-input" style={{ width: 160 }}>
              <option value={1}>1 copie</option>
              <option value={2}>2 copies</option>
              <option value={3}>3 copies</option>
            </select>
          </SettingItem>
          <div>
            <PageNote help="Installez le pilote de l'imprimante thermique (USB ou réseau), choisissez-la comme imprimante par défaut du navigateur et désactivez ses en-têtes et pieds de page. Le tiroir-caisse se branche sur le port RJ11/DK de l'imprimante.">
              Imprimante thermique par défaut du navigateur, sans en-têtes ni pieds de page.
            </PageNote>
          </div>
        </SettingsSection>

        <SettingsSection title="Format d'impression">
          <SettingItem {...mark('receiptFontSize')} htmlFor="receipt-font" title="Taille de police" description={`Texte du ticket : ${receiptFontSize} px`}>
            <input id="receipt-font" type="range" min="9" max="16" value={receiptFontSize}
              onChange={(e) => setReceiptFontSize(parseInt(e.target.value))}
              style={{ width: '100%', maxWidth: 320, accentColor: 'var(--ds-accent)' }} />
          </SettingItem>
          <SettingItem {...mark('receiptPaperWidth')} htmlFor="receipt-width" title="Largeur du papier" description="Format du rouleau thermique">
            <select id="receipt-width" value={receiptPaperWidth} onChange={(e) => setReceiptPaperWidth(parseInt(e.target.value))}
              className="ds-input" style={{ width: 176 }}>
              <option value={58}>58 mm (petit)</option>
              <option value={80}>80 mm (standard)</option>
            </select>
          </SettingItem>
        </SettingsSection>
      </div>

        {/* Live receipt preview */}
        <div className="odoo-settings-preview">
          <div className="ds-panel" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Eye size={15} style={{ color: 'var(--ds-muted)' }} />
              <h3 className="odoo-setting-label" style={{ margin: 0 }}>Aperçu du reçu</h3>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, overflow: 'hidden', maxWidth: `${Math.min(receiptPaperWidth * 3.2, 280)}px`, margin: '0 auto' }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: `${Math.max(receiptFontSize - 2, 8)}px`, color: '#000', lineHeight: 1.4 }}>
                {/* Logo */}
                {receiptShowLogo && (
                  <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                    <img src={logoSrc} alt="Logo"
                      style={{ height: `${receiptLogoSize * 0.6}px`, margin: '0 auto', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}

                {/* Subtitle */}
                <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 3, 7)}px`, color: '#555', marginBottom: '2px' }}>
                  {settings.subtitle}
                </div>

                {/* Header */}
                {receiptHeader && (
                  <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 3, 7)}px`, color: '#555', marginBottom: '2px' }}>
                    {receiptHeader}
                  </div>
                )}

                {/* Divider */}
                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Info */}
                <div style={{ fontSize: `${Math.max(receiptFontSize - 2, 8)}px` }}>
                  <div>N: VNT-20260404-0001</div>
                  {receiptShowDate && <div>Date: {nowStr}</div>}
                  {receiptShowCashier && <div>Caissier: Aniss B.</div>}
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Items */}
                <div>
                  <div style={{ fontWeight: 'bold' }}>Pain complet</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '6px' }}>
                    <span>2 x 8.00 {currencySymbol()}</span>
                    <span style={{ fontWeight: 'bold' }}>16.00 {currencySymbol()}</span>
                  </div>
                  <div style={{ fontWeight: 'bold', marginTop: '2px' }}>Croissant beurre</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '6px' }}>
                    <span>3 x 5.00 {currencySymbol()}</span>
                    <span style={{ fontWeight: 'bold' }}>15.00 {currencySymbol()}</span>
                  </div>
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Totals */}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Sous-total</span>
                  <span>31.00 {currencySymbol()}</span>
                </div>
                <div style={{ borderTop: '2px solid #000', margin: '3px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: `${receiptFontSize}px` }}>
                  <span>TOTAL</span>
                  <span>31.00 {currencySymbol()}</span>
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />

                {/* Payment */}
                <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 2, 8)}px` }}>
                  Paye par: <strong>Especes</strong>
                </div>
                {receiptShowPaymentDetail && (
                  <div style={{ fontSize: `${Math.max(receiptFontSize - 2, 8)}px` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Montant donne</span><span>50.00 {currencySymbol()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                      <span>Monnaie rendue</span><span>19.00 {currencySymbol()}</span>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
                <div style={{ textAlign: 'center', fontSize: `${Math.max(receiptFontSize - 3, 7)}px`, color: '#555' }}>
                  {receiptFooter && <p>{receiptFooter}</p>}
                  <p>A bientot chez {settings.companyName}</p>
                  {receiptExtraLines && receiptExtraLines.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}

// ─── Canaux de vente (mig 172) ───
function SalesChannelsTab() {
  return (
    <SettingsSection
      title="Canaux de vente"
      description="Boutique, commande, événement, gros, livraison… Chaque vente est rattachée à un canal. Les prix peuvent être différents par canal (voir fiche produit)."
      columns={1}
    >
      <SalesChannelsManager />
    </SettingsSection>
  );
}
