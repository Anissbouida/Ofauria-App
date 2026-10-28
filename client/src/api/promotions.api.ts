import api from './client';

/** Promotions (règles de prix) et programme de fidélité (mig 372). */
export type PromoTarget = 'items' | 'cart';
export type PromoKind = 'percent' | 'amount' | 'fixed_price' | 'buy_x_get_y';
export type CustomerScope = 'all' | 'identified' | 'particulier' | 'professionnel' | 'tier';
export type PromoState = 'running' | 'scheduled' | 'ended' | 'exhausted' | 'inactive';
export type Promotion = {
  id: string; name: string; description: string | null; target: PromoTarget; kind: PromoKind; value: string;
  buy_qty: number | null; get_qty: number | null; product_ids: string[]; category_ids: number[];
  min_quantity: string | null; min_amount: string | null; coupon_code: string | null;
  customer_scope: CustomerScope; min_tier_code: string | null; min_tier_label: string | null;
  on_pos: boolean; on_orders: boolean; on_quotes: boolean; store_id: string | null; store_name: string | null;
  starts_on: string | null; ends_on: string | null; days_of_week: number[]; time_from: string | null; time_to: string | null;
  max_uses: number | null; uses_count: number; priority: number; is_active: boolean;
  sales_count: number; granted_amount: string; granted_30d: string; state: PromoState; label: string; created_at: string;
};
export type PromotionInput = {
  name: string; description?: string | null; target: PromoTarget; kind: PromoKind; value: number; buyQty?: number | null; getQty?: number | null;
  productIds: string[]; categoryIds: number[]; minQuantity?: number | null; minAmount?: number | null; couponCode?: string | null;
  customerScope: CustomerScope; minTierCode?: string | null; onPos: boolean; onOrders: boolean; onQuotes: boolean; storeId?: string | null;
  startsOn?: string | null; endsOn?: string | null; daysOfWeek: number[]; timeFrom?: string | null; timeTo?: string | null;
  maxUses?: number | null; priority: number; isActive: boolean;
};
export type AppliedPromo = { promotionId: string; label: string; amount: number };
export type PromoEvaluation = {
  subtotal: number;
  promotion: {
    lines: { discount: number; promotionId: string | null; label: string | null }[];
    applied: AppliedPromo[]; itemsAmount: number; cartAmount: number; total: number;
    coupon: { code: string; status: 'applied' | 'superseded' | 'invalid' | 'not_applicable'; message: string } | null;
    freeToAdd: { promotionId: string; label: string; productId: string; quantity: number }[];
  };
  loyalty: {
    enabled: boolean; balance: number; value: number; pointValue: number; minRedeemPoints: number; maxRedeemPct: number;
    maxPoints: number; tier: { code: string; label: string } | null; earn: { points: number; perAmount: number; multiplier: number };
  } | null;
};

export type LoyaltySettings = {
  enabled: boolean; earn_points: number; earn_per_amount: string; point_value: string;
  min_redeem_points: number; max_redeem_pct: string; expiry_months: number;
};
export type LoyaltyTier = { code: string; label: string; min_points: number; earn_multiplier: string; color: string | null; is_active: boolean };
export type LoyaltyKind = 'earn' | 'redeem' | 'expire' | 'adjust' | 'reverse';
export type LoyaltyTx = {
  id: string; customer_id: string; kind: LoyaltyKind; points: number; amount: string; remaining: number | null; expires_at: string | null;
  sale_id: string | null; sale_number: string | null; note: string | null; created_by_name: string | null; created_at: string; customer_name?: string;
};
export type CustomerLoyalty = {
  enabled: boolean; balance: number; value: number; pointValue: number; minRedeemPoints: number; maxRedeemPct: number; redeemable: number;
  tier: LoyaltyTier | null; nextTier: LoyaltyTier | null; points12m: number; expiringSoon: number; expiringFirst: string | null; history: LoyaltyTx[];
};
export type LoyaltyOverview = {
  settings: LoyaltySettings; outstandingPoints: number; outstandingValue: number; members: number;
  last30: Partial<Record<LoyaltyKind, { points: number; amount: number }>>;
  tiers: { code: string; label: string; customers: number }[]; tiersConfig: LoyaltyTier[];
};

