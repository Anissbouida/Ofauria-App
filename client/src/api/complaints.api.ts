import api from './client';

/** SAV : réclamations clients (mig 357). */
export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
export type ComplaintPriority = 'low' | 'normal' | 'high' | 'critical';
export type ComplaintChannel = 'counter' | 'phone' | 'email' | 'social' | 'other';
export type ResolutionCode = 'refund' | 'replacement' | 'voucher' | 'discount' | 'apology' | 'none' | 'not_founded';

export type ComplaintEvent = {
  id: string; event_type: 'created' | 'comment' | 'status' | 'assigned' | 'priority' | 'edited';
  from_value: string | null; to_value: string | null; note: string | null; by_name: string | null; created_at: string;
};

export type Complaint = {
  id: string; number: string; store_id: string | null;
  customer_id: string | null; customer_name: string | null; customer_phone: string | null; customer_label: string | null;
  customer_type: string | null;
  channel: ComplaintChannel; category_code: string; category_label: string | null; category_color: string | null;
  priority: ComplaintPriority; status: ComplaintStatus; subject: string; description: string | null;
  product_id: string | null; product_name: string | null; product_lot_id: string | null; lot_number: string | null;
  sale_id: string | null; sale_number: string | null; order_id: string | null; order_number: string | null;
  invoice_id: string | null; invoice_number: string | null; quantity: string | null; photo_url: string | null;
  due_at: string | null; is_overdue: boolean; assigned_to: string | null; assigned_name: string | null;
  resolution_code: ResolutionCode | null; resolution: string | null; resolution_amount: string | null;
  resolved_by: string | null; resolved_by_name: string | null; resolved_at: string | null; closed_at: string | null;
  created_by: string | null; created_by_name: string | null; created_at: string; updated_at: string;
  events?: ComplaintEvent[];
};

export type ComplaintInput = {
  customerId?: string | null; customerName?: string | null; customerPhone?: string | null;
  channel?: ComplaintChannel; categoryCode: string; priority?: ComplaintPriority;
  subject: string; description?: string | null;
  productId?: string | null; productLotId?: string | null; saleId?: string | null;
  orderId?: string | null; invoiceId?: string | null; quantity?: number | null; photoUrl?: string | null;
  assignedTo?: string | null;
};

export const PRIORITY_LABELS: Record<ComplaintPriority, string> = { critical: 'Critique', high: 'Haute', normal: 'Normale', low: 'Basse' };
export const STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: 'Ouverte', in_progress: 'En cours', resolved: 'Résolue', closed: 'Clôturée', rejected: 'Non fondée',
};
export const CHANNEL_LABELS: Record<ComplaintChannel, string> = {
  counter: 'Au comptoir', phone: 'Téléphone', email: 'E-mail', social: 'Réseaux sociaux', other: 'Autre',
};
export const RESOLUTION_LABELS: Record<ResolutionCode, string> = {
  refund: 'Remboursement', replacement: 'Remplacement', voucher: 'Bon d\'achat', discount: 'Remise',
  apology: 'Excuses / explication', none: 'Sans suite', not_founded: 'Non fondée',
};

export const complaintsApi = {
  create: (data: ComplaintInput): Promise<Complaint> => api.post('/complaints', data).then(r => r.data.data),
  list: (params: Record<string, string>): Promise<{ rows: Complaint[]; total: number; byStatus: Record<string, { count: number; overdue: number }> }> =>
    api.get('/complaints', { params }).then(r => r.data.data),
  indicators: (params: Record<string, string>): Promise<{ open: number; overdue: number; critical: number; created: number; amount: string }> =>
    api.get('/complaints/indicators', { params }).then(r => r.data.data),
  get: (id: string): Promise<Complaint> => api.get(`/complaints/${id}`).then(r => r.data.data),
  update: (id: string, data: Partial<ComplaintInput>): Promise<Complaint> => api.patch(`/complaints/${id}`, data).then(r => r.data.data),
  setStatus: (id: string, data: { status: ComplaintStatus; note?: string; resolutionCode?: ResolutionCode; resolution?: string; resolutionAmount?: number | null }): Promise<Complaint> =>
    api.post(`/complaints/${id}/status`, data).then(r => r.data.data),
  assign: (id: string, assignedTo: string | null): Promise<Complaint> => api.post(`/complaints/${id}/assign`, { assignedTo }).then(r => r.data.data),
  setPriority: (id: string, priority: ComplaintPriority): Promise<Complaint> => api.post(`/complaints/${id}/priority`, { priority }).then(r => r.data.data),
  comment: (id: string, note: string): Promise<Complaint> => api.post(`/complaints/${id}/comments`, { note }).then(r => r.data.data),
  lots: (productId: string, saleId?: string | null): Promise<{ id: string; lot_number: string; produced_at: string; expires_at: string | null }[]> =>
    api.get('/complaints/lookup/lots', { params: { productId, ...(saleId ? { saleId } : {}) } }).then(r => r.data.data),
  uploadPhoto: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('photo', file);
    const r = await api.post('/upload/complaint-photo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    return r.data.data.url as string;
  },
};
