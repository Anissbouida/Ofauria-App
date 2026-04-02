import type { OrderStatus, OrderType, PaymentMethod } from '../constants/order-status.js';
import type { Product } from './product.types.js';
import type { Customer } from './customer.types.js';

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  product?: Product;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId?: string;
  customer?: Customer;
  userId: string;
  type: OrderType;
  status: OrderStatus;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  pickupDate?: string;
  items?: OrderItem[];
  createdAt: string;
  completedAt?: string;
}

export interface CreateOrderRequest {
  customerId?: string;
  type: OrderType;
  items: { productId: string; quantity: number; notes?: string }[];
  paymentMethod: PaymentMethod;
  notes?: string;
  pickupDate?: string;
  discountAmount?: number;
}
