import api from './client';

export type RouteStatus = 'planned' | 'in_progress' | 'done';
export interface DeliveryRouteRow {
  id: string; label: string; route_date: string; driver_name: string | null; status: RouteStatus;
  notes: string | null; created_by_name: string | null; stops: number; delivered: number;
}
export interface RouteStop {
  id: string; sequence: number; delivered_at: string | null; note: string | null;
  delivery_note_id: string; delivery_number: string; delivery_date: string;
  customer_name: string; customer_phone: string | null; customer_address: string | null; customer_city: string | null;
}
export interface DeliveryRoute extends DeliveryRouteRow { stops_list: RouteStop[] }
export interface AvailableNote { id: string; number: string; delivery_date: string; customer_name: string; customer_city: string | null }

// getById renvoie la tournée avec `stops` (liste) ; on normalise en stops_list côté client.
function normalize(d: Record<string, unknown>): DeliveryRoute {
  return { ...(d as unknown as DeliveryRouteRow), stops_list: (d.stops as RouteStop[]) ?? [] };
}

export const deliveryRoutesApi = {
  list: (status?: RouteStatus): Promise<DeliveryRouteRow[]> =>
    api.get('/delivery-routes', { params: status ? { status } : {} }).then(r => r.data.data),
  getById: (id: string): Promise<DeliveryRoute> => api.get(`/delivery-routes/${id}`).then(r => normalize(r.data.data)),
  create: (data: { label: string; routeDate?: string | null; driverName?: string | null; notes?: string | null }): Promise<DeliveryRoute> =>
    api.post('/delivery-routes', data).then(r => normalize(r.data.data)),
  setStatus: (id: string, status: RouteStatus): Promise<DeliveryRoute> => api.post(`/delivery-routes/${id}/status`, { status }).then(r => normalize(r.data.data)),
  availableNotes: (): Promise<AvailableNote[]> => api.get('/delivery-routes/available-notes').then(r => r.data.data),
  addStops: (id: string, deliveryNoteIds: string[]): Promise<DeliveryRoute> => api.post(`/delivery-routes/${id}/stops`, { deliveryNoteIds }).then(r => normalize(r.data.data)),
  removeStop: (stopId: string): Promise<DeliveryRoute> => api.delete(`/delivery-routes/stops/${stopId}`).then(r => normalize(r.data.data)),
  reorder: (id: string, stopIds: string[]): Promise<DeliveryRoute> => api.post(`/delivery-routes/${id}/reorder`, { stopIds }).then(r => normalize(r.data.data)),
  markStop: (stopId: string, delivered: boolean): Promise<DeliveryRoute> => api.post(`/delivery-routes/stops/${stopId}/delivered`, { delivered }).then(r => normalize(r.data.data)),
};
