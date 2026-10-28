import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  BadgePercent, Plus, Loader2, X, Award, Trash2, Info, Save, History, Search, Pencil, Coins, Gift, Hourglass, Filter, Star,
  ChevronDown, ChevronRight, Copy, CalendarPlus,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  promotionsApi, loyaltyApi, PROMO_KIND_LABEL, PROMO_STATE, LOYALTY_KIND_LABEL, DAYS,
  type Promotion, type PromotionInput, type PromoKind, type PromoTarget, type CustomerScope, type LoyaltyKind, type LoyaltyTier, type PromoState,
} from '../../api/promotions.api';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { storesApi } from '../../api/stores.api';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { SelectFilter } from '../../components/purchasing/ProcessBoard';
import { OdooToggle } from '../settings/SettingsPrimitives';

/**
 * Promotions et fidélité (mig 372). Les promotions s'appliquent seules en caisse (et, si
 * cochées, aux commandes et devis) ; la fidélité crédite des points à chaque vente payée.
 */
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fr = (v: string | null | undefined) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '');
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
const muted: React.CSSProperties = { color: 'var(--odoo-text-muted)', fontSize: '0.75rem' };
const chip = (on: boolean): React.CSSProperties => ({
  padding: '3px 10px', borderRadius: 999, fontSize: '0.75rem', cursor: 'pointer',
  border: `1px solid ${on ? 'var(--odoo-purple)' : 'var(--odoo-border)'}`,
  background: on ? 'var(--odoo-purple-light)' : 'var(--odoo-bg)', color: on ? 'var(--odoo-purple)' : 'var(--odoo-text)', fontWeight: on ? 600 : 400,
});
/** Signal d'état : point de couleur + texte (couleurs de la palette odoo-tag). */
const DOT: Record<string, string> = { green: '#28a745', blue: '#1f6391', orange: '#d9822b', grey: '#adb5bd', red: '#dc3545', purple: 'var(--odoo-purple)' };
function Dot({ color, children }: { color: keyof typeof DOT; children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
    <span style={{ width: 8, height: 8, borderRadius: 999, background: DOT[color], flexShrink: 0 }} />{children}</span>;
}
const STATE_DOT: Record<PromoState, keyof typeof DOT> = { running: 'green', scheduled: 'blue', exhausted: 'orange', ended: 'grey', inactive: 'grey' };

type Tab = 'promotions' | 'loyalty' | 'history';
const TABS: { key: Tab; label: string; icon: typeof Gift; direction?: boolean }[] = [
  { key: 'promotions', label: 'Promotions', icon: BadgePercent },
  { key: 'loyalty', label: 'Programme de fidélité', icon: Award, direction: true },
  { key: 'history', label: 'Mouvements de points', icon: History, direction: true },
];

export default function PromotionsPage() {
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'promotions';
  const setTab = (t: Tab) => { params.set('tab', t); setParams(params, { replace: true }); };
  const [creating, setCreating] = useState(false);
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}><BadgePercent size={18} /> Promotions et fidélité</h1>
          <p style={{ ...muted, margin: '2px 0 0', fontSize: '0.8125rem' }}>Remises automatiques en caisse, sur les commandes et les devis ; points de fidélité gagnés et utilisés par les clients.</p>
        </div>
        {tab === 'promotions' && isDirection && (
          <button className="odoo-btn-primary" onClick={() => setCreating(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouvelle promotion</button>
        )}
      </div>
      <div className="odoo-view-switcher" role="tablist" aria-label="Rubrique" style={{ justifySelf: 'start' }}>
        {TABS.filter(t => !t.direction || isDirection).map(t => {
          const Icon = t.icon; const on = tab === t.key;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.8125rem', gap: 6, background: on ? 'var(--odoo-purple-light)' : undefined, color: on ? 'var(--odoo-purple)' : undefined, fontWeight: on ? 600 : 400 }}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'promotions' && <PromotionsTab canEdit={isDirection} creating={creating} onCreated={() => setCreating(false)} />}
      {tab === 'loyalty' && isDirection && <LoyaltyTab />}
      {tab === 'history' && isDirection && <HistoryTab />}
    </div>
  );
}

/* ─── Promotions ──────────────────────────────────────────────────────────── */
/** Filtres de la liste : situations exclusives + « se terminent bientôt » (en cours, fin sous 7 jours). */
type ListFilter = 'running' | 'ending' | 'scheduled' | 'exhausted' | 'ended' | 'inactive' | 'all';
const FILTERS: { key: ListFilter; label: string }[] = [
  { key: 'running', label: 'En cours' }, { key: 'ending', label: 'Se terminent bientôt' }, { key: 'scheduled', label: 'Programmées' },
  { key: 'exhausted', label: 'Épuisées' }, { key: 'ended', label: 'Terminées' }, { key: 'inactive', label: 'Arrêtées' }, { key: 'all', label: 'Toutes' },
];
const DAY = 86_400_000;
const todayMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dateMs = (v: string) => new Date(`${String(v).slice(0, 10)}T00:00:00`).getTime();
/** Jours restants avant la fin (inclus) ; null sans date de fin. */
const daysLeft = (p: Promotion) => (p.ends_on ? Math.round((dateMs(p.ends_on) - todayMs()) / DAY) : null);
const isEnding = (p: Promotion) => p.state === 'running' && (daysLeft(p) ?? 99) <= 7;
/** Étiquette d'avantage : une couleur par type de remise. */
const KIND_TAG: Record<PromoKind, string> = { buy_x_get_y: 'odoo-tag-green', percent: 'odoo-tag-purple', amount: 'odoo-tag-blue', fixed_price: 'odoo-tag-orange' };

function PromotionsTab({ canEdit, creating, onCreated }: { canEdit: boolean; creating: boolean; onCreated: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data = [], isLoading } = useQuery({ queryKey: ['promotions'], queryFn: promotionsApi.list });
  const { data: productsResp } = useQuery({ queryKey: ['products-promotions'], queryFn: () => productsApi.list({ limit: '2000' }), staleTime: 300_000 });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list, staleTime: 300_000 });
  const productName = useMemo(() => Object.fromEntries((((productsResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[]).map(p => [String(p.id), String(p.name)])), [productsResp]);
  const categoryName = useMemo(() => Object.fromEntries((categories as { id: number; name: string }[]).map(c => [Number(c.id), c.name])), [categories]);
  const [editing, setEditing] = useState<{ promo: Promotion | null; copyOf?: Promotion } | null>(null);
  const [filter, setFilter] = useState<ListFilter>('running');
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  useEffect(() => { if (creating) { setEditing({ promo: null }); onCreated(); } }, [creating, onCreated]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['promotions'] });
  const onErr = (e: unknown) => { notify.error(apiErrorMessage(e)); if ((e as { response?: { status?: number } })?.response?.status === 404) refresh(); };
  const remove = useMutation({
    mutationFn: (id: string) => promotionsApi.remove(id),
    onSuccess: r => { refresh(); notify.success(r.archived ? 'Promotion arrêtée (déjà utilisée : elle reste dans l\'historique)' : 'Promotion supprimée'); },
    onError: onErr,
  });
  const quick = useMutation({
    mutationFn: ({ id, ...d }: { id: string; isActive?: boolean; extendDays?: number }) => promotionsApi.quick(id, d),
    onSuccess: (p, v) => {
      refresh();
      notify.success(v.extendDays ? `${p.name} prolongée jusqu'au ${fr(p.ends_on)}` : v.isActive ? `${p.name} réactivée` : `${p.name} arrêtée`);
    },
    onError: onErr,
  });

  const count = (k: ListFilter) => data.filter(p => match(p, k)).length;
  const q = search.trim().toLowerCase();
  const rows = data.filter(p => match(p, filter)
    && (!q || p.name.toLowerCase().includes(q) || (p.coupon_code ?? '').toLowerCase().includes(q))
    && (!channel || (channel === 'pos' ? p.on_pos : channel === 'orders' ? p.on_orders : p.on_quotes)));
  const granted30 = data.reduce((a, p) => a + Number(p.granted_30d ?? 0), 0);
  const targets = (p: Promotion) => [...p.product_ids.map(id => productName[id] ?? 'produit'), ...p.category_ids.map(id => categoryName[Number(id)] ?? 'catégorie')];
  const scopeShort = (p: Promotion) => {
    if (p.target === 'cart') return 'sur tout le panier';
    const names = targets(p);
    return names.length ? `sur ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}` : 'sur tout le catalogue';
  };
  const del = async (p: Promotion) => {
    if (await confirm('Elle n\'a jamais servi : elle sera supprimée définitivement.', { title: `Supprimer « ${p.name} » ?`, confirmLabel: 'Supprimer', danger: true })) remove.mutate(p.id);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map(f => {
          const n = f.key === 'all' ? data.length : count(f.key); const on = filter === f.key;
          if (f.key === 'ending' && n === 0 && !on) return null;
          return (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} style={{ ...chip(on), display: 'inline-flex', alignItems: 'center', gap: 6, ...(f.key === 'ending' && !on ? { borderColor: '#d9822b', color: '#b85d1a' } : {}) }}>
              {f.key === 'ending' && <Hourglass size={11} />}{f.label}<span style={{ fontWeight: 600 }}>{n}</span>
            </button>
          );
        })}
        <span style={{ ...muted, marginLeft: 'auto' }}>{n2(granted30)} DH de remises accordées sur 30 jours</span>
      </div>

      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap' }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nom ou code promo…" style={{ flex: '1 1 200px' }} />
        <SelectFilter label="Canal" icon={Filter} value={channel} onChange={setChannel} allLabel="Tous"
          options={[{ key: 'pos', label: 'Caisse' }, { key: 'orders', label: 'Commandes' }, { key: 'quotes', label: 'Devis' }]} />
      </div>

      {isLoading ? <Loader2 className="animate-spin" size={18} /> : rows.length === 0 ? (
        <StatusBanner tone="info" icon={BadgePercent} title={data.length ? 'Aucune promotion ici' : 'Aucune promotion'}
          actions={canEdit ? <button className="odoo-btn-primary" onClick={() => setEditing({ promo: null })}><Plus size={13} /> Nouvelle promotion</button> : undefined}>
          {data.length ? 'Choisissez une autre situation ci-dessus pour voir les autres promotions.'
            : 'Créez une remise sur des articles (pourcentage, prix spécial, « 2 achetés = 1 offert »…) ou sur le panier, avec ou sans code promo.'}
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {/* Colonnes de largeur fixe : chaque information garde sa place d'une ligne à l'autre. */}
          <table className="odoo-table" style={{ tableLayout: 'fixed', minWidth: 1040 }}>
            <colgroup>
              <col style={{ width: 40 }} /><col /><col style={{ width: '24%' }} /><col style={{ width: 220 }} />
              <col style={{ width: 120 }} /><col style={{ width: 150 }} /><col style={{ width: 90 }} /><col style={{ width: 116 }} />
            </colgroup>
            <thead><tr>
              <th></th><th>Promotion</th><th>Avantage</th><th>Validité</th>
              <th style={{ textAlign: 'right' }}>Utilisations</th><th style={{ textAlign: 'right' }}>Remise accordée</th><th style={{ textAlign: 'center' }}>Active</th><th></th>
            </tr></thead>
            <tbody>{rows.map(p => {
              const expanded = open === p.id;
              const left = daysLeft(p);
              const span = p.starts_on && p.ends_on ? Math.max(1, dateMs(p.ends_on) - dateMs(p.starts_on) + DAY) : null;
              const progress = span ? Math.min(100, Math.max(0, ((todayMs() - dateMs(p.starts_on!) + DAY) / span) * 100)) : null;
              const conditions = conditionsList(p);
              const when = [p.days_of_week.length ? p.days_of_week.map(d => DAYS[d - 1]).join(' ') : null, p.time_from && p.time_to ? `${p.time_from.slice(0, 5)}–${p.time_to.slice(0, 5)}` : null].filter(Boolean).join(' · ');
              return (
                <Fragment key={p.id}>
                  <tr onClick={() => setOpen(expanded ? null : p.id)} style={{ cursor: 'pointer', height: 68, background: expanded ? 'var(--odoo-purple-light)' : undefined }}>
                    <td style={{ color: 'var(--odoo-text-muted)', textAlign: 'center' }}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</div>
                      <div style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        {[p.on_pos && 'Caisse', p.on_orders && 'Commandes', p.on_quotes && 'Devis'].filter(Boolean).join(' · ')}
                        {p.coupon_code && <span className="odoo-tag odoo-tag-purple font-mono">{p.coupon_code}</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`odoo-tag ${KIND_TAG[p.kind]}`} style={{ fontWeight: 600 }}>{ruleText(p)}</span>
                      <div style={{ ...muted, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scopeShort(p)}{p.min_amount ? ` · dès ${n2(p.min_amount)} DH` : ''}</div>
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>
                      <div style={{ whiteSpace: 'nowrap' }}>{periodText(p)}</div>
                      {progress != null && p.state === 'running' && (
                        <div style={{ height: 4, borderRadius: 2, background: 'var(--odoo-border)', overflow: 'hidden', margin: '5px 0 3px', width: 180 }}>
                          <div style={{ width: `${progress}%`, height: '100%', background: isEnding(p) ? '#d9822b' : 'var(--odoo-purple)' }} />
                        </div>
                      )}
                      {p.state === 'running' && left != null && left <= 7
                        ? <div style={{ fontSize: '0.75rem', color: '#b85d1a' }}>{left <= 0 ? 'se termine aujourd\'hui' : `se termine dans ${left} j`}</div>
                        : p.state === 'scheduled' && p.starts_on ? <div style={{ ...muted }}>démarre dans {Math.max(1, Math.round((dateMs(p.starts_on) - todayMs()) / DAY))} j</div>
                        : when ? <div style={muted}>{when}</div> : null}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {n0(p.uses_count)}{p.max_uses ? <span style={muted}> / {n0(p.max_uses)}</span> : ''}
                      {p.max_uses ? <div style={{ height: 3, borderRadius: 2, background: 'var(--odoo-border)', overflow: 'hidden', marginTop: 4, width: 70, marginLeft: 'auto' }}>
                        <div style={{ width: `${Math.min(100, p.uses_count / p.max_uses * 100)}%`, height: '100%', background: 'var(--odoo-purple)' }} /></div> : null}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{n2(p.granted_amount)} DH</td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      {canEdit ? <OdooToggle checked={p.is_active} disabled={quick.isPending} onChange={v => quick.mutate({ id: p.id, isActive: v })} />
                        : <Dot color={STATE_DOT[p.state]}>{PROMO_STATE[p.state].label}</Dot>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {/* Trois emplacements fixes : un emplacement vide garde l'alignement des autres. */}
                      {canEdit && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', justifyContent: 'end', alignItems: 'center' }}>
                        <button className="odoo-pager-btn" title="Modifier" aria-label="Modifier" onClick={() => setEditing({ promo: p })}><Pencil size={13} /></button>
                        <button className="odoo-pager-btn" title="Dupliquer" aria-label="Dupliquer" onClick={() => setEditing({ promo: null, copyOf: p })}><Copy size={13} /></button>
                        {p.ends_on
                          ? <button className="odoo-pager-btn" title="Prolonger de 7 jours" aria-label="Prolonger de 7 jours" disabled={quick.isPending} onClick={() => quick.mutate({ id: p.id, extendDays: 7 })}><CalendarPlus size={13} /></button>
                          : <span />}
                      </div>}
                    </td>
                  </tr>
                  {expanded && (
                    <tr style={{ background: 'var(--odoo-bg-alt, #f8f9fa)' }}>
                      <td></td>
                      <td colSpan={7} style={{ padding: '12px 12px 14px' }}>
                        <div style={{ fontSize: '0.875rem', marginBottom: 10 }}>{sentence(p, targets(p))}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: '0.8125rem' }}>
                          <div><div style={muted}>Articles</div>{p.target === 'cart' ? 'Tout le panier' : targets(p).length ? targets(p).join(', ') : 'Tout le catalogue'}</div>
                          <div><div style={muted}>Pour qui, où</div>{conditions.length ? conditions.join(' · ') : 'Tous les clients, tous les magasins'}</div>
                          <div><div style={muted}>Quand</div>{periodText(p)}{when ? ` · ${when}` : ''}</div>
                          <div><div style={muted}>Résultats</div>{n0(p.uses_count)} utilisation(s) · {n2(p.granted_amount)} DH accordés<div style={muted}>dont {n2(p.granted_30d)} DH sur 30 jours</div></div>
                        </div>
                        {p.description && <div style={{ ...muted, marginTop: 8 }}>{p.description}</div>}
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                            <button className="odoo-btn-secondary" onClick={() => setEditing({ promo: p })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Pencil size={12} /> Modifier</button>
                            <button className="odoo-btn-secondary" onClick={() => setEditing({ promo: null, copyOf: p })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Copy size={12} /> Dupliquer</button>
                            {p.ends_on && <button className="odoo-btn-secondary" disabled={quick.isPending} onClick={() => quick.mutate({ id: p.id, extendDays: 7 })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CalendarPlus size={12} /> Prolonger de 7 jours</button>}
                            {p.uses_count === 0 && <button className="odoo-btn-secondary" onClick={() => del(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}><Trash2 size={12} /> Supprimer</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <p style={{ ...muted, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Info size={12} /> En caisse : sur chaque article la meilleure promotion qui le concerne, puis la meilleure remise sur le panier. Un code promo n'agit que s'il est saisi à l'encaissement.
      </p>
      {editing && <PromotionForm promo={editing.promo} copyOf={editing.copyOf} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }}
        onGone={() => { refresh(); setEditing(null); }} />}
    </>
  );
}

function match(p: Promotion, f: ListFilter) {
  if (f === 'all') return true;
  if (f === 'ending') return isEnding(p);
  return p.state === f;
}
/** Phrase complète, comme la caisse l'appliquera. */
function sentence(p: Promotion, names: string[]) {
  const on = p.target === 'cart' ? 'le panier' : names.length ? names.join(', ') : 'tout le catalogue';
  const v = Number(p.value);
  const g = Number(p.get_qty);
  const what = p.kind === 'buy_x_get_y' ? `${p.buy_qty} achetés parmi ${on} = ${g} offert${g > 1 ? 's' : ''} (${g > 1 ? 'les moins chers' : 'le moins cher'})`
    : p.kind === 'percent' ? `${String(v).replace('.', ',')} % de remise sur ${on}`
    : p.kind === 'fixed_price' ? `${on} au prix spécial de ${n2(v)} DH`
    : p.target === 'cart' ? `${n2(v)} DH de remise sur le panier` : `${n2(v)} DH de remise par article sur ${on}`;
  const extra = [p.min_amount && `dès ${n2(p.min_amount)} DH d'achat`, p.coupon_code && `avec le code ${p.coupon_code}`].filter(Boolean).join(', ');
  const where = [p.on_pos && 'en caisse', p.on_orders && 'sur les commandes', p.on_quotes && 'sur les devis'].filter(Boolean).join(', ');
  return `${what}${extra ? `, ${extra}` : ''} — ${where}.`;
}

/** Avantage lisible : « −10 % », « −2,00 DH par article », « 2 achetés = 1 offert »… */
function ruleText(p: Promotion) {
  const v = Number(p.value);
  switch (p.kind) {
    case 'percent': return `−${String(v).replace('.', ',')} %`;
    case 'amount': return p.target === 'cart' ? `−${n2(v)} DH` : `−${n2(v)} DH par article`;
    case 'fixed_price': return `Prix spécial ${n2(v)} DH`;
    default: return `${p.buy_qty} achetés = ${p.get_qty} offert${Number(p.get_qty) > 1 ? 's' : ''}`;
  }
}
function conditionsList(p: Promotion) {
  const scope: Record<CustomerScope, string | null> = { all: null, identified: 'Client identifié', particulier: 'Particuliers', professionnel: 'Professionnels', tier: `Niveau ${p.min_tier_label ?? p.min_tier_code} et plus` };
  return [
    p.min_amount && `Dès ${n2(p.min_amount)} DH`, p.min_quantity && `Dès ${Number(p.min_quantity)} article(s)`,
    scope[p.customer_scope], p.store_name && `Magasin ${p.store_name}`,
  ].filter(Boolean) as string[];
}
function periodText(p: Promotion) {
  if (!p.starts_on && !p.ends_on) return 'Sans limite';
  if (p.starts_on && p.ends_on) return `${fr(p.starts_on)} → ${fr(p.ends_on)}`;
  return p.starts_on ? `Dès le ${fr(p.starts_on)}` : `Jusqu'au ${fr(p.ends_on)}`;
}

function PromotionForm({ promo, copyOf, onClose, onSaved, onGone }: { promo: Promotion | null; copyOf?: Promotion | null; onClose: () => void; onSaved: () => void; onGone: () => void }) {
  // Dupliquer : saisie préremplie depuis une promotion existante, enregistrée comme nouvelle.
  const src = promo ?? copyOf ?? null;
  const [f, setF] = useState(() => ({
    name: copyOf ? `${copyOf.name} (copie)` : src?.name ?? '', description: src?.description ?? '', target: (src?.target ?? 'items') as PromoTarget, kind: (src?.kind ?? 'percent') as PromoKind,
    value: src ? String(Number(src.value)) : '', buyQty: String(src?.buy_qty ?? 2), getQty: String(src?.get_qty ?? 1),
    productIds: src?.product_ids ?? [], categoryIds: (src?.category_ids ?? []).map(Number),
    minQuantity: src?.min_quantity ? String(Number(src.min_quantity)) : '', minAmount: src?.min_amount ? String(Number(src.min_amount)) : '',
    couponCode: copyOf ? '' : src?.coupon_code ?? '', customerScope: (src?.customer_scope ?? 'all') as CustomerScope, minTierCode: src?.min_tier_code ?? '',
    onPos: src?.on_pos ?? true, onOrders: src?.on_orders ?? false, onQuotes: src?.on_quotes ?? false, storeId: src?.store_id ?? '',
    startsOn: src?.starts_on?.slice(0, 10) ?? '', endsOn: src?.ends_on?.slice(0, 10) ?? '', daysOfWeek: src?.days_of_week ?? [],
    timeFrom: src?.time_from?.slice(0, 5) ?? '', timeTo: src?.time_to?.slice(0, 5) ?? '', maxUses: src?.max_uses ? String(src.max_uses) : '',
    priority: String(src?.priority ?? 0), isActive: copyOf ? true : src?.is_active ?? true,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const { data: productsResp } = useQuery({ queryKey: ['products-promotions'], queryFn: () => productsApi.list({ limit: '2000' }), staleTime: 300_000 });
  const products = ((productsResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  const productName = useMemo(() => Object.fromEntries(products.map(p => [String(p.id), String(p.name)])), [products]);
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list, staleTime: 300_000 });
  const { data: stores = [] } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list, staleTime: 300_000 });
  const { data: tiers = [] } = useQuery({ queryKey: ['loyalty-tiers'], queryFn: loyaltyApi.tiers, staleTime: 300_000 });
  const isCart = f.target === 'cart';
  useEffect(() => { if (isCart && !['percent', 'amount'].includes(f.kind)) set('kind', 'percent'); }, [isCart]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
      const d: PromotionInput = {
        name: f.name, description: f.description || null, target: f.target, kind: f.kind, value: num(f.value) ?? 0,
        buyQty: num(f.buyQty), getQty: num(f.getQty), productIds: isCart ? [] : f.productIds, categoryIds: isCart ? [] : f.categoryIds,
        minQuantity: num(f.minQuantity), minAmount: num(f.minAmount), couponCode: f.couponCode.trim() || null,
        customerScope: f.customerScope, minTierCode: f.customerScope === 'tier' ? f.minTierCode || null : null,
        onPos: f.onPos, onOrders: f.onOrders, onQuotes: f.onQuotes, storeId: f.storeId || null,
        startsOn: f.startsOn || null, endsOn: f.endsOn || null, daysOfWeek: f.daysOfWeek, timeFrom: f.timeFrom || null, timeTo: f.timeTo || null,
        maxUses: num(f.maxUses), priority: num(f.priority) ?? 0, isActive: f.isActive,
      };
      return promo ? promotionsApi.update(promo.id, d) : promotionsApi.create(d);
    },
    onSuccess: () => { notify.success(promo ? 'Promotion enregistrée' : 'Promotion créée'); onSaved(); },
    // Promotion supprimée entre-temps (autre poste, autre onglet) : on recharge la liste et on ferme.
    onError: e => { notify.error(apiErrorMessage(e)); if ((e as { response?: { status?: number } })?.response?.status === 404) onGone(); },
  });
  const valueLabel = f.kind === 'percent' ? 'Remise (%)' : f.kind === 'amount' ? (isCart ? 'Remise (DH)' : 'Remise par article (DH, par kg au poids)') : 'Prix spécial (DH, par kg au poids)';

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10 }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{promo ? promo.name : copyOf ? `Copie de ${copyOf.name}` : 'Nouvelle promotion'}</span></div>
          <div style={{ flex: 1 }} /><button className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
          <label style={lab}>Nom *<input style={field} maxLength={120} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Ex. : Happy hour viennoiseries" autoFocus /></label>

          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Règle</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([['items', 'Sur des articles'], ['cart', 'Sur le panier entier']] as const).map(([k, l]) => (
              <button key={k} type="button" className={f.target === k ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => set('target', k)}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label style={lab}>Type<select style={field} value={f.kind} onChange={e => set('kind', e.target.value as PromoKind)}>
              {(Object.keys(PROMO_KIND_LABEL) as PromoKind[]).filter(k => !isCart || k === 'percent' || k === 'amount').map(k => <option key={k} value={k}>{PROMO_KIND_LABEL[k]}</option>)}
            </select></label>
            {f.kind === 'buy_x_get_y' ? <>
              <label style={lab}>Achetés<input style={field} type="number" min={1} value={f.buyQty} onChange={e => set('buyQty', e.target.value)} /></label>
              <label style={lab}>Offerts<input style={field} type="number" min={1} value={f.getQty} onChange={e => set('getQty', e.target.value)} /></label>
            </> : <label style={lab}>{valueLabel}<input style={field} type="number" min={0} step="0.01" value={f.value} onChange={e => set('value', e.target.value)} /></label>}
          </div>
          {f.kind === 'buy_x_get_y' && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Pour {Number(f.buyQty) || 0} achetés, {Number(f.getQty) || 0} offert(s) : les articles offerts sont les moins chers des articles concernés. Produits à l'unité seulement.</p>}

          {!isCart && (<>
            <div style={lab}>Articles concernés <span style={{ fontSize: '0.75rem' }}>(rien de choisi = tout le catalogue)</span></div>
            <SearchSelect options={products.filter(p => !f.productIds.includes(String(p.id))).map(p => ({ id: String(p.id), label: String(p.name) }))}
              value="" onChange={v => v && set('productIds', [...f.productIds, v])} placeholder="Ajouter un produit…" width="100%" size="md" />
            {f.productIds.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{f.productIds.map(id => (
              <span key={id} style={{ ...chip(true), display: 'inline-flex', alignItems: 'center', gap: 4 }}>{productName[id] ?? 'Produit'}
                <X size={11} onClick={() => set('productIds', f.productIds.filter(x => x !== id))} /></span>))}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(categories as { id: number; name: string }[]).map(c => {
                const on = f.categoryIds.includes(Number(c.id));
                return <span key={c.id} style={chip(on)} onClick={() => set('categoryIds', on ? f.categoryIds.filter(x => x !== Number(c.id)) : [...f.categoryIds, Number(c.id)])}>{c.name}</span>;
              })}
            </div>
          </>)}

          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Conditions</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label style={lab}>{isCart ? 'Panier minimum (DH)' : 'Montant minimum des articles (DH)'}<input style={field} type="number" min={0} step="0.01" value={f.minAmount} onChange={e => set('minAmount', e.target.value)} /></label>
            <label style={lab}>Quantité minimum<input style={field} type="number" min={0} step="1" value={f.minQuantity} onChange={e => set('minQuantity', e.target.value)} /></label>
            <label style={lab}>Clients<select style={field} value={f.customerScope} onChange={e => set('customerScope', e.target.value as CustomerScope)}>
              <option value="all">Tous, même sans fiche</option><option value="identified">Client identifié (fiche choisie)</option>
              <option value="particulier">Particuliers</option><option value="professionnel">Professionnels</option><option value="tier">Niveau de fidélité minimum</option>
            </select></label>
            {f.customerScope === 'tier' && <label style={lab}>Niveau minimum<select style={field} value={f.minTierCode} onChange={e => set('minTierCode', e.target.value)}>
              <option value="">Choisir…</option>{tiers.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>}
            <label style={lab}>Code promo<input style={{ ...field, textTransform: 'uppercase' }} maxLength={40} value={f.couponCode} onChange={e => set('couponCode', e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} placeholder="facultatif" /></label>
            <label style={lab}>Utilisations maximum<input style={field} type="number" min={1} value={f.maxUses} onChange={e => set('maxUses', e.target.value)} placeholder="illimité" /></label>
          </div>

          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Quand et où</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <label style={lab}>Du<input style={field} type="date" value={f.startsOn} onChange={e => set('startsOn', e.target.value)} /></label>
            <label style={lab}>Au<input style={field} type="date" value={f.endsOn} onChange={e => set('endsOn', e.target.value)} /></label>
            <label style={lab}>De (heure)<input style={field} type="time" value={f.timeFrom} onChange={e => set('timeFrom', e.target.value)} /></label>
            <label style={lab}>À (heure)<input style={field} type="time" value={f.timeTo} onChange={e => set('timeTo', e.target.value)} /></label>
            <label style={lab}>Magasin<select style={field} value={f.storeId} onChange={e => set('storeId', e.target.value)}>
              <option value="">Tous</option>{(stores as { id: string; name: string }[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', marginRight: 4 }}>Jours (aucun = tous) :</span>
            {DAYS.map((d, i) => { const on = f.daysOfWeek.includes(i + 1); return <span key={d} style={chip(on)} onClick={() => set('daysOfWeek', on ? f.daysOfWeek.filter(x => x !== i + 1) : [...f.daysOfWeek, i + 1].sort())}>{d}</span>; })}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.875rem' }}>
            {([['onPos', 'Caisse'], ['onOrders', 'Commandes'], ['onQuotes', 'Devis']] as const).map(([k, l]) => (
              <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={f[k]} onChange={e => set(k, e.target.checked)} /> {l}</label>
            ))}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} /> Active</label>
          </div>
          {(f.onOrders || f.onQuotes) && f.couponCode && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Les commandes et devis n'utilisent pas de code promo : une promotion à code ne s'applique qu'en caisse.</p>}
          <label style={lab}>Note interne<textarea style={{ ...field, minHeight: 50 }} maxLength={2000} value={f.description} onChange={e => set('description', e.target.value)} /></label>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="odoo-btn-primary" disabled={f.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>Enregistrer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── Programme de fidélité ───────────────────────────────────────────────── */
type SettingsForm = { enabled: boolean; earnPoints: string; earnPerAmount: string; pointValue: string; minRedeemPoints: string; maxRedeemPct: string; expiryMonths: string };
type TierForm = { code: string; label: string; minPoints: string; earnMultiplier: string; color: string | null; isNew?: boolean };
const dec = (v: string) => Number(String(v).replace(',', '.')) || 0;
const pctTxt = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
/** Couleur d'un niveau (champ color, sinon par rang) ; uniquement des teintes de la palette odoo-tag. */
const TIER_COLORS: Record<string, { bar: string; tag: string }> = {
  orange: { bar: '#e8a87c', tag: 'odoo-tag-orange' }, grey: { bar: '#adb5bd', tag: 'odoo-tag-grey' }, yellow: { bar: '#e0b84a', tag: 'odoo-tag-yellow' },
  blue: { bar: '#7fb2dc', tag: 'odoo-tag-blue' }, green: { bar: '#7dc191', tag: 'odoo-tag-green' }, purple: { bar: 'var(--odoo-purple)', tag: 'odoo-tag-purple' },
};
const tierColor = (t: TierForm, i: number) => TIER_COLORS[t.color ?? ''] ?? Object.values(TIER_COLORS)[i % 6];

/** Grille commune des réglages : libellé + aide à gauche, contrôle de largeur fixe à droite. */
const CONTROL_W = 260;
const H = 36;
const ctrl: React.CSSProperties = { ...field, height: H, boxSizing: 'border-box' };
function SettingRow({ label, hint, children, last }: { label: string; hint?: React.ReactNode; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${CONTROL_W}px`, gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: last ? 'none' : '1px solid var(--odoo-border)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem' }}>{label}</div>
        {hint && <div style={{ ...muted, marginTop: 2 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
/** Champ numérique avec son unité accolée (pts, DH, %), hauteur alignée sur les listes. */
function UnitInput({ value, onChange, unit, prefix, step = '1', min = 0, max }: {
  value: string; onChange: (v: string) => void; unit?: string; prefix?: string; step?: string; min?: number; max?: number;
}) {
  const side: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, padding: '0 8px', ...muted, fontSize: '0.8125rem', background: 'var(--odoo-bg-alt)' };
  return (
    <span style={{ display: 'flex', alignItems: 'stretch', height: H, boxSizing: 'border-box', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', overflow: 'hidden', width: '100%' }}>
      {prefix && <span style={{ ...side, borderRight: '1px solid var(--odoo-border)' }}>{prefix}</span>}
      <input type="number" step={step} min={min} max={max} value={value} onChange={e => onChange(e.target.value)}
        style={{ ...field, height: '100%', border: 'none', borderRadius: 0, textAlign: 'right', minWidth: 0, flex: 1 }} />
      {unit && <span style={{ ...side, borderLeft: '1px solid var(--odoo-border)' }}>{unit}</span>}
    </span>
  );
}
/** Curseur + valeur, dans la même colonne que les champs. */
function SliderControl({ value, min, max, step, onChange, display, label }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; label: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: H }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--odoo-purple)' }} aria-label={label} />
      <span style={{ width: 56, textAlign: 'right', fontWeight: 600, color: 'var(--odoo-purple)', fontVariantNumeric: 'tabular-nums' }}>{display}</span>
    </div>
  );
}

function LoyaltyTab() {
  const qc = useQueryClient();
  const { data: ov, isLoading } = useQuery({ queryKey: ['loyalty', 'overview'], queryFn: loyaltyApi.overview });
  const [s, setS] = useState<SettingsForm | null>(null);
  const [tiers, setTiers] = useState<TierForm[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
  const [ticket, setTicket] = useState('200');
  const initial = useMemo(() => {
    if (!ov) return null;
    const st = ov.settings;
    return {
      s: { enabled: st.enabled, earnPoints: String(st.earn_points), earnPerAmount: String(Number(st.earn_per_amount)), pointValue: String(Number(st.point_value)),
        minRedeemPoints: String(st.min_redeem_points), maxRedeemPct: String(Number(st.max_redeem_pct)), expiryMonths: String(st.expiry_months) } as SettingsForm,
      tiers: ov.tiersConfig.filter((t: LoyaltyTier) => t.is_active).sort((a: LoyaltyTier, b: LoyaltyTier) => a.min_points - b.min_points)
        .map((t: LoyaltyTier) => ({ code: t.code, label: t.label, minPoints: String(t.min_points), earnMultiplier: String(Number(t.earn_multiplier)), color: t.color })) as TierForm[],
    };
  }, [ov]);
  useEffect(() => { if (initial) { setS(initial.s); setTiers(initial.tiers); setSelected(null); } }, [initial]);
  const save = useMutation({
    mutationFn: async () => {
      if (JSON.stringify(s) !== JSON.stringify(initial!.s)) {
        await loyaltyApi.saveSettings({
          enabled: s!.enabled, earnPoints: Number(s!.earnPoints), earnPerAmount: dec(s!.earnPerAmount), pointValue: dec(s!.pointValue),
          minRedeemPoints: Number(s!.minRedeemPoints), maxRedeemPct: dec(s!.maxRedeemPct), expiryMonths: Number(s!.expiryMonths),
        });
      }
      if (JSON.stringify(tiers) !== JSON.stringify(initial!.tiers)) {
        await loyaltyApi.saveTiers(tiers!.map(t => ({ code: t.code, label: t.label, minPoints: Number(t.minPoints), earnMultiplier: dec(t.earnMultiplier), color: t.color, isActive: true })));
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loyalty'] }); qc.invalidateQueries({ queryKey: ['loyalty-tiers'] }); notify.success('Programme de fidélité enregistré'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  if (isLoading || !ov || !s || !tiers || !initial) return <Loader2 className="animate-spin" size={18} />;

  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setS(x => ({ ...x!, [k]: v }));
  const setTier = (i: number, patch: Partial<TierForm>) => setTiers(tiers.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const dirty = JSON.stringify(s) !== JSON.stringify(initial.s) || JSON.stringify(tiers) !== JSON.stringify(initial.tiers);
  const tiersInvalid = tiers.some(t => t.code.length < 2 || !t.label.trim() || t.minPoints === '');

  // Barème : la « part rendue » pilote la valeur du point (points par tranche inchangés).
  const pts = Number(s.earnPoints) || 1, per = dec(s.earnPerAmount) || 1, pv = dec(s.pointValue);
  const backPct = (pts * pv / per) * 100;
  const setBack = (pct: number) => set('pointValue', String(Math.round((pct / 100) * per / pts * 10000) / 10000));
  const cap = dec(s.maxRedeemPct), minPts = Number(s.minRedeemPoints) || 0, months = Number(s.expiryMonths) || 0;
  const t = Math.max(0, dec(ticket));
  const baseEarn = Math.floor(t / per) * pts;
  const sorted = tiers.map((x, i) => ({ ...x, i })).sort((a, b) => Number(a.minPoints) - Number(b.minPoints));
  const top = Math.max(1000, ...sorted.map(x => Number(x.minPoints) || 0)) * 1.12;
  const kpi = (label: string, value: string, sub?: string, Icon?: typeof Coins) => (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{Icon && <Icon size={11} />}{label}</div>
      <div className="odoo-stat-card-value">{value}</div>
      {sub && <div className="odoo-stat-card-sub">{sub}</div>}
    </div>
  );
  const expiryOptions = Array.from(new Set([0, 3, 6, 12, 18, 24, 36, months])).sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  const fmtMult = (v: string) => `×${String(dec(v)).replace('.', ',')}`;

  return (
    <>
      <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
        {kpi('Points en circulation', n0(ov.outstandingPoints), `${n2(ov.outstandingValue)} DH dus aux clients`, Coins)}
        {kpi('Clients avec des points', n0(ov.members), undefined, Star)}
        {kpi('Gagnés sur 30 j', n0(ov.last30.earn?.points ?? 0), `${n2(ov.last30.earn?.amount ?? 0)} DH`, Gift)}
        {kpi('Utilisés sur 30 j', n0(Math.abs(ov.last30.redeem?.points ?? 0)), `${n2(ov.last30.redeem?.amount ?? 0)} DH de remises`, BadgePercent)}
        {kpi('Expirés sur 30 j', n0(Math.abs(ov.last30.expire?.points ?? 0)), undefined, Hourglass)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)' }}>
        <OdooToggle checked={s.enabled} onChange={v => set('enabled', v)} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{s.enabled ? 'Programme actif' : 'Programme arrêté'}</div>
          <div style={muted}>{s.enabled ? 'Les clients identifiés gagnent des points à chaque vente payée et peuvent les utiliser en caisse.' : 'Aucun point n\'est gagné ni utilisé ; les soldes sont conservés.'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 12, alignItems: 'stretch', opacity: s.enabled ? 1 : 0.6 }}>
        <div className="odoo-section" style={{ margin: 0 }}>
          <div className="odoo-section-header"><Award size={13} /> Barème</div>
          <div style={{ padding: '0 16px' }}>
            <SettingRow label="Part rendue au client" hint={`${n0(pts)} point par ${n2(per)} DH payé · 1 point = ${pv.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} DH`}>
              <SliderControl label="Part rendue au client" value={Math.round(backPct * 2) / 2} min={0.5} max={20} step={0.5} onChange={setBack} display={pctTxt(backPct)} />
            </SettingRow>
            <SettingRow label="Part maximum du ticket" hint="payable en points">
              <SliderControl label="Part maximum du ticket" value={cap} min={10} max={100} step={5} onChange={v => set('maxRedeemPct', String(v))} display={`${cap} %`} />
            </SettingRow>
            <SettingRow label="Utilisable dès" hint={`soit ${n2(minPts * pv)} DH de remise`}>
              <UnitInput value={s.minRedeemPoints} onChange={v => set('minRedeemPoints', v)} unit="pts" min={1} />
            </SettingRow>
            <SettingRow label="Validité des points" hint="les points les plus anciens partent en premier" last={!details}>
              <select style={ctrl} value={String(months)} onChange={e => set('expiryMonths', e.target.value)}>
                {expiryOptions.map(m => <option key={m} value={m}>{m === 0 ? 'Sans expiration' : `${m} mois`}</option>)}
              </select>
            </SettingRow>
            {details && <>
              <SettingRow label="Points gagnés" hint="par tranche payée"><UnitInput value={s.earnPoints} onChange={v => set('earnPoints', v)} unit="pts" min={1} /></SettingRow>
              <SettingRow label="Tranche" hint="montant payé, après remises"><UnitInput value={s.earnPerAmount} onChange={v => set('earnPerAmount', v)} unit="DH" step="0.01" min={0.01} /></SettingRow>
              <SettingRow label="Valeur d'un point" hint="remise accordée par point" last><UnitInput value={s.pointValue} onChange={v => set('pointValue', v)} unit="DH" step="0.0001" min={0.0001} /></SettingRow>
            </>}
          </div>
          <button type="button" onClick={() => setDetails(!details)}
            style={{ ...muted, width: '100%', textAlign: 'left', background: 'var(--odoo-bg-alt)', border: 'none', borderTop: '1px solid var(--odoo-border)', padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            {details ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {details ? 'Masquer les réglages détaillés' : 'Réglages détaillés (points, tranche, valeur du point)'}
          </button>
        </div>

        <div className="odoo-section" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="odoo-section-header"><Coins size={13} /> Essayer sur un ticket</div>
          <div style={{ padding: '0 16px' }}>
            <SettingRow label="Montant payé" hint="après remises" last>
              <UnitInput value={ticket} onChange={setTicket} unit="DH" step="0.01" />
            </SettingRow>
          </div>
          <table className="odoo-table" style={{ tableLayout: 'fixed' }}>
            <colgroup><col /><col style={{ width: 140 }} /><col style={{ width: 140 }} /></colgroup>
            <thead><tr><th>Client</th><th style={{ textAlign: 'right' }}>Points gagnés</th><th style={{ textAlign: 'right' }}>Valeur</th></tr></thead>
            <tbody>
              <tr><td style={muted}>Sans niveau</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{n0(baseEarn)}</td><td style={{ textAlign: 'right' }}>{n2(baseEarn * pv)} DH</td></tr>
              {sorted.map(x => { const e = Math.floor(baseEarn * dec(x.earnMultiplier)); return (
                <tr key={x.i}>
                  <td><span className={`odoo-tag ${tierColor(x, x.i).tag}`}>{x.label || 'Nouveau niveau'}</span> <span style={muted}>{fmtMult(x.earnMultiplier)}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{n0(e)}</td><td style={{ textAlign: 'right' }}>{n2(e * pv)} DH</td>
                </tr>
              ); })}
            </tbody>
          </table>
          <div style={{ marginTop: 'auto', padding: '10px 16px', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)', fontSize: '0.8125rem' }}>
            Payable en points sur ce ticket : <strong>{n2(t * cap / 100)} DH</strong>{pv > 0 && <> ({n0(Math.floor(t * cap / 100 / pv))} points)</>}, dès {n0(minPts)} points.
          </div>
        </div>
      </div>

      <div className="odoo-section" style={{ margin: 0 }}>
        <div className="odoo-section-header" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Star size={13} /> Niveaux · atteints selon les points gagnés sur 12 mois</span>
          <button className="odoo-btn-secondary" style={{ textTransform: 'none', letterSpacing: 0, padding: '2px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            disabled={tiers.length >= 10} onClick={() => { setTiers([...tiers, { code: '', label: '', minPoints: '', earnMultiplier: '1', color: null, isNew: true }]); setSelected(tiers.length); }}>
            <Plus size={12} /> Ajouter un niveau</button>
        </div>

        {/* Frise à l'échelle : étiquettes, barre et seuils sur trois rangées fixes. */}
        <div style={{ position: 'relative', height: 78, margin: '16px 40px 8px' }}>
          <div style={{ position: 'absolute', top: 34, left: 0, right: 0, height: 8, borderRadius: 4, background: 'var(--odoo-border)' }} />
          {sorted.map((x, k) => {
            const from = (Number(x.minPoints) || 0) / top * 100;
            const to = k + 1 < sorted.length ? (Number(sorted[k + 1].minPoints) || 0) / top * 100 : 100;
            return <div key={`seg-${x.i}`} style={{ position: 'absolute', top: 34, height: 8, left: `${from}%`, width: `${Math.max(0, to - from)}%`, background: tierColor(x, x.i).bar, borderRadius: k + 1 === sorted.length ? '0 4px 4px 0' : 0 }} />;
          })}
          <span style={{ position: 'absolute', top: 54, left: 0, transform: 'translateX(-50%)', ...muted }}>0</span>
          {sorted.map(x => {
            const pos = `${(Number(x.minPoints) || 0) / top * 100}%`; const on = selected === x.i;
            return (
              <Fragment key={`mk-${x.i}`}>
                <button type="button" onClick={() => setSelected(on ? null : x.i)} className={`odoo-tag ${tierColor(x, x.i).tag}`}
                  style={{ position: 'absolute', top: 0, left: pos, transform: 'translateX(-50%)', whiteSpace: 'nowrap', cursor: 'pointer', border: 'none', outline: on ? '2px solid var(--odoo-purple)' : 'none', outlineOffset: 1 }}>
                  {x.label || 'Nouveau'} · {fmtMult(x.earnMultiplier)}
                </button>
                <span style={{ position: 'absolute', top: 31, left: pos, transform: 'translateX(-50%)', width: 14, height: 14, borderRadius: 999, background: 'var(--odoo-bg)', border: `3px solid ${tierColor(x, x.i).bar}`, boxSizing: 'border-box' }} />
                <span style={{ position: 'absolute', top: 54, left: pos, transform: 'translateX(-50%)', ...muted, whiteSpace: 'nowrap' }}>{n0(x.minPoints)} pts</span>
              </Fragment>
            );
          })}
        </div>

        <table className="odoo-table" style={{ tableLayout: 'fixed' }}>
          <colgroup><col /><col style={{ width: 150 }} /><col style={{ width: 190 }} /><col style={{ width: 150 }} /><col style={{ width: 110 }} /><col style={{ width: 96 }} /></colgroup>
          <thead><tr>
            <th>Niveau</th><th>Code</th><th style={{ textAlign: 'right' }}>Dès (12 mois)</th><th style={{ textAlign: 'right' }}>Bonus de points</th><th style={{ textAlign: 'right' }}>Clients</th><th></th>
          </tr></thead>
          <tbody>{tiers.map((x, i) => {
            const editing = selected === i;
            const customers = x.isNew ? null : ov.tiers.find(c => c.code === x.code)?.customers ?? 0;
            return (
              <tr key={i} onClick={() => !editing && setSelected(i)} style={{ cursor: editing ? 'default' : 'pointer', background: editing ? 'var(--odoo-purple-light)' : undefined, height: 52 }}>
                <td>{editing
                  ? <input style={ctrl} value={x.label} placeholder="Platine" onChange={e => setTier(i, { label: e.target.value })} autoFocus={x.isNew} />
                  : <span className={`odoo-tag ${tierColor(x, i).tag}`}>{x.label}</span>}</td>
                <td>{editing && x.isNew
                  ? <input style={{ ...ctrl, fontFamily: 'ui-monospace, monospace' }} placeholder="platine" value={x.code} onChange={e => setTier(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
                  : <span className="font-mono" style={muted}>{x.code}</span>}</td>
                <td style={{ textAlign: 'right' }}>{editing
                  ? <UnitInput value={x.minPoints} onChange={v => setTier(i, { minPoints: v })} unit="pts" />
                  : <>{n0(x.minPoints)} <span style={muted}>pts</span></>}</td>
                <td style={{ textAlign: 'right' }}>{editing
                  ? <UnitInput value={x.earnMultiplier} onChange={v => setTier(i, { earnMultiplier: v })} prefix="×" step="0.05" min={1} max={10} />
                  : fmtMult(x.earnMultiplier)}</td>
                <td style={{ textAlign: 'right' }}>{customers == null ? <span style={muted}>—</span> : n0(customers)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  {editing
                    ? <button className="odoo-pager-btn" title="Terminer" aria-label="Terminer" onClick={() => setSelected(null)}><ChevronDown size={13} /></button>
                    : <button className="odoo-pager-btn" title="Modifier" aria-label="Modifier" onClick={() => setSelected(i)}><Pencil size={13} /></button>}
                  <button className="odoo-pager-btn" title="Retirer le niveau" aria-label="Retirer le niveau" onClick={() => { setTiers(tiers.filter((_, k) => k !== i)); setSelected(null); }}><Trash2 size={13} /></button>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>

      {dirty && (
        <div style={{ position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
          border: '1px solid #ffe5d0', borderRadius: 4, background: '#fff8f1', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
          <Info size={14} style={{ color: '#b85d1a' }} />
          <span style={{ flex: 1, fontSize: '0.875rem', color: '#b85d1a' }}>
            {tiersInvalid ? 'Complétez le nom, le code et le seuil de chaque niveau avant d\'enregistrer.' : 'Modifications non enregistrées'}
          </span>
          <button className="odoo-btn-secondary" onClick={() => { setS(initial.s); setTiers(initial.tiers); setSelected(null); }}>Annuler</button>
          <button className="odoo-btn-primary" disabled={tiersInvalid || save.isPending} onClick={() => save.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Save size={13} /> Enregistrer</button>
        </div>
      )}
    </>
  );
}

/* ─── Mouvements ──────────────────────────────────────────────────────────── */
const KIND_DOT: Record<LoyaltyKind, keyof typeof DOT> = { earn: 'green', redeem: 'purple', expire: 'grey', adjust: 'blue', reverse: 'orange' };

function HistoryTab() {
  const [kind, setKind] = useState<LoyaltyKind | ''>('');
  const [search, setSearch] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['loyalty', 'transactions', kind], queryFn: () => loyaltyApi.transactions(kind) });
  const q = search.trim().toLowerCase();
  const rows = data.filter(t => !q || (t.customer_name ?? '').toLowerCase().includes(q) || (t.sale_number ?? '').toLowerCase().includes(q));
  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap' }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Client ou n° de vente…" style={{ flex: '1 1 200px' }} />
        <SelectFilter label="Mouvement" icon={Filter} value={kind} onChange={v => setKind(v as LoyaltyKind | '')} allLabel="Tous"
          options={(Object.keys(LOYALTY_KIND_LABEL) as LoyaltyKind[]).map(k => ({ key: k, label: LOYALTY_KIND_LABEL[k] }))} />
      </div>
      <p style={{ ...muted, margin: 0 }}>Les 200 derniers mouvements. Le détail d'un client est sur sa fiche (Clients › onglet Fidélité).</p>
      {isLoading ? <Loader2 className="animate-spin" size={18} /> : rows.length === 0 ? (
        <StatusBanner tone="neutral" icon={History} title="Aucun mouvement">Les points apparaissent ici dès la première vente encaissée à un client identifié.</StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Client</th><th>Mouvement</th><th style={{ textAlign: 'right' }}>Points</th><th style={{ textAlign: 'right' }}>Valeur</th><th>Origine</th><th>Expire le</th></tr></thead>
            <tbody>{rows.map(t => (
              <tr key={t.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(t.created_at), 'dd/MM/yyyy HH:mm')}</td>
                <td>{t.customer_name}</td>
                <td><Dot color={KIND_DOT[t.kind]}>{LOYALTY_KIND_LABEL[t.kind]}</Dot></td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: t.points < 0 ? '#721c24' : '#155724' }}>{t.points > 0 ? '+' : '−'}{n0(Math.abs(t.points))}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{n2(t.amount)} DH</td>
                <td style={{ fontSize: '0.8125rem' }}>{t.note}{t.created_by_name && <div style={muted}>{t.created_by_name}</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{t.remaining && t.expires_at ? <>{fr(t.expires_at)}{t.remaining < t.points && <div style={muted}>{n0(t.remaining)} restants</div>}</> : <span style={muted}>—</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
