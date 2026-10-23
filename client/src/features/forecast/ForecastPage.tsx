import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, CalendarDays, Link2, Target, Loader2, ChevronLeft, ChevronRight, Search, Plus, Trash2, Pencil,
  CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  forecastApi, EVENT_KIND_LABELS,
  type CalendarEvent, type EventKind, type ForecastCell, type ForecastRow,
} from '../../api/forecast.api';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { useAuth } from '../../context/AuthContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Prévision de la demande (mig 314) : quantité suggérée par produit et par jour,
 * calculée sur l'historique de ventes (caisse ou Contrôle des ventes), les
 * événements du calendrier et la majoration de production. Le gérant peut
 * corriger une case (saisie manuelle) ; les chefs consultent.
 */

type Tab = 'grille' | 'evenements' | 'liens' | 'precision';
const TABS: Array<{ key: Tab; label: string; icon: typeof TrendingUp; managerOnly?: boolean }> = [
  { key: 'grille', label: 'Prévisions', icon: TrendingUp },
  { key: 'evenements', label: 'Calendrier', icon: CalendarDays },
  { key: 'liens', label: 'Produits à relier', icon: Link2, managerOnly: true },
  { key: 'precision', label: 'Précision', icon: Target, managerOnly: true },
];

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const addDays = (date: string, n: number) => iso(new Date(parseISO(date).getTime() + n * 86_400_000));
const CONF_TAG = { haute: 'odoo-tag-green', moyenne: 'odoo-tag-yellow', faible: 'odoo-tag-grey' } as const;
const METHOD_LABEL: Record<ForecastCell['method'], string> = {
  meme_jour: 'Mêmes jours de semaine',
  evenement: 'Historique de l\'événement',
  moyenne: 'Moyenne récente (peu d\'historique)',
  ferme: 'Fermé',
  insuffisant: 'Historique insuffisant',
  manuel: 'Saisie manuelle',
};

export default function ForecastPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = TABS.filter(t => canEdit || !t.managerOnly);
  const tab = (tabs.some(t => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'grille') as Tab;
  const setTab = (t: Tab) => {
    if (t === 'grille') searchParams.delete('tab'); else searchParams.set('tab', t);
    setSearchParams(searchParams, { replace: true });
  };
  const current = tabs.find(t => t.key === tab)!;

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <TrendingUp size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Prévision de la demande</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{current.label}</span>
        </div>
      </div>
      <div className="odoo-tabs">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'grille' && <GridTab canEdit={canEdit} onTab={setTab} />}
        {tab === 'evenements' && <EventsTab canEdit={canEdit} />}
        {tab === 'liens' && canEdit && <LinksTab />}
        {tab === 'precision' && canEdit && <AccuracyTab />}
      </div>
    </div>
  );
}

/* ═══════════════════════ GRILLE ═══════════════════════ */

