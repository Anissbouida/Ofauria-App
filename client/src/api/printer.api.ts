import api from './client';

export type PrinterConfig = {
  id: string;
  store_id: string;
  name: string;
  type: 'receipt' | 'kitchen' | 'label';
  interface: 'tcp' | 'usb' | 'serial';
  connection_string: string;
  printer_model: 'EPSON' | 'STAR' | 'TANCA' | 'DARUMA' | 'BROTHER' | 'CUSTOM';
  character_set: string;
  paper_width: number;
  is_default: boolean;
  is_active: boolean;
  open_drawer_on_cash: boolean;
  notes: string | null;
};

export const printersApi = {
  list: () => api.get('/printers').then(r => r.data.data as PrinterConfig[]),
  create: (data: Partial<PrinterConfig> & { connectionString: string; name: string }) =>
    api.post('/printers', data).then(r => r.data.data as PrinterConfig),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/printers/${id}`, data).then(r => r.data.data as PrinterConfig),
  remove: (id: string) => api.delete(`/printers/${id}`),
  test: (id: string) => api.post(`/printers/${id}/test`).then(r => r.data),
  openDrawer: (id: string) => api.post(`/printers/${id}/open-drawer`).then(r => r.data),
};

export const salePrintApi = {
  printSale: (saleId: string, opts?: { cashGiven?: number; changeAmount?: number; openDrawer?: boolean }) =>
    api.post(`/sales/${saleId}/print`, opts || {}).then(r => r.data),
};
