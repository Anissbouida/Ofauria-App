import api from './client';

export type OpeningCheckStatus = 'pending' | 'awaiting_validation' | 'validated' | 'rejected';
export type MissingReason =
  | 'theft'
  | 'breakage'
  | 'forgotten_recycle'
  | 'undeclared_loss'
  | 'measurement_error'
  | 'other';

export interface OpeningCheckPendingItem {
  product_id: string;
  product_name: string;
  expected_qty: number;
  is_reexposable: boolean;
  is_recyclable: boolean;
  shelf_life_days: number | null;
  display_life_hours: number | null;
  image_url: string | null;
}

export interface OpeningCheckPendingResponse {
  previousCheckId: string | null;
  lastClosingAt: string | null;
  items: OpeningCheckPendingItem[];
  existingCheck: {
    id: string;
    status: OpeningCheckStatus;
    validated_by: string | null;
    validated_at: string | null;
    rejection_reason: string | null;
  } | null;
}

export interface OpeningCheckSubmitItem {
  productId: string;
  expectedQty: number;
  foundQty: number;
  missingReason?: MissingReason;
}

export const openingInventoryCheckApi = {
  getPending: (): Promise<OpeningCheckPendingResponse> =>
    api.get('/inventory-checks/opening/pending').then((r) => r.data.data),

  submit: (data: { previousCheckId: string | null; items: OpeningCheckSubmitItem[]; notes?: string }) =>
    api.post('/inventory-checks/opening', data).then((r) => r.data.data),

  validate: (
    id: string,
    data: { action: 'approve' | 'reject'; rejectionReason?: string }
  ) => api.post(`/inventory-checks/opening/${id}/validate`, data).then((r) => r.data.data),

  listAwaitingValidation: () =>
    api.get('/inventory-checks/opening/awaiting-validation').then((r) => r.data.data),

  getById: (id: string) => api.get(`/inventory-checks/opening/${id}`).then((r) => r.data.data),
};