export const PROMO_KIND_LABEL: Record<PromoKind, string> = {
  percent: 'Pourcentage', amount: 'Montant', fixed_price: 'Prix spécial', buy_x_get_y: 'X achetés = Y offerts',
};
export const PROMO_STATE: Record<PromoState, { label: string; tag: string }> = {
  running: { label: 'En cours', tag: 'odoo-tag-green' }, scheduled: { label: 'Programmée', tag: 'odoo-tag-blue' },
  ended: { label: 'Terminée', tag: 'odoo-tag-grey' }, exhausted: { label: 'Épuisée', tag: 'odoo-tag-orange' }, inactive: { label: 'Arrêtée', tag: 'odoo-tag-grey' },
};
export const LOYALTY_KIND_LABEL: Record<LoyaltyKind, string> = {
  earn: 'Gagnés', redeem: 'Utilisés', expire: 'Expirés', adjust: 'Ajustement', reverse: 'Annulation',
};
export const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Niveau atteint pour un nombre de points gagnés sur 12 mois. */
export function tierOf(points12m: number, tiers: LoyaltyTier[]) {
  return [...tiers].filter(t => t.is_active && points12m >= t.min_points).sort((a, b) => b.min_points - a.min_points)[0] ?? null;
}

export const promotionsApi = {
  list: (): Promise<Promotion[]> => api.get('/promotions').then(r => r.data.data),
  create: (d: PromotionInput): Promise<Promotion> => api.post('/promotions', d).then(r => r.data.data),
  update: (id: string, d: PromotionInput): Promise<Promotion> => api.put(`/promotions/${id}`, d).then(r => r.data.data),
  remove: (id: string): Promise<{ archived?: boolean; deleted?: boolean }> => api.delete(`/promotions/${id}`).then(r => r.data.data),
  quick: (id: string, d: { isActive?: boolean; extendDays?: number }): Promise<Promotion> => api.patch(`/promotions/${id}/quick`, d).then(r => r.data.data),
  evaluate: (d: { items: { productId: string; quantity: number }[]; customerId?: string | null; channelId?: string | null; couponCode?: string | null; manualDiscount?: number }): Promise<PromoEvaluation> =>
    api.post('/promotions/evaluate', d).then(r => r.data.data),
};

export const loyaltyApi = {
  overview: (): Promise<LoyaltyOverview> => api.get('/loyalty/overview').then(r => r.data.data),
  tiers: (): Promise<LoyaltyTier[]> => api.get('/loyalty/tiers').then(r => r.data.data),
  saveSettings: (d: { enabled: boolean; earnPoints: number; earnPerAmount: number; pointValue: number; minRedeemPoints: number; maxRedeemPct: number; expiryMonths: number }): Promise<LoyaltySettings> =>
    api.put('/loyalty/settings', d).then(r => r.data.data),
  saveTiers: (tiers: { code: string; label: string; minPoints: number; earnMultiplier: number; color?: string | null; isActive: boolean }[]): Promise<LoyaltyTier[]> =>
    api.put('/loyalty/tiers', { tiers }).then(r => r.data.data),
  customer: (id: string): Promise<CustomerLoyalty> => api.get(`/loyalty/customers/${id}`).then(r => r.data.data),
  adjust: (id: string, points: number, note: string): Promise<CustomerLoyalty> => api.post(`/loyalty/customers/${id}/adjust`, { points, note }).then(r => r.data.data),
  transactions: (kind?: LoyaltyKind | ''): Promise<LoyaltyTx[]> => api.get('/loyalty/transactions', { params: kind ? { kind } : {} }).then(r => r.data.data),
};
