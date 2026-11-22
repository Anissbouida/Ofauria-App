import { money } from '../../utils/money';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Search, X } from 'lucide-react';
import { complaintsApi, CHANNEL_LABELS, PRIORITY_LABELS, type ComplaintChannel, type ComplaintPriority } from '../../api/complaints.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { salesApi } from '../../api/sales.api';
import { serverUrl } from '../../api/client';
import { apiErrorMessage } from '../../api/errors';
import { useReferentiel } from '../../hooks/useReferentiel';
import { notify } from '../../components/ui/InlineNotification';
import { Modal, FormSection, FormField, FormFooter } from '../ds';
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
  return (
    <Modal
      title="Nouvelle réclamation"
      onClose={onClose}
      locked={create.isPending}
      width={mode === 'full' ? 720 : 560}
      footer={<FormFooter onCancel={onClose} submitLabel="Enregistrer la réclamation" busy={create.isPending} disabled={!canSubmit} onSubmit={() => create.mutate()} />}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <FormSection title="Réclamation">
          {/* Motif : une pastille par catégorie, lisible d'un coup d'œil au comptoir. */}
          <div className="ds-field" role="group" aria-labelledby="complaint-motif-label">
            <label id="complaint-motif-label">Motif<span className="ds-req" aria-hidden="true"> *</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {categories.map(c => {
                const active = c.code === categoryCode;
                return (
                  <button key={c.code} type="button" onClick={() => setCategoryCode(c.code)} aria-pressed={active}
                    style={{
                      padding: '6px 12px', borderRadius: 999, fontSize: '13px', cursor: 'pointer',
                      border: `1px solid ${active ? (c.color || 'var(--ds-accent)') : 'var(--ds-sep)'}`,
                      background: active ? (c.color || 'var(--ds-accent)') : 'transparent',
                      color: active ? '#fff' : 'var(--ds-ink)', fontWeight: active ? 600 : 400,
                    }}>
                    {c.label}
                  </button>
                );
              })}
            </div>
            {isSafety && (
              <span className="ds-field-hint" style={{ color: 'var(--ds-danger)' }}>
                Sécurité / allergène : la réclamation sera créée en priorité critique et l'administrateur prévenu.
              </span>
            )}
          </div>

          <div className={mode === 'full' ? 'ds-form-grid' : undefined} style={mode === 'full' ? { marginTop: 12 } : { marginTop: 12, display: 'grid', gap: 12 }}>
            <FormField label="Article concerné">
              <SearchSelect options={productOptions} value={productId} onChange={id => { setProductId(id); setProductLotId(''); }}
                placeholder="Aucun article en particulier" width={mode === 'full' ? 320 : 500} />
            </FormField>
            {productId && lots.length > 0 && (
              <FormField label="Lot" htmlFor="complaint-lot">
                <select id="complaint-lot" className="ds-input" value={productLotId} onChange={e => setProductLotId(e.target.value)}>
                  <option value="">Lot inconnu</option>
                  {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} · {new Date(l.produced_at).toLocaleDateString('fr-FR')}</option>)}
                </select>
              </FormField>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <FormField label="En un mot" htmlFor="complaint-subject" required>
              <input id="complaint-subject" className="ds-input" value={subject} maxLength={200}
                onChange={e => { setSubject(e.target.value); setSubjectTouched(true); }} placeholder="Ex. : pain brûlé, retard de commande…" />
            </FormField>
          </div>
        </FormSection>

        {/* Client : fiche connue ou nom au comptoir. */}
        <FormSection title="Client">
          <div className="ds-form-grid">
            <FormField label="Client" htmlFor="complaint-customer" required>
              {customerId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="odoo-tag odoo-tag-blue">{customerLabel(customers.find(c => c.id === customerId)) || 'Fiche client'}</span>
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setCustomerId('')}>Changer</button>
                </div>
              ) : (
                <>
                  <input id="complaint-customer" className="ds-input" value={customerName} maxLength={160}
                    onChange={e => { setCustomerName(e.target.value); setCustomerQuery(e.target.value); }} placeholder="Nom du client (ou rechercher une fiche)" />
                  {customers.length > 0 && customerQuery.trim().length >= 2 && (
                    <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 4, marginTop: 4, maxHeight: 140, overflowY: 'auto' }}>
                      {customers.slice(0, 8).map(c => (
                        <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setCustomerQuery(''); }}
                          style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '6px 10px', fontSize: '13px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                          <span>{customerLabel(c)}</span>
                          <span style={{ color: 'var(--ds-muted)' }}>{c.phone || ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </FormField>
            <FormField label="Téléphone" htmlFor="complaint-phone">
              <input id="complaint-phone" className="ds-input" value={customerPhone} maxLength={40} onChange={e => setCustomerPhone(e.target.value)} placeholder="Pour rappeler le client" />
            </FormField>
          </div>
        </FormSection>

        {mode === 'full' && (
          <FormSection title="Détails">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <FormField label="Canal" htmlFor="complaint-channel">
                <select id="complaint-channel" className="ds-input" value={channel} onChange={e => setChannel(e.target.value as ComplaintChannel)}>
                  {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FormField>
              <FormField label="Priorité" htmlFor="complaint-priority">
                <select id="complaint-priority" className="ds-input" value={isSafety ? 'critical' : priority} disabled={isSafety}
                  onChange={e => setPriority(e.target.value as ComplaintPriority)}>
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FormField>
              <FormField label="Quantité" htmlFor="complaint-qty">
                <input id="complaint-qty" className="ds-input" type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="—" />
              </FormField>
            </div>
            <div style={{ marginTop: 12 }}>
              <FormField label="Ticket de caisse" htmlFor="complaint-sale">
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: 13, color: 'var(--ds-muted)' }} aria-hidden="true" />
                  <input id="complaint-sale" className="ds-input" style={{ paddingLeft: 26 }} value={saleQuery} onChange={e => { setSaleQuery(e.target.value); setSaleId(''); }}
                    placeholder="N° de ticket (VNT-…)" />
                </div>
                {sales.length > 0 && !saleId && (
                  <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 4, marginTop: 4, maxHeight: 140, overflowY: 'auto' }}>
                    {sales.map(s => (
                      <button key={s.id} type="button" onClick={() => { setSaleId(s.id); setSaleQuery(s.sale_number); if (s.customer_id && !customerId) setCustomerId(s.customer_id); }}
                        style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '6px 10px', fontSize: '13px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                        <span className="ds-ref">{s.sale_number}</span>
                        <span style={{ color: 'var(--ds-muted)' }}>{new Date(s.created_at).toLocaleDateString('fr-FR')} · {money(Number(s.total))}</span>
                      </button>
                    ))}
                  </div>
                )}
              </FormField>
            </div>
            <div style={{ marginTop: 12 }}>
              <FormField label="Description" htmlFor="complaint-description">
                <textarea id="complaint-description" className="ds-input" style={{ minHeight: 80 }} value={description} maxLength={4000}
                  onChange={e => setDescription(e.target.value)} placeholder="Ce que dit le client, ce qui a été constaté…" />
              </FormField>
            </div>
          </FormSection>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
          <button type="button" className="odoo-btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} {photoUrl ? 'Changer la photo' : 'Photo'}
          </button>
          {photoUrl && <img src={serverUrl(photoUrl)} alt="" style={{ height: 44, borderRadius: 4, border: '1px solid var(--ds-sep)' }} />}
          {photoUrl && <button type="button" className="odoo-btn-secondary" onClick={() => setPhotoUrl(null)} aria-label="Retirer la photo"><X size={12} /></button>}
        </div>
      </div>
    </Modal>
  );
}
