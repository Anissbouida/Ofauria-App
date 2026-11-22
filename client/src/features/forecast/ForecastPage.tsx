import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, CalendarDays, Link2, Target, Loader2, ChevronLeft, ChevronRight, Plus, Trash2, Pencil,
  CheckCircle2, AlertTriangle, PenLine,
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
import SearchSelect from '../../components/ui/SearchSelect';
import SalesPageShell from '../sales/SalesPageShell';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import {
  Alert, DataPanel, EmptyState, ErrorState, FormField, KpiCard, KpiGrid, LoadingState, NoResultState,
  SearchBar, SectionHeader, TableFooter, Tabs, Toolbar,
} from '../../components/ds';
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
const CONF_TONE: Record<ForecastCell['confidence'], { tone: StatusTone; label: string }> = {
  haute: { tone: 'done', label: 'Haute' }, moyenne: { tone: 'todo', label: 'Moyenne' }, faible: { tone: 'draft', label: 'Faible' },
};
const dayFr = (d: string) => format(parseISO(d), 'd MMM yyyy', { locale: fr });
const note: React.CSSProperties = { margin: 0, fontSize: 13, color: 'var(--ds-muted)' };
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
  return (
    <SalesPageShell icon={TrendingUp} parent="Production › Opérations" title="Prévisions" list
      summary="Quantité suggérée par produit et par jour, d'après les ventes, le calendrier et la majoration de production.">
      <Tabs label="Vues de la prévision" value={tab} onChange={setTab} tabs={tabs.map(t => ({ key: t.key, label: t.label }))} />
      {tab === 'grille' && <GridTab canEdit={canEdit} onTab={setTab} />}
      {tab === 'evenements' && <EventsTab canEdit={canEdit} />}
      {tab === 'liens' && canEdit && <LinksTab />}
      {tab === 'precision' && canEdit && <AccuracyTab />}
    </SalesPageShell>
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

  const { data, isLoading, error, refetch } = useQuery({
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
          actions={<button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => onTab('liens')}>Relier</button>}>
          Leurs ventes ne comptent pas encore dans la prévision.
        </StatusBanner>
      )}

      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un produit" />
        <SearchSelect value={category} onChange={setCategory} ariaLabel="Catégorie" placeholder="Toutes catégories" width={200}
          options={categories.map(([id, name]) => ({ id: String(id), label: name as string }))} />
        <span className="ds-grow" />
        <button type="button" className="ds-icon-btn" aria-label="Semaine précédente" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className="ds-input" style={{ width: 170 }} aria-label="Premier jour" />
        <button type="button" className="ds-icon-btn" aria-label="Semaine suivante" onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={16} aria-hidden="true" /></button>
        {from !== tomorrow && <button type="button" className="odoo-btn-secondary" onClick={() => setFrom(tomorrow)}>Demain</button>}
      </Toolbar>

      {isLoading ? <LoadingState label="Calcul de la prévision…" /> : error ? (
        <ErrorState title="Prévision indisponible" text={String((error as any)?.response?.data?.error?.message ?? error)} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        (search || category)
          ? <NoResultState text="Aucun produit ne correspond aux filtres." onReset={() => { setSearch(''); setCategory(''); }} />
          : <EmptyState icon={TrendingUp} title="Aucun produit à prévoir"
              text="Aucune vente enregistrée sur les 8 dernières semaines pour ce magasin (caisse ou Contrôle des ventes)." />
      ) : (
        <DataPanel label="Prévisions par produit"
          footer={<TableFooter note={`${rows.length} produit(s)${canEdit ? ' · cliquez sur une case pour la corriger' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Produit</th>
                {dates.map(d => (
                  <th key={d} className="ds-num" style={{ minWidth: 78, background: eventsByDate[d]?.length ? 'var(--ds-warning-bg)' : undefined }}
                    title={eventsByDate[d]?.map(e => `${e.label} (${e.uplift_pct >= 0 ? '+' : ''}${e.uplift_pct} %)`).join(', ') || undefined}>
                    <div>{format(parseISO(d), 'EEE dd/MM', { locale: fr })}</div>
                    {eventsByDate[d]?.[0] && <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ds-warning)' }}>{eventsByDate[d][0].label}</div>}
                  </th>
                ))}
                <th>Confiance</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([cat, list]) => [
                <tr key={`h-${cat}`} className="ds-group">
                  <td>{cat}</td>
                  {dates.map(d => (
                    <td key={d} className="ds-num">
                      {list.reduce((s, r) => s + (r.days[d]?.qty ?? 0), 0)}
                    </td>
                  ))}
                  <td />
                </tr>,
                ...list.map(r => (
                  <tr key={r.product_id}>
                    <td className="ds-strong">{r.product_name}</td>
                    {dates.map(d => {
                      const c = r.days[d];
                      const isEditing = editing?.productId === r.product_id && editing.date === d;
                      if (isEditing) {
                        return (
                          <td key={d} className="ds-num">
                            <input autoFocus type="number" min={0} value={editing.value} aria-label={`Quantité ${r.product_name} ${d}`}
                              onChange={e => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
                              onBlur={commit}
                              className="ds-input sm" style={{ width: 64, textAlign: 'right' }} />
                          </td>
                        );
                      }
                      return (
                        <td key={d} title={`${METHOD_LABEL[c.method]}\n${c.explanation}${c.override_reason ? `\nMotif : ${c.override_reason}` : ''}`}
                          onClick={canEdit ? () => setEditing({ productId: r.product_id, date: d, value: c.method === 'manuel' ? String(c.qty) : '' }) : undefined}
                          className="ds-num" style={{ cursor: canEdit ? 'pointer' : 'default', color: c.qty === 0 ? 'var(--ds-muted)' : undefined }}>
                          {c.method === 'manuel' && <PenLine size={11} aria-label="Saisie manuelle" style={{ marginRight: 4, color: 'var(--ds-accent-ink)', display: 'inline' }} />}
                          <strong>{c.qty}</strong>
                          {c.actual != null && <div style={{ fontSize: 11, color: 'var(--ds-muted)' }}>vendu {c.actual}</div>}
                        </td>
                      );
                    })}
                    <td>{(() => { const c = r.days[dates[0]]; return c ? <StatusTag tone={CONF_TONE[c.confidence].tone} label={CONF_TONE[c.confidence].label} /> : null; })()}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </DataPanel>
      )}
      <p style={note}>
        Calcul : moyenne pondérée des 6 derniers mêmes jours de semaine (hors événements), corrigée des ruptures, de la tendance (±10 % max),
        des événements du calendrier, puis majorée du taux de production de la catégorie. Le crayon signale une saisie manuelle ; videz la case pour revenir au calcul.
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
  const confirm = useConfirm();
  const [showPast, setShowPast] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const { data = [], isLoading, isError, refetch } = useQuery({
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
      <Toolbar>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} /> Afficher les événements passés
        </label>
        <span className="ds-grow" />
        {canEdit && !draft && (
          <button type="button" className="odoo-btn-primary" onClick={() => setDraft(EMPTY_EVENT())}>
            <Plus size={13} aria-hidden="true" /> Nouvel événement
          </button>
        )}
      </Toolbar>

      {draft && (
        <form className="ds-panel" style={{ overflow: 'visible' }} aria-label={draft.id ? 'Modifier l\'événement' : 'Nouvel événement'}
          onSubmit={e => { e.preventDefault(); if (draft.label.trim() && !save.isPending) save.mutate(draft); }}>
          <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
            <h2 className="ds-subhead">{draft.id ? 'Modifier l\'événement' : 'Nouvel événement'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, alignItems: 'start' }}>
              <FormField label="Libellé" htmlFor="ev-label" required>
                <input id="ev-label" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="ds-input" placeholder="Ex. : Aïd al-Adha" />
              </FormField>
              <FormField label="Type" htmlFor="ev-kind">
                <select id="ev-kind" value={draft.kind} onChange={e => {
                  const kind = e.target.value as EventKind;
                  setDraft({ ...draft, kind, uplift_pct: kind === 'fermeture' ? -100 : draft.uplift_pct === -100 ? 0 : draft.uplift_pct });
                }} className="ds-input">
                  {(Object.keys(EVENT_KIND_LABELS) as EventKind[]).map(k => <option key={k} value={k}>{EVENT_KIND_LABELS[k]}</option>)}
                </select>
              </FormField>
              <FormField label="Du" htmlFor="ev-from" required>
                <input id="ev-from" type="date" value={draft.date_start} onChange={e => setDraft({ ...draft, date_start: e.target.value, date_end: draft.date_end < e.target.value ? e.target.value : draft.date_end })} className="ds-input" />
              </FormField>
              <FormField label="Au" htmlFor="ev-to" required>
                <input id="ev-to" type="date" value={draft.date_end} min={draft.date_start} onChange={e => setDraft({ ...draft, date_end: e.target.value })} className="ds-input" />
              </FormField>
              <FormField label="Effet sur la demande (%)" htmlFor="ev-uplift">
                <input id="ev-uplift" type="number" value={draft.uplift_pct} disabled={draft.kind === 'fermeture'} min={-100} max={500}
                  onChange={e => setDraft({ ...draft, uplift_pct: Number(e.target.value) })} className="ds-input" />
              </FormField>
              <FormField label="Catégorie">
                <SearchSelect value={draft.category_id != null ? String(draft.category_id) : ''} onChange={id => setDraft({ ...draft, category_id: id ? Number(id) : null })}
                  placeholder="Toutes" width="100%" size="md" ariaLabel="Catégorie"
                  options={(categories as Array<{ id: number; name: string }>).map(c => ({ id: String(c.id), label: c.name as string }))} />
              </FormField>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <input type="checkbox" checked={draft.all_stores} onChange={e => setDraft({ ...draft, all_stores: e.target.checked })} /> Tous les magasins
            </label>
          </div>
          <div className="ds-form-foot">
            <span className="ds-grow" />
            <button type="button" className="odoo-btn-secondary" disabled={save.isPending} onClick={() => setDraft(null)}>Annuler</button>
            <button type="submit" className="odoo-btn-primary" disabled={!draft.label.trim() || save.isPending} aria-busy={save.isPending || undefined}>
              {save.isPending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Enregistrer
            </button>
          </div>
        </form>
      )}

      {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : data.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Aucun événement à venir"
          text="Ajoutez Ramadan, les fêtes, les vacances scolaires ou les jours de fermeture : la prévision en tient compte, et exclut ces jours de l'historique normal." />
      ) : (
        <DataPanel label="Événements du calendrier" footer={<TableFooter note={`${data.length} événement${data.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr><th>Événement</th><th>Type</th><th>Période</th><th className="ds-num">Effet (%)</th><th>Catégorie</th><th>Magasin</th>{canEdit && <th className="ds-actions"><span className="sr-only">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {data.map(e => (
                <tr key={e.id}>
                  <td className="ds-strong">{e.label}</td>
                  <td><StatusTag tone={e.kind === 'fermeture' ? 'blocked' : 'todo'} icon={CalendarDays} label={EVENT_KIND_LABELS[e.kind]} /></td>
                  <td>{dayFr(e.date_start)}{e.date_end !== e.date_start && ` → ${dayFr(e.date_end)}`}</td>
                  <td className="ds-num">{e.kind === 'fermeture' ? 'Fermé' : `${e.uplift_pct >= 0 ? '+' : ''}${e.uplift_pct}`}</td>
                  <td>{e.category_name ?? 'Toutes'}</td>
                  <td>{e.store_id ? 'Ce magasin' : 'Tous'}</td>
                  {canEdit && (
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setDraft({
                        id: e.id, date_start: e.date_start, date_end: e.date_end, kind: e.kind, label: e.label,
                        uplift_pct: e.uplift_pct, category_id: e.category_id, all_stores: e.store_id == null,
                      })}><Pencil size={12} aria-hidden="true" /> Modifier</button>
                      <RowMenu label={`Plus d'actions sur ${e.label}`} items={[{
                        label: 'Supprimer', icon: Trash2, danger: true,
                        onSelect: async () => {
                          if (await confirm(`« ${e.label} » ne sera plus pris en compte dans la prévision.`, { title: 'Supprimer cet événement ?', confirmLabel: 'Supprimer', danger: true })) remove.mutate(e.id);
                        },
                      }]} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}

/* ═══════════════════════ PRODUITS À RELIER ═══════════════════════ */

function LinksTab() {
  const qc = useQueryClient();
  const [onlySold, setOnlySold] = useState(true);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const { data = [], isLoading, isError, refetch } = useQuery({ queryKey: ['forecast-unmapped'], queryFn: forecastApi.unmapped });
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
      <Alert tone="info">
        Les ventes importées depuis Loyverse sont identifiées par leur nom ou leur SKU. Tant qu'un article n'est pas relié à un produit du catalogue,
        ses ventes n'alimentent ni la prévision ni la fiche de besoin. Les articles les plus vendus sont en tête.
      </Alert>
      <Toolbar>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={onlySold} onChange={e => setOnlySold(e.target.checked)} /> Seulement les articles vendus ces 60 derniers jours
        </label>
      </Toolbar>
      <datalist id="forecast-products">{products.map(p => <option key={p.id} value={p.name} />)}</datalist>
      {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Tous les articles vendus sont reliés" text="Leurs ventes alimentent la prévision et la fiche de besoin." />
      ) : (
        <DataPanel label="Articles à relier" footer={<TableFooter note={`${rows.length} article(s)`} />}>
          <table className="odoo-table">
            <thead><tr><th>Article Loyverse</th><th>Catégorie Loyverse</th><th className="ds-num">Vendu (60 j)</th><th>Produit du catalogue</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map(u => {
                const typed = choice[u.product_key] ?? '';
                const productId = byName.get(typed.toLowerCase());
                return (
                  <tr key={u.product_key}>
                    <td className="ds-strong">{u.product_name}{u.sku && <span style={{ color: 'var(--ds-muted)', fontWeight: 400 }}> · {u.sku}</span>}</td>
                    <td>{u.category ?? '—'}</td>
                    <td className="ds-num">{u.sold_60d.toLocaleString('fr-FR')}</td>
                    <td>
                      <input list="forecast-products" value={typed} placeholder="Choisir un produit" aria-label={`Produit pour ${u.product_name}`}
                        onChange={e => setChoice({ ...choice, [u.product_key]: e.target.value })} className="ds-input sm" style={{ width: 260 }} />
                    </td>
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!productId || link.isPending}
                        onClick={() => productId && link.mutate({ key: u.product_key, productId })}>Relier</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}

/* ═══════════════════════ PRÉCISION ═══════════════════════ */

function AccuracyTab() {
  const today = iso(new Date());
  const [from, setFrom] = useState(addDays(today, -28));
  const [to, setTo] = useState(addDays(today, -1));
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['forecast-accuracy', from, to], queryFn: () => forecastApi.accuracy(from, to) });
  const tone = (m: number | null): StatusTone => (m == null ? 'draft' : m <= 25 ? 'done' : m <= 40 ? 'todo' : 'blocked');

  return (
    <>
      <Toolbar>
        <span style={{ fontSize: 14 }}>Du</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="ds-input" style={{ width: 170 }} aria-label="Du" />
        <span style={{ fontSize: 14 }}>au</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="ds-input" style={{ width: 170 }} aria-label="Au" />
      </Toolbar>
      {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : !data || data.days === 0 ? (
        <EmptyState icon={Target} title="Pas encore de mesure"
          text="La précision se mesure sur les prévisions réellement utilisées (création d'un plan de production, fiche de besoin), comparées au vendu une fois la journée passée." />
      ) : (
        <>
          <KpiGrid>
            <KpiCard label="Erreur moyenne (MAPE)" value={data.mape == null ? '—' : `${data.mape} %`} sub="Écart moyen entre prévu et vendu" />
            <KpiCard label="Lignes mesurées" value={String(data.days)} sub="Produit × jour" />
          </KpiGrid>
          {([['Par catégorie', data.byCategory], ['Par produit', data.byProduct.slice(0, 50)]] as const).map(([title, list]) => (
            <section key={title} style={{ display: 'grid', gap: 12 }}>
              <SectionHeader title={title} />
              <DataPanel label={title} footer={<TableFooter note={`${list.length} ligne(s)`} />}>
                <table className="odoo-table">
                  <thead><tr><th>{title === 'Par catégorie' ? 'Catégorie' : 'Produit'}</th><th className="ds-num">Jours</th><th className="ds-num">Prévu</th><th className="ds-num">Vendu</th><th>Erreur</th></tr></thead>
                  <tbody>
                    {list.map(g => (
                      <tr key={g.key}>
                        <td className="ds-strong">{g.key}</td>
                        <td className="ds-num">{g.days}</td>
                        <td className="ds-num">{g.forecast.toLocaleString('fr-FR')}</td>
                        <td className="ds-num">{g.actual.toLocaleString('fr-FR')}</td>
                        <td><StatusTag tone={tone(g.mape)} label={g.mape == null ? 'Non mesurée' : `${g.mape} %`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            </section>
          ))}
        </>
      )}
    </>
  );
}
