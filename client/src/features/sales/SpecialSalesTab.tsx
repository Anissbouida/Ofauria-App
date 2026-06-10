import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Briefcase, Plus, X, Trash2, Search, Banknote, CreditCard,
  Clock, CheckCircle, AlertTriangle, User as UserIcon, Save,
} from 'lucide-react';
import { salesApi } from '../../api/sales.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { getApiErrorMessage } from '../../utils/api-error';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' DH';
}

type LineDraft = {
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Espèces',
  card: 'Carte',
  transfer: 'Virement',
  check: 'Chèque',
  mobile: 'Mobile',
  credit: 'Crédit',
};

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Espèces' },
  { value: 'card', label: 'Carte' },
  { value: 'transfer', label: 'Virement' },
  { value: 'check', label: 'Chèque' },
];

export default function SpecialSalesTab({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['sales-special', { dateFrom, dateTo }],
    queryFn: () => salesApi.list({ dateFrom, dateTo, saleType: 'special', limit: '500' }),
  });
  const rows: Record<string, any>[] = listData?.data || [];

  const totals = useMemo(() => {
    let revenue = 0;
    let cash = 0;
    let card = 0;
    let credit = 0;
    for (const r of rows) {
      const t = parseFloat(r.total as string) || 0;
      revenue += t;
      if (r.payment_method === 'cash') cash += t;
      else if (r.payment_method === 'card') card += t;
      else if (r.payment_method === 'credit') credit += t;
    }
    return { revenue, cash, card, credit };
  }, [rows]);

  return (
    <>
      {/* KPI tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <Briefcase size={11} style={{ display: 'inline', marginRight: 4 }} />CA Ventes spéciales
          </div>
          <div className="odoo-stat-card-value">{formatCurrency(totals.revenue)}</div>
          <div className="odoo-stat-card-sub">{rows.length} vente{rows.length > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <Banknote size={11} style={{ display: 'inline', marginRight: 4, color: '#28a745' }} />Espèces
          </div>
          <div className="odoo-stat-card-value">{formatCurrency(totals.cash)}</div>
          <div className="odoo-stat-card-sub">{' '}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <CreditCard size={11} style={{ display: 'inline', marginRight: 4 }} />Carte / Virement
          </div>
          <div className="odoo-stat-card-value">{formatCurrency(totals.card)}</div>
          <div className="odoo-stat-card-sub">{' '}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <Clock size={11} style={{ display: 'inline', marginRight: 4, color: '#b85d1a' }} />Impayé
          </div>
          <div className="odoo-stat-card-value" style={{ color: totals.credit > 0 ? '#b85d1a' : undefined }}>
            {formatCurrency(totals.credit)}
          </div>
          <div className="odoo-stat-card-sub">{' '}</div>
        </div>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>
          Ventes B2B / gros client avec prix négociés. Pas de déduction du stock vitrine.
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="odoo-btn-primary"
          onClick={() => setShowForm(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Plus size={13} /> Nouvelle vente spéciale
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Briefcase size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune vente spéciale pour cette période</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>N° Vente</th>
                <th>Date</th>
                <th>Client B2B</th>
                <th>Paiement</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s: Record<string, any>) => {
                const isUnpaid = s.payment_status === 'unpaid';
                const pmLabel = PAYMENT_LABELS[s.payment_method as string] || (s.payment_method as string);
                const customer = s.customer_first_name
                  ? `${s.customer_first_name as string} ${s.customer_last_name as string}`
                  : (s.unpaid_customer_name as string) || '—';
                return (
                  <tr key={s.id as string}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{s.sale_number as string}</td>
                    <td>{format(new Date(s.created_at as string), 'dd/MM/yyyy', { locale: fr })}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <UserIcon size={11} style={{ color: 'var(--theme-text-muted)' }} />
                        {customer}
                      </span>
                    </td>
                    <td>
                      <span className={`odoo-tag ${isUnpaid ? 'odoo-tag-yellow' : 'odoo-tag-grey'}`}>{pmLabel}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(parseFloat(s.total as string))}</td>
                    <td>
                      {isUnpaid ? (
                        <span className="odoo-tag odoo-tag-yellow">
                          <Clock size={9} style={{ display: 'inline', marginRight: 2 }} /> Impayée
                        </span>
                      ) : (
                        <span className="odoo-tag odoo-tag-green">
                          <CheckCircle size={9} style={{ display: 'inline', marginRight: 2 }} /> Réglée
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <SpecialSaleFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['sales-special'] });
            queryClient.invalidateQueries({ queryKey: ['sales'] });
            queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
            queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
            setShowForm(false);
          }}
        />
      )}
    </>
  );
}

function SpecialSaleFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid'>('paid');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [saleDate, setSaleDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [lines, setLines] = useState<LineDraft[]>([
    { productId: '', productName: '', quantity: '1', unitPrice: '0' },
  ]);
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});

  const { data: customersResp } = useQuery({
    queryKey: ['customers-b2b', { search: customerSearch }],
    queryFn: () => customersApi.list({ customerType: 'professionnel', search: customerSearch, limit: '50' }),
  });
  const customers: Record<string, any>[] = customersResp?.data || [];

  const { data: productsResp } = useQuery({
    queryKey: ['products-special-form'],
    queryFn: () => productsApi.list({ limit: '500' }),
  });
  const products: Record<string, any>[] = productsResp?.data || [];

  const subtotal = useMemo(() => {
    return lines.reduce((sum, l) => {
      const q = parseFloat(l.quantity || '0') || 0;
      const p = parseFloat(l.unitPrice || '0') || 0;
      return sum + q * p;
    }, 0);
  }, [lines]);
  const discount = Math.max(0, parseFloat(discountAmount || '0') || 0);
  const total = Math.max(0, subtotal - discount);

  const customerSelected = customers.find(c => c.id === customerId) || null;

  useEffect(() => {
    if (customerSelected) {
      const label = customerSelected.company_name
        ? customerSelected.company_name as string
        : `${customerSelected.first_name as string} ${customerSelected.last_name as string}`;
      setCustomerSearch(label);
    }
  }, [customerSelected]);

  const addLine = () => setLines(prev => [...prev, { productId: '', productName: '', quantity: '1', unitPrice: '0' }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<LineDraft>) => {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  };

  const filteredProductsForLine = (i: number): Record<string, any>[] => {
    const q = (productSearch[i] || '').toLowerCase().trim();
    if (!q) return products.slice(0, 30);
    return products.filter(p => {
      const name = (p.name as string || '').toLowerCase();
      const cat = (p.category_name as string || '').toLowerCase();
      return name.includes(q) || cat.includes(q);
    }).slice(0, 30);
  };

  const mutation = useMutation({
    mutationFn: () => salesApi.createSpecial({
      customerId,
      items: lines
        .filter(l => l.productId && parseFloat(l.quantity || '0') > 0)
        .map(l => ({
          productId: l.productId,
          quantity: parseInt(l.quantity, 10),
          unitPrice: parseFloat(l.unitPrice),
        })),
      paymentMethod,
      paymentStatus,
      discountAmount: discount,
      notes: notes.trim() || undefined,
      saleDate,
    }),
    onSuccess: () => {
      notify.success('Vente spéciale créée');
      onSaved();
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la création')),
  });

  const validLines = lines.filter(l => l.productId && parseFloat(l.quantity || '0') > 0 && parseFloat(l.unitPrice || '0') >= 0);
  const canSubmit = !!customerId && validLines.length > 0 && total >= 0 && !mutation.isPending;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--theme-bg-card)',
          borderRadius: 8,
          width: '90vw',
          maxWidth: 880,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={15} style={{ color: 'var(--theme-accent)' }} />
          <strong style={{ fontSize: '0.9375rem' }}>Nouvelle vente spéciale B2B</strong>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {/* Client + date */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 }}>
                Client B2B *
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--theme-text-muted)' }} />
                <input
                  type="text"
                  placeholder="Rechercher par nom ou société…"
                  value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); setCustomerId(''); }}
                  style={{
                    width: '100%', padding: '6px 8px 6px 24px',
                    border: '1px solid var(--theme-bg-separator)', borderRadius: 4,
                    fontSize: '0.8125rem',
                  }}
                />
                {!customerId && customerSearch.trim().length > 0 && customers.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--theme-bg-card)', border: '1px solid var(--theme-bg-separator)',
                    borderRadius: 4, marginTop: 2, maxHeight: 220, overflowY: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}>
                    {customers.slice(0, 15).map(c => (
                      <div
                        key={c.id as string}
                        onClick={() => setCustomerId(c.id as string)}
                        style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.8125rem', borderBottom: '1px solid var(--theme-bg-separator)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-bg-page)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <strong>{c.company_name as string || `${c.first_name as string} ${c.last_name as string}`}</strong>
                        {c.company_name && <span style={{ color: 'var(--theme-text-muted)', marginLeft: 6, fontSize: '0.6875rem' }}>
                          {c.first_name as string} {c.last_name as string}
                        </span>}
                        {c.phone && <span style={{ color: 'var(--theme-text-muted)', marginLeft: 6, fontSize: '0.6875rem' }}>
                          · {c.phone as string}
                        </span>}
                      </div>
                    ))}
                  </div>
                )}
                {customerSearch.trim().length > 0 && !customerId && customers.length === 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, padding: '8px 10px', fontSize: '0.75rem', color: 'var(--theme-text-muted)', background: 'var(--theme-bg-card)', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, marginTop: 2 }}>
                    Aucun client B2B trouvé. Créez-en un dans le module Clients (type "professionnel").
                  </div>
                )}
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 }}>
                Date de la vente
              </label>
              <input
                type="date"
                value={saleDate}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setSaleDate(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Lines */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.8125rem' }}>Articles</strong>
              <span style={{ flex: 1 }} />
              <button
                onClick={addLine}
                className="odoo-btn-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.75rem' }}
              >
                <Plus size={11} /> Ajouter une ligne
              </button>
            </div>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Qté</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Prix unit. négocié (DH)</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Sous-total</th>
                  <th style={{ width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const lineSub = (parseFloat(l.quantity || '0') || 0) * (parseFloat(l.unitPrice || '0') || 0);
                  return (
                    <tr key={i}>
                      <td style={{ position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Rechercher un produit…"
                          value={l.productName || productSearch[i] || ''}
                          onChange={e => {
                            updateLine(i, { productId: '', productName: '' });
                            setProductSearch(prev => ({ ...prev, [i]: e.target.value }));
                          }}
                          style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.75rem' }}
                        />
                        {!l.productId && (productSearch[i] || '').length > 0 && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                            background: 'var(--theme-bg-card)', border: '1px solid var(--theme-bg-separator)',
                            borderRadius: 4, marginTop: 2, maxHeight: 200, overflowY: 'auto',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          }}>
                            {filteredProductsForLine(i).map(p => (
                              <div
                                key={p.id as string}
                                onClick={() => {
                                  const defaultPrice = parseFloat(p.price as string) || 0;
                                  updateLine(i, {
                                    productId: p.id as string,
                                    productName: p.name as string,
                                    unitPrice: defaultPrice ? String(defaultPrice) : l.unitPrice,
                                  });
                                  setProductSearch(prev => ({ ...prev, [i]: '' }));
                                }}
                                style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem', borderBottom: '1px solid var(--theme-bg-separator)' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--theme-bg-page)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              >
                                <strong>{p.name as string}</strong>
                                <span style={{ color: 'var(--theme-text-muted)', marginLeft: 6 }}>
                                  · prix std {formatCurrency(parseFloat(p.price as string) || 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <input type="number" min="1" step="1" value={l.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })}
                          style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.75rem', textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" value={l.unitPrice}
                          onChange={e => updateLine(i, { unitPrice: e.target.value })}
                          style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.75rem', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.75rem' }}>
                        {formatCurrency(lineSub)}
                      </td>
                      <td>
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d9534f', padding: 2 }}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals + paiement */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 }}>
                Mode de paiement
              </label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                disabled={paymentStatus === 'unpaid'}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, fontSize: '0.8125rem' }}
              >
                {PAYMENT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={paymentStatus === 'unpaid'}
                    onChange={e => setPaymentStatus(e.target.checked ? 'unpaid' : 'paid')}
                  />
                  <span style={{ color: paymentStatus === 'unpaid' ? '#b85d1a' : 'var(--theme-text-muted)' }}>
                    Vente à crédit (impayée, à régler plus tard)
                  </span>
                </label>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 }}>
                  Remise globale (DH)
                </label>
                <input type="number" min="0" step="0.01" value={discountAmount}
                  onChange={e => setDiscountAmount(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, fontSize: '0.8125rem', textAlign: 'right' }}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 }}>
                  Notes (optionnel)
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, fontSize: '0.75rem', resize: 'vertical' }}
                />
              </div>
            </div>
            <div style={{ background: 'var(--theme-bg-page)', borderRadius: 6, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: 6 }}>
                <span style={{ color: 'var(--theme-text-muted)' }}>Sous-total</span>
                <strong>{formatCurrency(subtotal)}</strong>
              </div>
              {discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: 6, color: '#b85d1a' }}>
                  <span>Remise</span>
                  <strong>- {formatCurrency(discount)}</strong>
                </div>
              )}
              <div style={{ height: 1, background: 'var(--theme-bg-separator)', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem' }}>
                <strong>Total</strong>
                <strong style={{ color: 'var(--theme-accent)' }}>{formatCurrency(total)}</strong>
              </div>
              {discount > subtotal && (
                <div style={{ marginTop: 8, fontSize: '0.7rem', color: '#d9534f', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={11} /> Remise supérieure au sous-total
                </div>
              )}
              {!customerId && (
                <div style={{ marginTop: 8, fontSize: '0.7rem', color: '#b85d1a', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={11} /> Sélectionnez un client B2B
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || discount > subtotal}
            className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Save size={13} />
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer la vente'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
