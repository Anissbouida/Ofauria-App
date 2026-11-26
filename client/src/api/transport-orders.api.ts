import api from './client';

/** Ordres de transport (mig 726) : demande d'un client chargeur, distincte de la commande. */
export type TransportStatus = 'draft' | 'planned' | 'in_transit' | 'delivered' | 'cancelled';
export type PricingBasis = 'weight' | 'pallet' | 'distance';

export interface TransportOrder {
  id: string; number: string; status: TransportStatus; customer_id: string; customer_name: string;
  pickup_address: string; delivery_address: string; origin_zone: string | null; destination_zone: string | null;
  pickup_date: string | null; delivery_date: string | null; goods_description: string | null;
  weight_kg: string | null; pallets: string | null; distance_km: string | null; pricing_basis: PricingBasis | null;
  grid_id: string | null; grid_name: string | null; amount_ht: string; tax_amount: string; total_ttc: string;
  route_id: string | null; route_label: string | null; route_date: string | null; driver_name: string | null; vehicle_label: string | null;
  picked_up_at: string | null; delivered_at: string | null; pod_name: string | null; pod_note: string | null;
  invoice_id: string | null; invoice_number: string | null; notes: string | null;
}

export interface TransportOrderInput {
  customerId: string; pickupAddress: string; deliveryAddress: string; originZone?: string | null; destinationZone?: string | null;
  pickupDate?: string | null; deliveryDate?: string | null; goodsDescription?: string | null;
  weightKg?: number | null; pallets?: number | null; distanceKm?: number | null; pricingBasis?: PricingBasis | null;
  amountHt?: number | null; tvaRate?: number | null; notes?: string | null;
}

const data = <T,>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data);

export const transportOrdersApi = {
  list: (): Promise<TransportOrder[]> => data(api.get('/transport-orders')),
  create: (i: TransportOrderInput): Promise<TransportOrder> => data(api.post('/transport-orders', i)),
  update: (id: string, i: TransportOrderInput): Promise<TransportOrder> => data(api.put(`/transport-orders/${id}`, i)),
  plan: (id: string, routeId: string): Promise<TransportOrder> => data(api.put(`/transport-orders/${id}/plan`, { routeId })),
  pickup: (id: string): Promise<TransportOrder> => data(api.put(`/transport-orders/${id}/pickup`, {})),
  deliver: (id: string, podName: string, podNote?: string | null): Promise<TransportOrder> =>
    data(api.put(`/transport-orders/${id}/deliver`, { podName, podNote: podNote || null })),
  cancel: (id: string): Promise<TransportOrder> => data(api.put(`/transport-orders/${id}/cancel`, {})),
  invoice: (id: string): Promise<TransportOrder> => data(api.put(`/transport-orders/${id}/invoice`, {})),
};
