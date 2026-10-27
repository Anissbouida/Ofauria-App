import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BadgePercent, Plus, Loader2, X, Award, Trash2, Info, Save, History } from 'lucide-react';
import { format } from 'date-fns';
import {
  promotionsApi, loyaltyApi, PROMO_KIND_LABEL, PROMO_STATE, LOYALTY_KIND_LABEL, DAYS,
  type Promotion, type PromotionInput, type PromoKind, type PromoTarget, type CustomerScope, type LoyaltyKind, type LoyaltyTier,
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

/**
 * Promotions et fidélité (mig 372). Les promotions s'appliquent seules en caisse (et, si
 * cochées, aux commandes et devis) ; la fidélité crédite des points à chaque vente payée.
 */
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fr = (v: string | null | undefined) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '');
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
const chip = (on: boolean): React.CSSProperties => ({
  padding: '3px 10px', borderRadius: 999, fontSize: '0.75rem', cursor: 'pointer',
  border: `1px solid ${on ? 'var(--odoo-primary, #714b67)' : 'var(--odoo-border)'}`,
  background: on ? 'var(--odoo-primary, #714b67)' : 'var(--odoo-bg)', color: on ? '#fff' : 'var(--odoo-text)',
});

export default function PromotionsPage() {
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'promotions' | 'loyalty' | 'history') || 'promotions';
  const setTab = (t: string) => { params.set('tab', t); setParams(params, { replace: true }); };
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}><BadgePercent size={18} /> Promotions et fidélité</h1>
        {([['promotions', 'Promotions'], ['loyalty', 'Programme de fidélité'], ['history', 'Mouvements de points']] as const)
          .filter(([k]) => k === 'promotions' || isDirection)
          .map(([k, l]) => <button key={k} className={tab === k ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'promotions' && <PromotionsTab canEdit={isDirection} />}
      {tab === 'loyalty' && isDirection && <LoyaltyTab />}
      {tab === 'history' && isDirection && <HistoryTab />}
    </div>
  );
}

/* ─── Promotions ──────────────────────────────────────────────────────────── */
function PromotionsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data = [], isLoading } = useQuery({ queryKey: ['promotions'], queryFn: promotionsApi.list });
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => promotionsApi.remove(id),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['promotions'] }); notify.success(r.archived ? 'Promotion arrêtée (déjà utilisée : elle reste dans l\'historique)' : 'Promotion supprimée'); },
    onError: e => { notify.error(apiErrorMessage(e)); if ((e as { response?: { status?: number } })?.response?.status === 404) qc.invalidateQueries({ queryKey: ['promotions'] }); },
  });
  const rows = data.filter(p => showEnded || !['ended', 'inactive'].includes(p.state));
  const running = data.filter(p => p.state === 'running');
  return (
    <>
      <StatusBanner tone="info" icon={Info} title={`${running.length} promotion(s) en cours`}
        actions={canEdit ? <button className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Nouvelle promotion</button> : undefined}>
        La caisse applique seule les promotions en vigueur : sur chaque article la meilleure promotion qui le concerne, puis la meilleure remise sur le panier.
        Un code promo n'agit que s'il est saisi au moment de l'encaissement.
      </StatusBanner>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
        <input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} /> Afficher les promotions terminées ou arrêtées
      </label>
      {isLoading ? <Loader2 className="animate-spin" size={18} /> : rows.length === 0 ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--theme-text-muted)' }}>Aucune promotion{showEnded ? '' : ' en cours ou programmée'}.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Promotion</th><th>Règle</th><th>Conditions</th><th>Période</th><th>Canaux</th><th style={{ textAlign: 'right' }}>Utilisations</th><th style={{ textAlign: 'right' }}>Remise accordée</th><th>État</th><th></th></tr></thead>
            <tbody>{rows.map(p => (
              <tr key={p.id} onClick={() => canEdit && setEditing(p)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                <td><strong>{p.name}</strong>{p.coupon_code && <span className="odoo-tag odoo-tag-blue font-mono" style={{ marginLeft: 6 }}>{p.coupon_code}</span>}</td>
                <td style={{ fontSize: '0.8125rem' }}>{p.label.replace(`${p.name} `, '').replace(/^\(|\)$/g, '')}<div style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{p.target === 'cart' ? 'sur le panier' : scopeText(p)}</div></td>
                <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{conditionsText(p) || '—'}</td>
                <td style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{periodText(p)}</td>
                <td style={{ fontSize: '0.75rem' }}>{[p.on_pos && 'Caisse', p.on_orders && 'Commandes', p.on_quotes && 'Devis'].filter(Boolean).join(', ')}</td>
                <td style={{ textAlign: 'right' }}>{p.uses_count}{p.max_uses ? ` / ${p.max_uses}` : ''}</td>
                <td style={{ textAlign: 'right' }}>{n2(p.granted_amount)} DH</td>
                <td><span className={`odoo-tag ${PROMO_STATE[p.state].tag}`}>{PROMO_STATE[p.state].label}</span></td>
                <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                  {canEdit && p.is_active && <button className="odoo-pager-btn" aria-label="Arrêter ou supprimer" onClick={async () => {
                    if (await confirm(p.uses_count > 0 ? 'Elle a déjà servi : elle sera arrêtée et restera dans l\'historique.' : 'Elle n\'a jamais servi : elle sera supprimée.', { title: `Arrêter « ${p.name} » ?`, confirmLabel: p.uses_count > 0 ? 'Arrêter' : 'Supprimer', danger: true })) remove.mutate(p.id);
                  }}><Trash2 size={13} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {editing && <PromotionForm promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['promotions'] }); setEditing(null); }}
        onGone={() => { qc.invalidateQueries({ queryKey: ['promotions'] }); setEditing(null); }} />}
    </>
  );
}

