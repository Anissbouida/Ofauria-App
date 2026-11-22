import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, MapPin, Loader2, Building, Building2, Store, Factory, Warehouse, Phone, Mail, UserRound, Users,
  Clock, LayoutGrid, List, AlertTriangle, IdCard,
} from 'lucide-react';
import { storesApi } from '../../api/stores.api';
import { usersApi } from '../../api/users.api';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { RowMenu } from '../../components/ui/RowMenu';
import { DataPanel, ErrorState, FormField, FormFooter, HeaderActions } from '../../components/ds';
import { OdooToggle } from './SettingsPrimitives';

/**
 * Établissements (audit Paramètres, lot 5, mig 331) : boutiques, laboratoire,
 * entrepôt, siège. Code court (repris dans les rapports), responsable, patente
 * propre à l'établissement et horaires d'ouverture.
 * Refonte (après S5) : cartes avec état « ouvert maintenant » et semaine en un coup
 * d'œil (vue Liste conservée), formulaire en blocs et horaires rapides.
 */

const KINDS: [string, string][] = [
  ['shop', 'Boutique'], ['workshop', 'Laboratoire / atelier'], ['warehouse', 'Entrepôt'], ['office', 'Bureau / siège'], ['mixed', 'Boutique et atelier'],
];
const KIND_ICON: Record<string, typeof Store> = { shop: Store, workshop: Factory, warehouse: Warehouse, office: Building2, mixed: Store };
const DAYS: [string, string][] = [['mon', 'Lundi'], ['tue', 'Mardi'], ['wed', 'Mercredi'], ['thu', 'Jeudi'], ['fri', 'Vendredi'], ['sat', 'Samedi'], ['sun', 'Dimanche']];
/** Clés des jours dans l'ordre de Date.getDay() (dimanche = 0). */
const JS_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
type Day = { closed: boolean; open: string; close: string };
type Hours = Record<string, Day>;
const DEFAULT_HOURS: Hours = Object.fromEntries(DAYS.map(([d]) => [d, { closed: false, open: '07:00', close: '21:00' }]));
const VIEW_KEY = 'kalum.settings.storesView';

type Draft = {
  name: string; code: string; kind: string; city: string; address: string; phone: string; email: string;
  patente: string; managerUserId: string; isHeadquarters: boolean; isActive: boolean; hours: Hours | null;
};

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

/** Résumé lisible des horaires : « Lun-Sam 07:00-21:00 · Dim fermé ». */
function hoursSummary(h: Hours | null | undefined): string {
  if (!h) return '—';
  const parts: string[] = [];
  let start = 0;
  const key = (d: Day | undefined) => (!d || d.closed ? 'fermé' : `${d.open}-${d.close}`);
  for (let i = 1; i <= DAYS.length; i++) {
    if (i === DAYS.length || key(h[DAYS[i][0]]) !== key(h[DAYS[start][0]])) {
      const a = DAYS[start][1].slice(0, 3), b = DAYS[i - 1][1].slice(0, 3);
      parts.push(`${start === i - 1 ? a : `${a}-${b}`} ${key(h[DAYS[start][0]])}`);
      start = i;
    }
  }
  return parts.join(' · ');
}

/** Ouvert à l'instant ? Gère une fermeture après minuit (fermeture < ouverture). */
function openNow(h: Hours | null | undefined, now = new Date()): boolean | null {
  if (!h) return null;
  const day = h[JS_DAYS[now.getDay()]];
  if (!day || day.closed) return false;
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return day.close > day.open ? t >= day.open && t < day.close : t >= day.open || t < day.close;
}

const kindLabel = (k: string) => KINDS.find(x => x[0] === k)?.[1] ?? 'Boutique';

