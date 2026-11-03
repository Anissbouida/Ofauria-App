export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PRODUCTION: 'in_production',
  READY: 'ready',
  /** Livrée en partie, reliquat attendu (O2C L2, mig 441). */
  PARTIALLY_DELIVERED: 'partially_delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Brouillon',
  confirmed: 'Confirmee',
  in_production: 'En production',
  ready: 'Prete',
  partially_delivered: 'Livree en partie',
  completed: 'Terminee',
  cancelled: 'Annulee',
};

export const ORDER_TYPES = {
  IN_STORE: 'in_store',
  CUSTOM: 'custom',
  ONLINE: 'online',
  STAFF: 'staff',
} as const;

export type OrderType = (typeof ORDER_TYPES)[keyof typeof ORDER_TYPES];

export const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  MOBILE: 'mobile',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];