function scopeText(p: Promotion) {
  const n = p.product_ids.length, c = p.category_ids.length;
  if (!n && !c) return 'tout le catalogue';
  return [n && `${n} produit(s)`, c && `${c} catégorie(s)`].filter(Boolean).join(' + ');
}
function conditionsText(p: Promotion) {
  const scope: Record<CustomerScope, string | null> = { all: null, identified: 'client identifié', particulier: 'particuliers', professionnel: 'professionnels', tier: `niveau ${p.min_tier_label ?? p.min_tier_code} et plus` };
  return [
    p.min_amount && `dès ${n2(p.min_amount)} DH`, p.min_quantity && `dès ${Number(p.min_quantity)} article(s)`,
    scope[p.customer_scope], p.store_name && `magasin ${p.store_name}`,
    p.days_of_week.length ? p.days_of_week.map(d => DAYS[d - 1]).join(' ') : null,
    p.time_from && p.time_to ? `${p.time_from.slice(0, 5)}–${p.time_to.slice(0, 5)}` : null,
  ].filter(Boolean).join(' · ');
}
function periodText(p: Promotion) {
  if (!p.starts_on && !p.ends_on) return 'sans limite';
  if (p.starts_on && p.ends_on) return `${fr(p.starts_on)} → ${fr(p.ends_on)}`;
  return p.starts_on ? `dès le ${fr(p.starts_on)}` : `jusqu'au ${fr(p.ends_on)}`;
}