export default function StoresPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [view, setView] = useState<'cards' | 'list'>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'; } catch { return 'cards'; }
  });
  const editorRef = useRef<HTMLDivElement>(null);
  const { data: stores = [], isLoading, error, refetch } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list });
  // Liste des comptes (administrateur) pour le responsable ; champ masqué si indisponible.
  const { data: users = [] } = useQuery<Record<string, any>[]>({ queryKey: ['users'], queryFn: usersApi.list, retry: false });

  const chooseView = (v: 'cards' | 'list') => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* stockage indisponible */ }
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['stores'] });
  const save = useMutation({
    mutationFn: () => {
      const d = editing!.draft;
      const data = {
        name: d.name, code: d.code || null, kind: d.kind, city: d.city || null, address: d.address || null,
        phone: d.phone || null, email: d.email || null, patente: d.patente || null,
        managerUserId: d.managerUserId || null, isHeadquarters: d.isHeadquarters, isActive: d.isActive, openingHours: d.hours,
      };
      return editing!.id ? storesApi.update(editing!.id, data) : storesApi.create(data);
    },
    onSuccess: () => { invalidate(); notify.success('Établissement enregistré'); setEditing(null); },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => storesApi.remove(id),
    onSuccess: () => { invalidate(); notify.success('Établissement supprimé'); },
    onError: (err) => notify.error(errorMessage(err, 'Suppression refusée : désactivez plutôt l\'établissement')),
  });

  const open = (s?: Record<string, any>) => setEditing({
    id: s?.id ?? null,
    draft: {
      name: s?.name ?? '', code: s?.code ?? '', kind: s?.kind ?? 'shop', city: s?.city ?? '', address: s?.address ?? '',
      phone: s?.phone ?? '', email: s?.email ?? '', patente: s?.patente ?? '', managerUserId: s?.manager_user_id ?? '',
      isHeadquarters: !!s?.is_headquarters, isActive: s ? s.is_active !== false : true, hours: (s?.opening_hours as Hours) ?? null,
    },
  });
  // Le formulaire s'ouvre au-dessus des établissements : on l'amène à l'écran.
  const editingKey = editing ? editing.id ?? 'new' : null;
  useEffect(() => {
    if (editingKey) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editingKey]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing(e => e && { ...e, draft: { ...e.draft, [k]: v } });
  const setDay = (day: string, patch: Partial<Day>) => setEditing(e => e && {
    ...e, draft: { ...e.draft, hours: { ...(e.draft.hours ?? DEFAULT_HOURS), [day]: { ...(e.draft.hours ?? DEFAULT_HOURS)[day], ...patch } } },
  });
  const setAllDays = (make: (d: string, cur: Day) => Day) => setEditing(e => {
    if (!e) return e;
    const cur = e.draft.hours ?? DEFAULT_HOURS;
    return { ...e, draft: { ...e.draft, hours: Object.fromEntries(DAYS.map(([d]) => [d, make(d, cur[d] ?? DEFAULT_HOURS[d])])) } };
  });

  const askRemove = async (s: Record<string, any>) => {
    if (await confirm(`Supprimer l'établissement « ${s.name} » ?`, { danger: true, confirmLabel: 'Supprimer' })) remove.mutate(s.id);
  };

  const active = stores.filter((s: Record<string, any>) => s.is_active !== false);
  const hq = stores.find((s: Record<string, any>) => s.is_headquarters);
  const openNowCount = active.filter((s: Record<string, any>) => openNow(s.opening_hours) === true).length;
  const withHours = active.filter((s: Record<string, any>) => s.opening_hours).length;

  const d = editing?.draft;
  const badHours = d?.hours ? DAYS.filter(([k]) => { const x = d.hours![k]; return x && !x.closed && x.open === x.close; }).map(([, l]) => l) : [];

  return (
    <div className="odoo-scope odoo-stores">
      {/* ── Barre : résumé, vue, création ── */}
      <div className="odoo-stores-bar">
        <div className="odoo-stores-summary">
          <strong>{stores.length} établissement{stores.length > 1 ? 's' : ''}</strong>
          <span>{active.length} actif{active.length > 1 ? 's' : ''}</span>
          {withHours > 0 && <span>{openNowCount} ouvert{openNowCount > 1 ? 's' : ''} en ce moment</span>}
          {hq && <span>Siège : {hq.name}</span>}
        </div>
        <div className="prj-views" role="tablist" aria-label="Affichage">
          <button type="button" role="tab" aria-selected={view === 'cards'} className={view === 'cards' ? 'active' : ''} onClick={() => chooseView('cards')}>
            <LayoutGrid size={13} /> Cartes
          </button>
          <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => chooseView('list')}>
            <List size={13} /> Liste
          </button>
        </div>
        {!editing && (
          <HeaderActions>
            <button type="button" className="odoo-btn-primary" onClick={() => open()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} aria-hidden="true" /> Nouvel établissement
            </button>
          </HeaderActions>
        )}
      </div>

      {/* ── Formulaire en blocs ── */}
      {editing && d && (
        <div ref={editorRef} className="odoo-stores-editor">
          <div className="odoo-stores-editor-head">
            <MapPin size={15} /> {editing.id ? `Modifier « ${d.name || 'établissement'} »` : 'Nouvel établissement'}
          </div>

          <section className="odoo-company-card">
            <h3><span className="odoo-company-card-icon"><Building2 size={14} /></span>Identité</h3>
            <div className="odoo-company-grid" style={{ gridTemplateColumns: '2fr 0.8fr 1.4fr' }}>
              <FormField label="Nom" htmlFor="store-name" required hint={!d.name.trim() ? 'Saisissez le nom de l\'établissement.' : undefined}>
                <input id="store-name" className="ds-input" value={d.name} onChange={e => set('name', e.target.value)} maxLength={100} placeholder="Boutique centre-ville" />
              </FormField>
              <FormField label="Code" htmlFor="store-code" hint="Code court repris dans les rapports et les numéros de pièces">
                <input id="store-code" className="ds-input" style={{ textTransform: 'uppercase', fontFamily: 'ui-monospace, monospace' }}
                  value={d.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="MOH1" maxLength={10} />
              </FormField>
              <FormField label="Type" htmlFor="store-kind">
                <select id="store-kind" className="ds-input" value={d.kind} onChange={e => set('kind', e.target.value)}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FormField>
            </div>
            <div className="odoo-stores-toggles">
              <label><OdooToggle checked={d.isActive} onChange={v => set('isActive', v)} /> <span>Établissement actif<small>Désactivé, il disparaît des listes sans perdre son historique</small></span></label>
              <label><OdooToggle checked={d.isHeadquarters} onChange={v => set('isHeadquarters', v)} /> <span>Siège social<small>Établissement principal de la société</small></span></label>
            </div>
          </section>

          <section className="odoo-company-card">
            <h3><span className="odoo-company-card-icon"><MapPin size={14} /></span>Coordonnées</h3>
            <div className="odoo-company-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <FormField label="Adresse" htmlFor="store-address">
                <input id="store-address" className="ds-input" value={d.address} onChange={e => set('address', e.target.value)} maxLength={300} />
              </FormField>
              <FormField label="Ville" htmlFor="store-city">
                <input id="store-city" className="ds-input" value={d.city} onChange={e => set('city', e.target.value)} maxLength={100} />
              </FormField>
            </div>
            <div className="odoo-company-grid" style={{ gridTemplateColumns: '1fr 1.4fr', paddingTop: 0 }}>
              <FormField label="Téléphone" htmlFor="store-phone">
                <input id="store-phone" type="tel" className="ds-input" value={d.phone} onChange={e => set('phone', e.target.value)} maxLength={40} />
              </FormField>
              <FormField label="E-mail" htmlFor="store-email">
                <input id="store-email" type="email" className="ds-input" value={d.email} onChange={e => set('email', e.target.value)} maxLength={120} />
              </FormField>
            </div>
          </section>

          <section className="odoo-company-card">
            <h3><span className="odoo-company-card-icon"><IdCard size={14} /></span>Gestion</h3>
            <div className="odoo-company-grid" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
              <FormField label="Patente de l'établissement" htmlFor="store-patente" hint="Chaque établissement peut avoir sa propre patente">
                <input id="store-patente" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={d.patente}
                  onChange={e => set('patente', e.target.value)} inputMode="numeric" maxLength={15} />
              </FormField>
              {users.length > 0 && (
                <FormField label="Responsable" htmlFor="store-manager">
                  <SearchSelect value={d.managerUserId} onChange={v => set('managerUserId', v)}
                    placeholder="—" width="100%" size="md" ariaLabel="Responsable"
                    options={users.filter(u => u.isActive !== false).map(u => ({ id: String(u.id), label: `${u.firstName} ${u.lastName}` }))} />
                </FormField>
              )}
            </div>
          </section>

          <section className="odoo-company-card">
            <h3>
              <span className="odoo-company-card-icon"><Clock size={14} /></span>Horaires d'ouverture
              <span className="odoo-company-card-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {d.hours ? 'Renseignés' : 'Non renseignés'}
                <OdooToggle checked={d.hours !== null} onChange={v => set('hours', v ? DEFAULT_HOURS : null)} />
              </span>
            </h3>
            {d.hours ? (
              <div style={{ padding: '0.75rem 1rem 1rem', display: 'grid', gap: 10 }}>
                <div className="odoo-stores-quick">
                  <span>Raccourcis :</span>
                  <button type="button" onClick={() => setAllDays(() => ({ ...(d.hours!.mon ?? DEFAULT_HOURS.mon) }))}>
                    Copier le lundi sur tous les jours
                  </button>
                  <button type="button" onClick={() => setAllDays(() => ({ closed: false, open: '07:00', close: '21:00' }))}>7 j/7 · 07:00-21:00</button>
                  <button type="button" onClick={() => setAllDays((k, cur) => ({ ...cur, closed: k === 'sun' }))}>Fermé le dimanche</button>
                </div>
                <div className="odoo-stores-week">
                  {DAYS.map(([k, l]) => {
                    const day = d.hours![k] ?? DEFAULT_HOURS[k];
                    return (
                      <div key={k} className={`odoo-stores-day${day.closed ? ' closed' : ''}`}>
                        <span className="odoo-stores-day-name">{l}</span>
                        <span className="odoo-stores-day-open">
                          <OdooToggle checked={!day.closed} onChange={v => setDay(k, { closed: !v })} />
                          {day.closed ? 'Fermé' : 'Ouvert'}
                        </span>
                        {!day.closed && (
                          <span className="odoo-stores-day-times">
                            <input id={`h-${k}-open`} type="time" className="ds-input sm" value={day.open} onChange={e => setDay(k, { open: e.target.value })} aria-label={`Ouverture ${l}`} />
                            –
                            <input id={`h-${k}-close`} type="time" className="ds-input sm" value={day.close} onChange={e => setDay(k, { close: e.target.value })} aria-label={`Fermeture ${l}`} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="odoo-setting-help" style={{ margin: 0 }}>
                  {hoursSummary(d.hours)} · une fermeture avant l'ouverture vaut « après minuit ».
                </p>
                {badHours.length > 0 && (
                  <span className="odoo-company-hint error"><AlertTriangle size={12} /> Ouverture = fermeture : {badHours.join(', ')}</span>
                )}
              </div>
            ) : (
              <p className="odoo-setting-help" style={{ margin: 0, padding: '0.75rem 1rem 1rem' }}>
                Activez pour saisir les horaires : la carte de l'établissement indiquera s'il est ouvert en ce moment.
              </p>
            )}
          </section>

          <div className="odoo-stores-editor-actions">
            <FormFooter onCancel={() => setEditing(null)} busy={save.isPending} disabled={!d.name.trim() || badHours.length > 0}
              onSubmit={() => save.mutate()} />
          </div>
        </div>
      )}

      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <Loader2 className="animate-spin" size={16} /> : !stores.length ? (
        <div className="odoo-stores-empty">
          <Building size={22} />
          <strong>Ajoutez votre premier établissement</strong>
          <span>Boutique, laboratoire, entrepôt ou siège : chacun a ses horaires, son responsable et sa patente.</span>
          {!editing && <button type="button" className="odoo-btn-primary" onClick={() => open()}><Plus size={13} /> Nouvel établissement</button>}
        </div>
      ) : view === 'cards' ? (
        <div className="odoo-stores-grid">
          {stores.map((s: Record<string, any>) => {
            const Icon = KIND_ICON[s.kind] ?? Store;
            const isOff = s.is_active === false;
            const now = isOff ? null : openNow(s.opening_hours);
            const hours = s.opening_hours as Hours | null;
            const todayKey = JS_DAYS[new Date().getDay()];
            const missing = [!s.code && 'code', !s.patente && 'patente', !s.opening_hours && 'horaires'].filter(Boolean) as string[];
            return (
              <article key={s.id} className={`odoo-stores-card${isOff ? ' off' : ''}`}>
                <header>
                  <span className="odoo-stores-card-icon"><Icon size={18} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="odoo-stores-card-name">
                      {s.name}
                      {s.code && <code>{s.code}</code>}
                    </div>
                    <div className="odoo-stores-card-kind">
                      {kindLabel(s.kind)}
                      {s.is_headquarters && <span className="odoo-tag odoo-tag-purple">Siège</span>}
                    </div>
                  </div>
                  {isOff ? <StatusTag tone="cancelled" label="Désactivé" />
                    : now === null ? <StatusTag tone="todo" icon={Clock} label="Horaires ?" />
                    : now ? <StatusTag tone="done" label="Ouvert maintenant" />
                    : <StatusTag tone="draft" icon={Clock} label="Fermé en ce moment" />}
                </header>
                <ul className="odoo-stores-card-lines">
                  <li><MapPin size={13} /> {[s.address, s.city].filter(Boolean).join(', ') || <em>Adresse non renseignée</em>}</li>
                  {s.phone && <li><Phone size={13} /> {s.phone}</li>}
                  {s.email && <li><Mail size={13} /> {s.email}</li>}
                  <li><UserRound size={13} /> {s.manager_name || <em>Pas de responsable</em>}</li>
                  <li><Users size={13} /> {Number(s.user_count)} personne{Number(s.user_count) > 1 ? 's' : ''} rattachée{Number(s.user_count) > 1 ? 's' : ''}</li>
                </ul>
                {hours ? (
                  <div className="odoo-stores-strip" title={hoursSummary(hours)}>
                    {DAYS.map(([k, l]) => {
                      const day = hours[k];
                      return (
                        <span key={k} className={`${!day || day.closed ? 'closed' : 'open'}${k === todayKey ? ' today' : ''}`}>
                          <b>{l.slice(0, 3)}</b>{!day || day.closed ? 'fermé' : `${day.open}-${day.close}`}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <button type="button" className="odoo-stores-add-hours" onClick={() => open(s)}><Clock size={13} /> Ajouter les horaires</button>
                )}
                {missing.length > 0 && !isOff && (
                  <div className="odoo-stores-missing"><AlertTriangle size={12} /> À compléter : {missing.join(', ')}</div>
                )}
                <footer>
                  <button type="button" className="odoo-btn-secondary" onClick={() => open(s)}><Pencil size={13} /> Modifier</button>
                  {Number(s.user_count) === 0 && (
                    <button type="button" className="odoo-btn-secondary" aria-label={`Supprimer ${s.name}`} onClick={() => askRemove(s)}><Trash2 size={13} /></button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <DataPanel label="Établissements">
          <table className="odoo-table">
            <thead><tr><th>Établissement</th><th>Type</th><th>Adresse</th><th>Responsable</th><th>Horaires</th><th className="ds-num">Personnel</th><th>Statut</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {stores.map((s: Record<string, any>) => (
                <tr key={s.id} style={{ opacity: s.is_active === false ? 0.6 : 1 }}>
                  <td>
                    <span className="ds-strong">{s.name}</span>{s.code && <span className="ds-ref" style={{ marginLeft: 6 }}>{s.code}</span>}
                    {s.is_headquarters && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }}>Siège</span>}
                  </td>
                  <td>{kindLabel(s.kind)}</td>
                  <td>{[s.address, s.city].filter(Boolean).join(', ') || '—'}</td>
                  <td>{s.manager_name || '—'}</td>
                  <td style={{ fontSize: '13px' }}>{hoursSummary(s.opening_hours)}</td>
                  <td className="ds-num">{s.user_count}</td>
                  <td><StatusTag tone={s.is_active === false ? 'cancelled' : 'done'} label={s.is_active === false ? 'Désactivé' : 'Actif'} /></td>
                  <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => open(s)} aria-label={`Modifier ${s.name}`}>Modifier</button>
                      {Number(s.user_count) === 0 && (
                        <RowMenu label={`Plus d'actions pour ${s.name}`} items={[{ label: 'Supprimer', icon: Trash2, danger: true, onSelect: () => askRemove(s) }]} />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </div>
  );
}
