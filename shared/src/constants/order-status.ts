export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PRODUCTION: 'in_production',
  READY: 'ready',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Brouillon',
  confirmed: 'Confirmee',
  in_production: 'En production',
  ready: 'Prete',
  completed: 'Terminee',
  cancelled: 'Annulee',
};

export const ORDER_TYPES = {
  IN_STORE: 'in_store',
  CUSTOM: 'custom',
  ONLINE: 'online',
} as const;

export type OrderType = (typeof ORDER_TYPES)[keyof typeof ORDER_TYPES];

export const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  MOBILE: 'mobile',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];
