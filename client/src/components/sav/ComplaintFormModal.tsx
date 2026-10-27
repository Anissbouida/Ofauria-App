import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, MessageSquareWarning, Search, X } from 'lucide-react';
import { complaintsApi, CHANNEL_LABELS, PRIORITY_LABELS, type ComplaintChannel, type ComplaintPriority } from '../../api/complaints.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { salesApi } from '../../api/sales.api';
import { serverUrl } from '../../api/client';
import { apiErrorMessage } from '../../api/errors';
import { useReferentiel } from '../../hooks/useReferentiel';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';

/**
 * Saisie d'une réclamation client (mig 357), partagée entre la caisse et Contrôle.
 *   - mode « quick » (caisse) : motif, article, un mot, nom du client ; 30 secondes.
 *   - mode « full » (gérant) : + canal, priorité, ticket / commande, lot, description.
 * Le client est une fiche si on la connaît, sinon un nom libre. Tout lien (article,
 * ticket, lot) est optionnel : le formulaire sert tel quel à n'importe quelle activité.
 */
/** Libellé d'une fiche client : société, sinon prénom + nom. */
function customerLabel(c?: Record<string, any> | null): string {
  if (!c) return '';
  return (c.company_name as string)?.trim() || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
}

export default function ComplaintFormModal({ mode, onClose, onCreated, defaults }: {
  mode: 'quick' | 'full';
  onClose: () => void;
  onCreated?: (id: string) => void;
  defaults?: { saleId?: string | null; productId?: string | null; customerId?: string | null };
}) {
  const qc = useQueryClient();
  const { entries: categories } = useReferentiel('complaint_categories');
  const [categoryCode, setCategoryCode] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [customerId, setCustomerId] = useState(defaults?.customerId ?? '');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [productId, setProductId] = useState(defaults?.productId ?? '');
  const [productLotId, setProductLotId] = useState('');
  const [saleId, setSaleId] = useState(defaults?.saleId ?? '');
  const [saleQuery, setSaleQuery] = useState('');
  const [quantity, setQuantity] = useState('');
  const [channel, setChannel] = useState<ComplaintChannel>('counter');
  const [priority, setPriority] = useState<ComplaintPriority>('normal');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Le sujet reprend le motif tant que l'utilisateur ne l'a pas réécrit.
  useEffect(() => {
    if (subjectTouched) return;
    const c = categories.find(e => e.code === categoryCode);
    if (c) setSubject(c.label);
  }, [categoryCode, categories, subjectTouched]);

  const { data: productsData } = useQuery({ queryKey: ['products', 'all-for-complaint'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products: { id: string; name: string; sku?: string }[] = productsData?.data ?? [];
  const productOptions = useMemo(() => products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku })), [products]);

  const { data: customersData } = useQuery({
    queryKey: ['customers', 'search', customerQuery],
    queryFn: () => customersApi.list({ search: customerQuery, limit: '20' }),
    enabled: customerQuery.trim().length >= 2,
  });
  const customers: Record<string, any>[] = customersData?.data ?? [];

  const { data: salesData } = useQuery({
    queryKey: ['sales', 'search', saleQuery],
    queryFn: () => salesApi.list({ search: saleQuery, limit: '10' }),
    enabled: mode === 'full' && saleQuery.trim().length >= 3,
  });
  const sales: Record<string, any>[] = salesData?.data ?? [];

  const { data: lots = [] } = useQuery({
    queryKey: ['complaint-lots', productId, saleId],
    queryFn: () => complaintsApi.lots(productId, saleId || null),
    enabled: !!productId,
  });
  // Un seul lot possible (celui du ticket) : on le prend d'office.
  useEffect(() => { if (lots.length === 1) setProductLotId(lots[0].id); }, [lots]);

  const create = useMutation({
    mutationFn: () => complaintsApi.create({
      categoryCode, subject: subject.trim(), description: description.trim() || null,
      customerId: customerId || null, customerName: customerId ? null : customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      productId: productId || null, productLotId: productLotId || null, saleId: saleId || null,
      quantity: quantity ? Number(quantity) : null, photoUrl,
      channel, priority: mode === 'full' ? priority : undefined,
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['complaints'] });
      qc.invalidateQueries({ queryKey: ['controle-overview'] });
      notify.success(`Réclamation ${c.number} enregistrée`);
      onCreated?.(c.id);
      onClose();
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { setPhotoUrl(await complaintsApi.uploadPhoto(file)); }
    catch (e) { notify.error(apiErrorMessage(e)); }
    finally { setUploading(false); }
  };

  const canSubmit = !!categoryCode && subject.trim().length > 0 && (!!customerId || customerName.trim().length > 0) && !create.isPending;
  const isSafety = categoryCode === 'safety';
  const label: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, display: 'block' };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: mode === 'full' ? 720 : 560, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb">
            <MessageSquareWarning size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="odoo-breadcrumb-current">Nouvelle réclamation</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
        </div>

        <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
          {/* Motif : une pastille par catégorie, lisible d'un coup d'œil au comptoir. */}
          <div>
            <span style={label}>Motif</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {categories.map(c => {
                const active = c.code === categoryCode;
                return (
                  <button key={c.code} type="button" onClick={() => setCategoryCode(c.code)}
                    style={{
                      padding: '6px 12px', borderRadius: 999, fontSize: '0.8125rem', cursor: 'pointer',
                      border: `1px solid ${active ? (c.color || 'var(--odoo-purple)') : 'var(--odoo-border)'}`,
                      background: active ? (c.color || 'var(--odoo-purple)') : 'transparent',
                      color: active ? '#fff' : 'var(--odoo-text)', fontWeight: active ? 600 : 400,
                    }}>
                    {c.label}
                  </button>
                );
              })}
            </div>
            {isSafety && (
              <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: '#dc3545' }}>
                Sécurité / allergène : la réclamation sera créée en priorité critique et l'administrateur prévenu.
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: mode === 'full' ? '1fr 1fr' : '1fr', gap: 12 }}>
            <div>
              <span style={label}>Article concerné</span>
              <SearchSelect options={productOptions} value={productId} onChange={id => { setProductId(id); setProductLotId(''); }}
                placeholder="Aucun article en particulier" width={mode === 'full' ? 320 : 500} />
            </div>
            {productId && lots.length > 0 && (
              <div>
                <span style={label}>Lot</span>
                <select className="input" value={productLotId} onChange={e => setProductLotId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Lot inconnu</option>
                  {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} · {new Date(l.produced_at).toLocaleDateString('fr-FR')}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <span style={label}>En un mot</span>
            <input className="input" style={{ width: '100%' }} value={subject} maxLength={200}
              onChange={e => { setSubject(e.target.value); setSubjectTouched(true); }} placeholder="Ex. : pain brûlé, retard de commande…" />
          </div>

          {/* Client : fiche connue ou nom au comptoir. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <span style={label}>Client</span>
              {customerId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="odoo-tag odoo-tag-blue">{customerLabel(customers.find(c => c.id === customerId)) || 'Fiche client'}</span>
                  <button type="button" className="odoo-btn-secondary" onClick={() => setCustomerId('')}>Changer</button>
                </div>
              ) : (
                <>
                  <input className="input" style={{ width: '100%' }} value={customerName} maxLength={160}
                    onChange={e => { setCustomerName(e.target.value); setCustomerQuery(e.target.value); }} placeholder="Nom du client (ou rechercher une fiche)" />
                  {customers.length > 0 && customerQuery.trim().length >= 2 && (
                    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, marginTop: 4, maxHeight: 140, overflowY: 'auto' }}>
                      {customers.slice(0, 8).map(c => (
                        <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setCustomerQuery(''); }}
                          style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '6px 10px', fontSize: '0.8125rem', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                          <span>{customerLabel(c)}</span>
                          <span style={{ color: 'var(--theme-text-muted)' }}>{c.phone || ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <span style={label}>Téléphone</span>
              <input className="input" style={{ width: '100%' }} value={customerPhone} maxLength={40} onChange={e => setCustomerPhone(e.target.value)} placeholder="Pour rappeler le client" />
            </div>
          </div>

          {mode === 'full' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <span style={label}>Canal</span>
                  <select className="input" style={{ width: '100%' }} value={channel} onChange={e => setChannel(e.target.value as ComplaintChannel)}>
                    {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <span style={label}>Priorité</span>
                  <select className="input" style={{ width: '100%' }} value={isSafety ? 'critical' : priority} disabled={isSafety}
                    onChange={e => setPriority(e.target.value as ComplaintPriority)}>
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <span style={label}>Quantité</span>
                  <input className="input" style={{ width: '100%' }} type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="—" />
                </div>
              </div>
              <div>
                <span style={label}>Ticket de caisse</span>
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--theme-text-muted)' }} />
                  <input className="input" style={{ width: '100%', paddingLeft: 26 }} value={saleQuery} onChange={e => { setSaleQuery(e.target.value); setSaleId(''); }}
                    placeholder="N° de ticket (VNT-…)" />
                </div>
                {sales.length > 0 && !saleId && (
                  <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, marginTop: 4, maxHeight: 140, overflowY: 'auto' }}>
                    {sales.map(s => (
                      <button key={s.id} type="button" onClick={() => { setSaleId(s.id); setSaleQuery(s.sale_number); if (s.customer_id && !customerId) setCustomerId(s.customer_id); }}
                        style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '6px 10px', fontSize: '0.8125rem', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                        <span className="font-mono">{s.sale_number}</span>
                        <span style={{ color: 'var(--theme-text-muted)' }}>{new Date(s.created_at).toLocaleDateString('fr-FR')} · {Number(s.total).toFixed(2)} DH</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <span style={label}>Description</span>
                <textarea className="input" style={{ width: '100%', minHeight: 80 }} value={description} maxLength={4000}
                  onChange={e => setDescription(e.target.value)} placeholder="Ce que dit le client, ce qui a été constaté…" />
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
            <button type="button" className="odoo-btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} {photoUrl ? 'Changer la photo' : 'Photo'}
            </button>
            {photoUrl && <img src={serverUrl(photoUrl)} alt="" style={{ height: 44, borderRadius: 4, border: '1px solid var(--odoo-border)' }} />}
            {photoUrl && <button type="button" className="odoo-btn-secondary" onClick={() => setPhotoUrl(null)}><X size={12} /></button>}
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!canSubmit} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Enregistrer la réclamation
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