function PromotionForm({ promo, onClose, onSaved, onGone }: { promo: Promotion | null; onClose: () => void; onSaved: () => void; onGone: () => void }) {
  const [f, setF] = useState(() => ({
    name: promo?.name ?? '', description: promo?.description ?? '', target: (promo?.target ?? 'items') as PromoTarget, kind: (promo?.kind ?? 'percent') as PromoKind,
    value: promo ? String(Number(promo.value)) : '', buyQty: String(promo?.buy_qty ?? 2), getQty: String(promo?.get_qty ?? 1),
    productIds: promo?.product_ids ?? [], categoryIds: (promo?.category_ids ?? []).map(Number),
    minQuantity: promo?.min_quantity ? String(Number(promo.min_quantity)) : '', minAmount: promo?.min_amount ? String(Number(promo.min_amount)) : '',
    couponCode: promo?.coupon_code ?? '', customerScope: (promo?.customer_scope ?? 'all') as CustomerScope, minTierCode: promo?.min_tier_code ?? '',
    onPos: promo?.on_pos ?? true, onOrders: promo?.on_orders ?? false, onQuotes: promo?.on_quotes ?? false, storeId: promo?.store_id ?? '',
    startsOn: promo?.starts_on?.slice(0, 10) ?? '', endsOn: promo?.ends_on?.slice(0, 10) ?? '', daysOfWeek: promo?.days_of_week ?? [],
    timeFrom: promo?.time_from?.slice(0, 5) ?? '', timeTo: promo?.time_to?.slice(0, 5) ?? '', maxUses: promo?.max_uses ? String(promo.max_uses) : '',
    priority: String(promo?.priority ?? 0), isActive: promo?.is_active ?? true,
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
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{promo ? promo.name : 'Nouvelle promotion'}</span></div>
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
function LoyaltyTab() {
  const qc = useQueryClient();
  const { data: ov, isLoading } = useQuery({ queryKey: ['loyalty', 'overview'], queryFn: loyaltyApi.overview });
  const [s, setS] = useState<Record<string, string | boolean> | null>(null);
  const [tiers, setTiers] = useState<{ code: string; label: string; minPoints: string; earnMultiplier: string; color: string | null; isActive: boolean }[] | null>(null);
  useEffect(() => {
    if (!ov) return;
    const st = ov.settings;
    setS({ enabled: st.enabled, earnPoints: String(st.earn_points), earnPerAmount: String(Number(st.earn_per_amount)), pointValue: String(Number(st.point_value)),
      minRedeemPoints: String(st.min_redeem_points), maxRedeemPct: String(Number(st.max_redeem_pct)), expiryMonths: String(st.expiry_months) });
    setTiers(ov.tiersConfig.filter((t: LoyaltyTier) => t.is_active).map((t: LoyaltyTier) => ({ code: t.code, label: t.label, minPoints: String(t.min_points), earnMultiplier: String(Number(t.earn_multiplier)), color: t.color, isActive: true })));
  }, [ov]);
  const saveSettings = useMutation({
    mutationFn: () => loyaltyApi.saveSettings({
      enabled: !!s!.enabled, earnPoints: Number(s!.earnPoints), earnPerAmount: Number(String(s!.earnPerAmount).replace(',', '.')), pointValue: Number(String(s!.pointValue).replace(',', '.')),
      minRedeemPoints: Number(s!.minRedeemPoints), maxRedeemPct: Number(s!.maxRedeemPct), expiryMonths: Number(s!.expiryMonths),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loyalty'] }); notify.success('Programme enregistré'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const saveTiers = useMutation({
    mutationFn: () => loyaltyApi.saveTiers(tiers!.map(t => ({ code: t.code, label: t.label, minPoints: Number(t.minPoints), earnMultiplier: Number(String(t.earnMultiplier).replace(',', '.')), color: t.color, isActive: true }))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loyalty'] }); qc.invalidateQueries({ queryKey: ['loyalty-tiers'] }); notify.success('Niveaux enregistrés'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  if (isLoading || !ov || !s || !tiers) return <Loader2 className="animate-spin" size={18} />;
  const pv = Number(String(s.pointValue).replace(',', '.')) || 0;
  const per = Number(String(s.earnPerAmount).replace(',', '.')) || 1;
  const back = per > 0 ? (Number(s.earnPoints) * pv / per) * 100 : 0;
  const kpi = (label: string, value: string, sub?: string) => (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label">{label}</div><div className="odoo-stat-card-value">{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{sub}</div>}
    </div>
  );
  const set = (k: string, v: string | boolean) => setS(x => ({ ...x!, [k]: v }));
  return (
    <>
      <div className="odoo-stat-grid">
        {kpi('Points en circulation', n0(ov.outstandingPoints), `${n2(ov.outstandingValue)} DH dus aux clients`)}
        {kpi('Clients avec des points', n0(ov.members))}
        {kpi('Gagnés sur 30 j', n0(ov.last30.earn?.points ?? 0), `${n2(ov.last30.earn?.amount ?? 0)} DH`)}
        {kpi('Utilisés sur 30 j', n0(Math.abs(ov.last30.redeem?.points ?? 0)), `${n2(ov.last30.redeem?.amount ?? 0)} DH de remises`)}
        {kpi('Expirés sur 30 j', n0(Math.abs(ov.last30.expire?.points ?? 0)))}
      </div>

      <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Barème</div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}><input type="checkbox" checked={!!s.enabled} onChange={e => set('enabled', e.target.checked)} /> Programme actif (gain et utilisation des points)</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={lab}>Points gagnés<input style={field} type="number" min={1} value={String(s.earnPoints)} onChange={e => set('earnPoints', e.target.value)} /></label>
        <label style={lab}>… par tranche de (DH payés)<input style={field} type="number" min={0.01} step="0.01" value={String(s.earnPerAmount)} onChange={e => set('earnPerAmount', e.target.value)} /></label>
        <label style={lab}>Valeur d'un point (DH)<input style={field} type="number" min={0.0001} step="0.0001" value={String(s.pointValue)} onChange={e => set('pointValue', e.target.value)} /></label>
        <label style={lab}>Minimum par utilisation (points)<input style={field} type="number" min={1} value={String(s.minRedeemPoints)} onChange={e => set('minRedeemPoints', e.target.value)} /></label>
        <label style={lab}>Part maximum d'un ticket payée en points (%)<input style={field} type="number" min={1} max={100} value={String(s.maxRedeemPct)} onChange={e => set('maxRedeemPct', e.target.value)} /></label>
        <label style={lab}>Validité des points (mois, 0 = sans fin)<input style={field} type="number" min={0} max={120} value={String(s.expiryMonths)} onChange={e => set('expiryMonths', e.target.value)} /></label>
      </div>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
        Soit {back.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} % du montant payé rendu en points (avant bonus de niveau). Les points sont gagnés sur ce que le client paie, après remises.
      </p>
      <div><button className="odoo-btn-primary" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Save size={13} /> Enregistrer le barème</button></div>

      <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Niveaux</div>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Un niveau est atteint selon les points gagnés sur les 12 derniers mois ; il multiplie les points gagnés et peut ouvrir des promotions réservées.</p>
      <table className="odoo-table">
        <thead><tr><th>Code</th><th>Niveau</th><th style={{ textAlign: 'right' }}>Dès (points / 12 mois)</th><th style={{ textAlign: 'right' }}>Bonus de points (×)</th><th style={{ textAlign: 'right' }}>Clients</th><th></th></tr></thead>
        <tbody>{tiers.map((t, i) => (
          <tr key={i}>
            <td><input style={{ ...field, width: 110 }} value={t.code} disabled={ov.tiersConfig.some((c: LoyaltyTier) => c.code === t.code)} onChange={e => setTiers(tiers.map((x, k) => k === i ? { ...x, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') } : x))} /></td>
            <td><input style={field} value={t.label} onChange={e => setTiers(tiers.map((x, k) => k === i ? { ...x, label: e.target.value } : x))} /></td>
            <td><input style={{ ...field, textAlign: 'right' }} type="number" min={0} value={t.minPoints} onChange={e => setTiers(tiers.map((x, k) => k === i ? { ...x, minPoints: e.target.value } : x))} /></td>
            <td><input style={{ ...field, textAlign: 'right' }} type="number" min={1} max={10} step="0.05" value={t.earnMultiplier} onChange={e => setTiers(tiers.map((x, k) => k === i ? { ...x, earnMultiplier: e.target.value } : x))} /></td>
            <td style={{ textAlign: 'right' }}>{ov.tiers.find(x => x.code === t.code)?.customers ?? 0}</td>
            <td><button className="odoo-pager-btn" aria-label="Retirer le niveau" onClick={() => setTiers(tiers.filter((_, k) => k !== i))}><Trash2 size={12} /></button></td>
          </tr>
        ))}</tbody>
      </table>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="odoo-btn-secondary" disabled={tiers.length >= 10} onClick={() => setTiers([...tiers, { code: '', label: '', minPoints: '', earnMultiplier: '1', color: null, isActive: true }])} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Ajouter un niveau</button>
        <button className="odoo-btn-primary" disabled={saveTiers.isPending || tiers.some(t => t.code.length < 2 || !t.label.trim() || t.minPoints === '')} onClick={() => saveTiers.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Award size={13} /> Enregistrer les niveaux</button>
      </div>
    </>
  );
}

/* ─── Mouvements ──────────────────────────────────────────────────────────── */
function HistoryTab() {
  const [kind, setKind] = useState<LoyaltyKind | ''>('');
  const { data = [], isLoading } = useQuery({ queryKey: ['loyalty', 'transactions', kind], queryFn: () => loyaltyApi.transactions(kind) });
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={chip(kind === '')} onClick={() => setKind('')}>Tous</span>
        {(Object.keys(LOYALTY_KIND_LABEL) as LoyaltyKind[]).map(k => <span key={k} style={chip(kind === k)} onClick={() => setKind(k)}>{LOYALTY_KIND_LABEL[k]}</span>)}
      </div>
      {isLoading ? <Loader2 className="animate-spin" size={18} /> : data.length === 0 ? <p style={{ fontSize: '0.875rem', color: 'var(--theme-text-muted)' }}><History size={13} /> Aucun mouvement.</p> : (
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Client</th><th>Mouvement</th><th style={{ textAlign: 'right' }}>Points</th><th style={{ textAlign: 'right' }}>Valeur</th><th>Détail</th><th>Expire le</th></tr></thead>
          <tbody>{data.map(t => (
            <tr key={t.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(t.created_at), 'dd/MM/yyyy HH:mm')}</td>
              <td>{t.customer_name}</td>
              <td>{LOYALTY_KIND_LABEL[t.kind]}</td>
              <td style={{ textAlign: 'right', color: t.points < 0 ? '#dc3545' : '#198754', fontWeight: 600 }}>{t.points > 0 ? '+' : ''}{n0(t.points)}</td>
              <td style={{ textAlign: 'right' }}>{n2(t.amount)} DH</td>
              <td style={{ fontSize: '0.8125rem' }}>{t.note}{t.created_by_name ? ` · ${t.created_by_name}` : ''}</td>
              <td>{t.remaining && t.expires_at ? fr(t.expires_at) : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