function GridTab({ canEdit, onTab }: { canEdit: boolean; onTab: (t: Tab) => void }) {
  const qc = useQueryClient();
  const tomorrow = addDays(iso(new Date()), 1);
  const [from, setFrom] = useState(tomorrow);
  const to = addDays(from, 6);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<{ productId: string; date: string; value: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast-grid', from, to],
    queryFn: () => forecastApi.grid({ from, to }),
  });
  const { data: unmapped = [] } = useQuery({ queryKey: ['forecast-unmapped'], queryFn: forecastApi.unmapped, enabled: canEdit });

  const save = useMutation({
    mutationFn: (p: { productId: string; date: string; value: string }) => p.value.trim() === ''
      ? forecastApi.deleteOverride(p.productId, p.date)
      : forecastApi.setOverride({ productId: p.productId, date: p.date, quantity: Math.max(0, Math.round(Number(p.value))) }),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['forecast-grid'] }); },
    onError: (e) => notify.error(e),
  });

  const rows = useMemo(() => (data?.rows ?? []).filter(r =>
    (!category || String(r.category_id) === category)
    && (!search || r.product_name.toLowerCase().includes(search.toLowerCase()))), [data, search, category]);
  const categories = useMemo(() => [...new Map((data?.rows ?? [])
    .filter(r => r.category_id != null).map(r => [String(r.category_id), r.category_name ?? ''])).entries()], [data]);
  const grouped = useMemo(() => {
    const m = new Map<string, ForecastRow[]>();
    for (const r of rows) { const k = r.category_name ?? 'Sans catégorie'; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()];
  }, [rows]);
  const dates = data?.dates ?? [];
  const eventsByDate = useMemo(() => Object.fromEntries(dates.map(d => [d,
    (data?.events ?? []).filter(e => e.date_start <= d && d <= e.date_end)])), [data, dates]);
  const unsoldVolume = unmapped.filter(u => u.sold_60d > 0);

  const commit = () => { if (editing && !save.isPending) save.mutate(editing); };

  return (
    <>
      {canEdit && unsoldVolume.length > 0 && (
        <StatusBanner tone="orange" icon={AlertTriangle} title={`${unsoldVolume.length} produit(s) Loyverse vendus mais non reliés au catalogue`}
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => onTab('liens')}>Relier</button>}>
          Leurs ventes ne comptent pas encore dans la prévision.
        </StatusBanner>
      )}

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
        <button type="button" className="odoo-btn-secondary" aria-label="Semaine précédente" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={14} /></button>
        <input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className="odoo-search-input" style={{ width: 150 }} aria-label="Premier jour" />
        <button type="button" className="odoo-btn-secondary" aria-label="Semaine suivante" onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={14} /></button>
        {from !== tomorrow && <button type="button" className="odoo-btn-secondary" onClick={() => setFrom(tomorrow)}>Demain</button>}
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--theme-text-muted)' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Produit…" className="odoo-search-input" style={{ paddingLeft: 26, width: 180 }} aria-label="Rechercher un produit" />
        </span>
        <select value={category} onChange={e => setCategory(e.target.value)} className="odoo-search-input" aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginLeft: 'auto' }}>
          {rows.length} produit(s){canEdit && ' · cliquez sur une case pour la corriger'}
        </span>
      </div>

      {isLoading ? <Loading /> : error ? (
        <StatusBanner tone="danger" icon={AlertTriangle} title="Prévision indisponible">{String((error as any)?.response?.data?.error?.message ?? error)}</StatusBanner>
      ) : rows.length === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Aucun produit à prévoir">
          Aucune vente enregistrée sur les 8 dernières semaines pour ce magasin (caisse ou Contrôle des ventes).
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Produit</th>
                {dates.map(d => (
                  <th key={d} style={{ textAlign: 'right', minWidth: 78, background: eventsByDate[d]?.length ? '#fff3cd' : undefined }}
                    title={eventsByDate[d]?.map(e => `${e.label} (${e.uplift_pct >= 0 ? '+' : ''}${e.uplift_pct} %)`).join(', ') || undefined}>
                    <div style={{ textTransform: 'capitalize' }}>{format(parseISO(d), 'EEE dd/MM', { locale: fr })}</div>
                    {eventsByDate[d]?.[0] && <div style={{ fontSize: '0.625rem', fontWeight: 500, color: '#856404' }}>{eventsByDate[d][0].label}</div>}
                  </th>
                ))}
                <th>Confiance</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([cat, list]) => [
                <tr key={`h-${cat}`}>
                  <td style={{ background: 'var(--odoo-bg-hover)', fontWeight: 600, fontSize: '0.75rem' }}>{cat}</td>
                  {dates.map(d => (
                    <td key={d} style={{ background: 'var(--odoo-bg-hover)', textAlign: 'right', fontWeight: 600, fontSize: '0.75rem' }}>
                      {list.reduce((s, r) => s + (r.days[d]?.qty ?? 0), 0)}
                    </td>
                  ))}
                  <td style={{ background: 'var(--odoo-bg-hover)' }} />
                </tr>,
                ...list.map(r => (
                  <tr key={r.product_id}>
                    <td>{r.product_name}</td>
                    {dates.map(d => {
                      const c = r.days[d];
                      const isEditing = editing?.productId === r.product_id && editing.date === d;
                      if (isEditing) {
                        return (
                          <td key={d} style={{ textAlign: 'right' }}>
                            <input autoFocus type="number" min={0} value={editing.value} aria-label={`Quantité ${r.product_name} ${d}`}
                              onChange={e => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
                              onBlur={commit}
                              className="odoo-search-input" style={{ width: 64, textAlign: 'right' }} />
                          </td>
                        );
                      }
                      return (
                        <td key={d} title={`${METHOD_LABEL[c.method]}\n${c.explanation}${c.override_reason ? `\nMotif : ${c.override_reason}` : ''}`}
                          onClick={canEdit ? () => setEditing({ productId: r.product_id, date: d, value: c.method === 'manuel' ? String(c.qty) : '' }) : undefined}
                          style={{ textAlign: 'right', cursor: canEdit ? 'pointer' : 'default', color: c.qty === 0 ? 'var(--theme-text-muted)' : undefined }}>
                          {c.method === 'manuel' && <span className="odoo-tag odoo-tag-purple" style={{ marginRight: 4, padding: '0 4px' }}>M</span>}
                          <strong>{c.qty}</strong>
                          {c.actual != null && <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)' }}>vendu {c.actual}</div>}
                        </td>
                      );
                    })}
                    <td>{(() => { const c = r.days[dates[0]]; return c ? <span className={`odoo-tag ${CONF_TAG[c.confidence]}`}>{c.confidence}</span> : null; })()}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Calcul : moyenne pondérée des 6 derniers mêmes jours de semaine (hors événements), corrigée des ruptures, de la tendance (±10 % max),
        des événements du calendrier, puis majorée du taux de production de la catégorie. « M » = saisie manuelle ; videz la case pour revenir au calcul.
      </p>
    </>
  );
}

/* ═══════════════════════ CALENDRIER ═══════════════════════ */

type EventDraft = Omit<CalendarEvent, 'id' | 'store_id' | 'category_name'> & { id?: string; all_stores: boolean };
const EMPTY_EVENT = (): EventDraft => ({
  date_start: iso(new Date()), date_end: iso(new Date()), kind: 'fete', label: '', uplift_pct: 20, category_id: null, all_stores: true,
});

function EventsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [showPast, setShowPast] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ['forecast-events', showPast],
    queryFn: () => forecastApi.events(showPast ? undefined : iso(new Date())),
  });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['forecast-events'] }); qc.invalidateQueries({ queryKey: ['forecast-grid'] }); };
  const save = useMutation({
    mutationFn: (d: EventDraft) => forecastApi.saveEvent(d),
    onSuccess: () => { setDraft(null); invalidate(); notify.success('Événement enregistré'); },
    onError: (e) => notify.error(e),
  });
  const remove = useMutation({ mutationFn: forecastApi.deleteEvent, onSuccess: invalidate, onError: (e) => notify.error(e) });

  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
          <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} /> Afficher les événements passés
        </label>
        {canEdit && !draft && (
          <button type="button" className="odoo-btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setDraft(EMPTY_EVENT())}>
            <Plus size={13} /> Nouvel événement
          </button>
        )}
      </div>

      {draft && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
          <Field label="Libellé"><input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="odoo-search-input" placeholder="Aïd al-Adha" /></Field>
          <Field label="Type">
            <select value={draft.kind} onChange={e => {
              const kind = e.target.value as EventKind;
              setDraft({ ...draft, kind, uplift_pct: kind === 'fermeture' ? -100 : draft.uplift_pct === -100 ? 0 : draft.uplift_pct });
            }} className="odoo-search-input">
              {(Object.keys(EVENT_KIND_LABELS) as EventKind[]).map(k => <option key={k} value={k}>{EVENT_KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="Du"><input type="date" value={draft.date_start} onChange={e => setDraft({ ...draft, date_start: e.target.value, date_end: draft.date_end < e.target.value ? e.target.value : draft.date_end })} className="odoo-search-input" /></Field>
          <Field label="Au"><input type="date" value={draft.date_end} min={draft.date_start} onChange={e => setDraft({ ...draft, date_end: e.target.value })} className="odoo-search-input" /></Field>
          <Field label="Effet sur la demande (%)">
            <input type="number" value={draft.uplift_pct} disabled={draft.kind === 'fermeture'} min={-100} max={500}
              onChange={e => setDraft({ ...draft, uplift_pct: Number(e.target.value) })} className="odoo-search-input" />
          </Field>
          <Field label="Catégorie">
            <select value={draft.category_id ?? ''} onChange={e => setDraft({ ...draft, category_id: e.target.value ? Number(e.target.value) : null })} className="odoo-search-input">
              <option value="">Toutes</option>
              {(categories as Array<{ id: number; name: string }>).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
            <input type="checkbox" checked={draft.all_stores} onChange={e => setDraft({ ...draft, all_stores: e.target.checked })} /> Tous les magasins
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="odoo-btn-primary" disabled={!draft.label.trim() || save.isPending} onClick={() => save.mutate(draft)}>Enregistrer</button>
            <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
          </div>
        </div>
      )}

      {isLoading ? <Loading /> : data.length === 0 ? (
        <StatusBanner tone="info" icon={CalendarDays} title="Aucun événement à venir">
          Ajoutez Ramadan, les fêtes, les vacances scolaires ou les jours de fermeture : la prévision en tient compte, et exclut ces jours de l'historique normal.
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr><th>Événement</th><th>Type</th><th>Période</th><th style={{ textAlign: 'right' }}>Effet</th><th>Catégorie</th><th>Magasin</th>{canEdit && <th />}</tr>
            </thead>
            <tbody>
              {data.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.label}</td>
                  <td><span className={`odoo-tag ${e.kind === 'fermeture' ? 'odoo-tag-red' : 'odoo-tag-yellow'}`}>{EVENT_KIND_LABELS[e.kind]}</span></td>
                  <td>{format(parseISO(e.date_start), 'dd/MM/yyyy')}{e.date_end !== e.date_start && ` → ${format(parseISO(e.date_end), 'dd/MM/yyyy')}`}</td>
                  <td style={{ textAlign: 'right' }}>{e.kind === 'fermeture' ? 'Fermé' : `${e.uplift_pct >= 0 ? '+' : ''}${e.uplift_pct} %`}</td>
                  <td>{e.category_name ?? 'Toutes'}</td>
                  <td>{e.store_id ? 'Ce magasin' : 'Tous'}</td>
                  {canEdit && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="odoo-btn-secondary" aria-label="Modifier" onClick={() => setDraft({
                        id: e.id, date_start: e.date_start, date_end: e.date_end, kind: e.kind, label: e.label,
                        uplift_pct: e.uplift_pct, category_id: e.category_id, all_stores: e.store_id == null,
                      })}><Pencil size={12} /></button>{' '}
                      <button type="button" className="odoo-btn-danger" aria-label="Supprimer"
                        onClick={() => { if (window.confirm(`Supprimer « ${e.label} » ?`)) remove.mutate(e.id); }}><Trash2 size={12} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ PRODUITS À RELIER ═══════════════════════ */

function LinksTab() {
  const qc = useQueryClient();
  const [onlySold, setOnlySold] = useState(true);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const { data = [], isLoading } = useQuery({ queryKey: ['forecast-unmapped'], queryFn: forecastApi.unmapped });
  const { data: productsRes } = useQuery({
    queryKey: ['products-all-for-link'],
    queryFn: () => productsApi.list({ limit: '1000', page: '1' }),
  });
  const products = ((productsRes?.data ?? []) as Array<{ id: string; name: string }>).slice().sort((a, b) => a.name.localeCompare(b.name));
  const byName = useMemo(() => new Map(products.map(p => [p.name.toLowerCase(), p.id])), [products]);
  const link = useMutation({
    mutationFn: (p: { key: string; productId: string }) => forecastApi.link(p.key, p.productId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['forecast-unmapped'] }); qc.invalidateQueries({ queryKey: ['forecast-grid'] }); notify.success('Produit relié'); },
    onError: (e) => notify.error(e),
  });
  const rows = data.filter(u => !onlySold || u.sold_60d > 0);

  return (
    <>
      <StatusBanner tone="info" icon={Info} title="Pourquoi relier ?">
        Les ventes importées depuis Loyverse sont identifiées par leur nom ou leur SKU. Tant qu'un article n'est pas relié à un produit du catalogue,
        ses ventes n'alimentent ni la prévision ni la fiche de besoin. Les articles les plus vendus sont en tête.
      </StatusBanner>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
          <input type="checkbox" checked={onlySold} onChange={e => setOnlySold(e.target.checked)} /> Seulement les articles vendus ces 60 derniers jours
        </label>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{rows.length} article(s)</span>
      </div>
      <datalist id="forecast-products">{products.map(p => <option key={p.id} value={p.name} />)}</datalist>
      {isLoading ? <Loading /> : rows.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Tous les articles vendus sont reliés" />
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Article Loyverse</th><th>Catégorie Loyverse</th><th style={{ textAlign: 'right' }}>Vendu (60 j)</th><th>Produit du catalogue</th><th /></tr></thead>
            <tbody>
              {rows.map(u => {
                const typed = choice[u.product_key] ?? '';
                const productId = byName.get(typed.toLowerCase());
                return (
                  <tr key={u.product_key}>
                    <td style={{ fontWeight: 600 }}>{u.product_name}{u.sku && <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}> · {u.sku}</span>}</td>
                    <td>{u.category ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{u.sold_60d.toLocaleString('fr-FR')}</td>
                    <td>
                      <input list="forecast-products" value={typed} placeholder="Choisir un produit…" aria-label={`Produit pour ${u.product_name}`}
                        onChange={e => setChoice({ ...choice, [u.product_key]: e.target.value })} className="odoo-search-input" style={{ width: 260 }} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="odoo-btn-primary" disabled={!productId || link.isPending}
                        onClick={() => productId && link.mutate({ key: u.product_key, productId })}>Relier</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ PRÉCISION ═══════════════════════ */

function AccuracyTab() {
  const today = iso(new Date());
  const [from, setFrom] = useState(addDays(today, -28));
  const [to, setTo] = useState(addDays(today, -1));
  const { data, isLoading } = useQuery({ queryKey: ['forecast-accuracy', from, to], queryFn: () => forecastApi.accuracy(from, to) });
  const tone = (m: number | null) => (m == null ? 'odoo-tag-grey' : m <= 25 ? 'odoo-tag-green' : m <= 40 ? 'odoo-tag-yellow' : 'odoo-tag-red');

  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <span style={{ fontSize: '0.8125rem' }}>Du</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="odoo-search-input" style={{ width: 150 }} aria-label="Du" />
        <span style={{ fontSize: '0.8125rem' }}>au</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="odoo-search-input" style={{ width: 150 }} aria-label="Au" />
      </div>
      {isLoading ? <Loading /> : !data || data.days === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Pas encore de mesure">
          La précision se mesure sur les prévisions réellement utilisées (création d'un plan de production, fiche de besoin), comparées au vendu une fois la journée passée.
        </StatusBanner>
      ) : (
        <>
          <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">Erreur moyenne (MAPE)</div>
              <div className="odoo-stat-card-value">{data.mape == null ? '—' : `${data.mape} %`}</div>
              <div className="odoo-stat-card-sub">écart moyen entre prévu et vendu</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">Lignes mesurées</div>
              <div className="odoo-stat-card-value">{data.days}</div>
              <div className="odoo-stat-card-sub">produit × jour</div>
            </div>
          </div>
          {[['Par catégorie', data.byCategory], ['Par produit', data.byProduct.slice(0, 50)]].map(([title, list]) => (
            <div key={title as string} style={{ overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
              <table className="odoo-table" style={{ margin: 0 }}>
                <thead><tr><th>{title as string}</th><th style={{ textAlign: 'right' }}>Jours</th><th style={{ textAlign: 'right' }}>Prévu</th><th style={{ textAlign: 'right' }}>Vendu</th><th style={{ textAlign: 'right' }}>Erreur</th></tr></thead>
                <tbody>
                  {(list as typeof data.byCategory).map(g => (
                    <tr key={g.key}>
                      <td>{g.key}</td>
                      <td style={{ textAlign: 'right' }}>{g.days}</td>
                      <td style={{ textAlign: 'right' }}>{g.forecast.toLocaleString('fr-FR')}</td>
                      <td style={{ textAlign: 'right' }}>{g.actual.toLocaleString('fr-FR')}</td>
                      <td style={{ textAlign: 'right' }}><span className={`odoo-tag ${tone(g.mape)}`}>{g.mape == null ? '—' : `${g.mape} %`}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ═══════════════════════ UTILITAIRES ═══════════════════════ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
      {label}
      {children}
    </label>
  );
}

function Loading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
    </div>
  );
}
