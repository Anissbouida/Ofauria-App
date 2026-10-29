import api from './client';

export interface SearchResult {
  type: 'ingredient' | 'product' | 'customer' | 'supplier';
  typeLabel: string;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

export const searchApi = {
  global: (q: string): Promise<SearchResult[]> =>
    api.get('/search', { params: { q } }).then(r => r.data.data),
};
