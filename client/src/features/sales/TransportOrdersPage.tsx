import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, CalendarCheck, PackageOpen, CheckCircle2, XCircle, Receipt, Pencil } from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { usePermissions } from '../../context/PermissionsContext';
import { customersApi } from '../../api/customers.api';
import { deliveryRoutesApi } from '../../api/delivery-routes.api';
import { transportOrdersApi, type TransportOrder, type TransportOrderInput, type TransportStatus, type PricingBasis } from '../../api/transport-orders.api';
import { money } from '../../utils/money';
import SalesPageShell from './SalesPageShell';
import { FilterChips } from './ListTemplate';
import { TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, DataPanel, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

/**
 * Ventes › Ordres de transport (mig 726, feuille de route étape 6.2) : la demande d'un client
 * chargeur, distincte de la commande. Saisie (trajet, marchandise, prix par la grille), puis
 * planification sur une tournée (chauffeur et véhicule de la tournée), enlèvement, livraison
 * avec preuve, facturation.
 */
const STATUS: Record<TransportStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Saisi', tone: 'draft' }, planned: { label: 'Planifié', tone: 'todo' }, in_transit: { label: 'En cours', tone: 'progress' },
  delivered: { label: 'Livré', tone: 'done' }, cancelled: { label: 'Annulé', tone: 'cancelled' },
};
const BASIS: Record<PricingBasis, string> = { weight: 'Poids (kg)', pallet: 'Palettes', distance: 'Distance (km)' };
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const first = (s: string) => s.split('\n')[0];

type Draft = { id?: string; customerId: string; pickupAddress: string; deliveryAddress: string; originZone: string; destinationZone: string;
  pickupDate: string; deliveryDate: string; goodsDescription: string; weightKg: string; pallets: string; distanceKm: string;
  pricingBasis: '' | PricingBasis; amountHt: string; tvaRate: string; notes: string };
const EMPTY: Draft = { customerId: '', pickupAddress: '', deliveryAddress: '', originZone: '', destinationZone: '', pickupDate: '', deliveryDate: '',
  goodsDescription: '', weightKg: '', pallets: '', distanceKm: '', pricingBasis: 'weight', amountHt: '', tvaRate: '', notes: '' };
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const toInput = (d: Draft): TransportOrderInput => ({
  customerId: d.customerId, pickupAddress: d.pickupAddress, deliveryAddress: d.deliveryAddress, originZone: d.originZone || null,
  destinationZone: d.destinationZone || null, pickupDate: d.pickupDate || null, deliveryDate: d.deliveryDate || null,
  goodsDescription: d.goodsDescription || null, weightKg: numOrNull(d.weightKg), pallets: numOrNull(d.pallets), distanceKm: numOrNull(d.distanceKm),
  pricingBasis: d.pricingBasis || null, amountHt: numOrNull(d.amountHt), tvaRate: numOrNull(d.tvaRate), notes: d.notes || null,
});
const fromOrder = (o: TransportOrder): Draft => ({
  id: o.id, customerId: o.customer_id, pickupAddress: o.pickup_address, deliveryAddress: o.delivery_address, originZone: o.origin_zone ?? '',
  destinationZone: o.destination_zone ?? '', pickupDate: o.pickup_date?.slice(0, 10) ?? '', deliveryDate: o.delivery_date?.slice(0, 10) ?? '',
  goodsDescription: o.goods_description ?? '', weightKg: o.weight_kg ?? '', pallets: o.pallets ?? '', distanceKm: o.distance_km ?? '',
  pricingBasis: o.pricing_basis ?? '', amountHt: o.pricing_basis ? '' : String(Number(o.amount_ht)),
  tvaRate: o.pricing_basis || !Number(o.amount_ht) ? '' : String(Math.round(Number(o.tax_amount) / Number(o.amount_ht) * 10000) / 100), notes: o.notes ?? '',
});

export default function TransportOrdersPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canEdit } = usePermissions();
  const editable = canEdit('sales');
  const { data: orders = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['transport-orders'], queryFn: transportOrdersApi.list });
  const { data: customersRaw } = useQuery({ queryKey: ['customers-min'], queryFn: () => customersApi.list(), enabled: editable });
  const { data: routes = [] } = useQuery({ queryKey: ['delivery-routes', 'open'], queryFn: () => deliveryRoutesApi.list(), enabled: editable });
  const customers = (Array.isArray(customersRaw) ? customersRaw : (customersRaw as { data?: unknown[] } | undefined)?.data ?? []) as
    { id: string; company_name: string | null; first_name: string | null; last_name: string | null }[];
  const openRoutes = routes.filter(r => r.status !== 'done');

  const [view, setView] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [planning, setPlanning] = useState<{ order: TransportOrder; routeId: string } | null>(null);
  const [delivering, setDelivering] = useState<{ order: TransportOrder; podName: string; podNote: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['transport-orders'] });
  const onError = (e: unknown) => notify.error(apiErrorMessage(e));
  const save = useMutation({
    mutationFn: (d: Draft) => (d.id ? transportOrdersApi.update(d.id, toInput(d)) : transportOrdersApi.create(toInput(d))),
    onSuccess: o => { setDraft(null); refresh(); notify.success(`Ordre ${o.number} enregistré · ${money(Number(o.total_ttc))} TTC`); }, onError,
  });
  const act = useMutation({
    mutationFn: (f: () => Promise<TransportOrder>) => f(),
    onSuccess: () => { setPlanning(null); setDelivering(null); refresh(); }, onError,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);
  const toInvoice = orders.filter(o => o.status === 'delivered' && !o.invoice_id).length;
  const shown = orders.filter(o => !view || (view === 'to_invoice' ? o.status === 'delivered' && !o.invoice_id : o.status === view));

  const menu = (o: TransportOrder): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (['draft', 'planned'].includes(o.status)) {
      items.push({ label: 'Modifier', icon: Pencil, onSelect: () => setDraft(fromOrder(o)) });
      items.push({ label: o.route_id ? 'Changer de tournée' : 'Planifier sur une tournée', icon: CalendarCheck, onSelect: () => setPlanning({ order: o, routeId: o.route_id ?? '' }) });
    }
    if (o.status === 'planned') items.push({ label: 'Marchandise enlevée', icon: PackageOpen, onSelect: () => act.mutate(() => transportOrdersApi.pickup(o.id)) });
    if (['planned', 'in_transit'].includes(o.status)) items.push({ label: 'Livré — preuve de livraison', icon: CheckCircle2, onSelect: () => setDelivering({ order: o, podName: '', podNote: '' }) });
    if (o.status === 'delivered' && !o.invoice_id) items.push({ label: 'Facturer', icon: Receipt, onSelect: () => act.mutate(() => transportOrdersApi.invoice(o.id)) });
    if (['draft', 'planned'].includes(o.status)) items.push({ label: 'Annuler', icon: XCircle, danger: true, onSelect: async () => {
      if (await confirm(`Annuler l'ordre ${o.number} ?`, { title: 'Annuler l\'ordre de transport', confirmLabel: 'Annuler l\'ordre', danger: true })) act.mutate(() => transportOrdersApi.cancel(o.id));
    } });
    return items;
  };

  const d = draft;
  const qtyMissing = d?.pricingBasis && !(Number(d.pricingBasis === 'weight' ? d.weightKg : d.pricingBasis === 'pallet' ? d.pallets : d.distanceKm) > 0);

  return (
    <SalesPageShell icon={Truck} title="Ordres de transport" parent="Ventes" list
      summary={`${orders.filter(o => !['delivered', 'cancelled'].includes(o.status)).length} en cours${toInvoice ? ` · ${toInvoice} à facturer` : ''}`}
      actions={editable && <button type="button" className="odoo-btn-primary" onClick={() => setDraft({ ...EMPTY })}><Plus size={14} /> Nouvel ordre</button>}>
      <FilterChips label="Filtrer les ordres" value={view} onChange={setView} chips={[
        { key: '', label: 'Tous', count: orders.length },
        { key: 'draft', label: 'Saisis', count: counts.draft ?? 0 },
        { key: 'planned', label: 'Planifiés', count: counts.planned ?? 0 },
        { key: 'in_transit', label: 'En cours', count: counts.in_transit ?? 0 },
        { key: 'to_invoice', label: 'À facturer', count: toInvoice, tone: toInvoice ? 'late' : undefined },
        { key: 'delivered', label: 'Livrés', count: counts.delivered ?? 0 },
      ]} />

      {isLoading ? <LoadingState label="Chargement des ordres de transport…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !orders.length ? (
        <EmptyState icon={Truck} title="Aucun ordre de transport" text="Saisissez la demande d'un client : adresses d'enlèvement et de livraison, marchandise ; le prix vient de la grille tarifaire." />
      ) : !shown.length ? <NoResultState onReset={() => setView('')} /> : (
        <DataPanel label="Ordres de transport" footer={<TableFooter note={`${shown.length} ordre${shown.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Client</th><th>Trajet</th><th>Enlèvement</th><th>Marchandise</th><th>Tournée</th><th className="ds-num">Prix TTC</th><th>Statut</th><th aria-label="Actions" /></tr></thead>
            <tbody>{shown.map(o => (
              <tr key={o.id}>
                <td className="ds-strong">{o.number}</td>
                <td>{o.customer_name}</td>
                <td>{first(o.pickup_address)} → {first(o.delivery_address)}</td>
                <td>{day(o.pickup_date)}</td>
                <td>{[o.goods_description, o.weight_kg && `${Number(o.weight_kg).toLocaleString('fr-FR')} kg`, o.pallets && `${Number(o.pallets)} pal.`].filter(Boolean).join(' · ') || '—'}</td>
                <td>{o.route_label ? `${o.route_label}${o.vehicle_label ? ` · ${o.vehicle_label}` : ''}` : '—'}</td>
                <td className="ds-num">{money(Number(o.total_ttc))}</td>
                <td>
                  <StatusTag tone={STATUS[o.status].tone} label={STATUS[o.status].label} />
                  {o.invoice_number && <div className="prj-note" style={{ margin: 0 }}>Facture {o.invoice_number}</div>}
                  {o.pod_name && <div className="prj-note" style={{ margin: 0 }}>Reçu par {o.pod_name}</div>}
                </td>
                <td className="ds-actions">{editable && menu(o).length > 0 && <RowMenu items={menu(o)} />}</td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}

      {d && (
        <Modal title={d.id ? 'Modifier l\'ordre de transport' : 'Nouvel ordre de transport'} onClose={() => setDraft(null)} width={680} locked={save.isPending}
          footer={<FormFooter onCancel={() => setDraft(null)} onSubmit={() => save.mutate(d)} submitLabel="Enregistrer" busy={save.isPending}
            disabled={!d.customerId || !d.pickupAddress.trim() || !d.deliveryAddress.trim() || !!qtyMissing} />}>
          <FormSection title="Demande">
            <FormField label="Client chargeur" required>
              <SearchSelect value={d.customerId} onChange={v => setDraft({ ...d, customerId: v })} placeholder="Client…" width="100%" size="md" ariaLabel="Client"
                options={customers.map(c => ({ id: String(c.id), label: c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() }))} />
            </FormField>
            <div className="ds-form-grid">
              <FormField label="Adresse d'enlèvement" htmlFor="to-pick" required>
                <textarea id="to-pick" className="ds-input" rows={2} value={d.pickupAddress} onChange={e => setDraft({ ...d, pickupAddress: e.target.value })} />
              </FormField>
              <FormField label="Adresse de livraison" htmlFor="to-del" required>
                <textarea id="to-del" className="ds-input" rows={2} value={d.deliveryAddress} onChange={e => setDraft({ ...d, deliveryAddress: e.target.value })} />
              </FormField>
              <FormField label="Zone de départ" htmlFor="to-oz"><input id="to-oz" className="ds-input" value={d.originZone} onChange={e => setDraft({ ...d, originZone: e.target.value })} /></FormField>
              <FormField label="Zone d'arrivée" htmlFor="to-dz"><input id="to-dz" className="ds-input" value={d.destinationZone} onChange={e => setDraft({ ...d, destinationZone: e.target.value })} /></FormField>
              <FormField label="Enlèvement le" htmlFor="to-pd"><input id="to-pd" type="date" className="ds-input" value={d.pickupDate} onChange={e => setDraft({ ...d, pickupDate: e.target.value })} /></FormField>
              <FormField label="Livraison prévue le" htmlFor="to-dd"><input id="to-dd" type="date" className="ds-input" value={d.deliveryDate} onChange={e => setDraft({ ...d, deliveryDate: e.target.value })} /></FormField>
            </div>
          </FormSection>
          <FormSection title="Marchandise">
            <FormField label="Description" htmlFor="to-goods"><input id="to-goods" className="ds-input" value={d.goodsDescription} onChange={e => setDraft({ ...d, goodsDescription: e.target.value })} /></FormField>
            <div className="ds-form-grid">
              <FormField label="Poids (kg)" htmlFor="to-w"><input id="to-w" type="number" min="0" step="0.001" className="ds-input" value={d.weightKg} onChange={e => setDraft({ ...d, weightKg: e.target.value })} /></FormField>
              <FormField label="Palettes" htmlFor="to-p"><input id="to-p" type="number" min="0" step="0.5" className="ds-input" value={d.pallets} onChange={e => setDraft({ ...d, pallets: e.target.value })} /></FormField>
              <FormField label="Distance (km)" htmlFor="to-km"><input id="to-km" type="number" min="0" step="0.1" className="ds-input" value={d.distanceKm} onChange={e => setDraft({ ...d, distanceKm: e.target.value })} /></FormField>
            </div>
          </FormSection>
          <FormSection title="Prix">
            <FormField label="Base de prix" htmlFor="to-basis" hint={d.pricingBasis ? 'Le prix est calculé par la grille tarifaire du client (ou la grille générale) pour ce trajet.' : 'Sans grille : saisissez le prix.'}>
              <select id="to-basis" className="ds-input" value={d.pricingBasis} onChange={e => setDraft({ ...d, pricingBasis: e.target.value as Draft['pricingBasis'] })}>
                {(Object.keys(BASIS) as PricingBasis[]).map(b => <option key={b} value={b}>Grille — {BASIS[b]}</option>)}
                <option value="">Prix saisi</option>
              </select>
            </FormField>
            {!d.pricingBasis && (
              <div className="ds-form-grid">
                <FormField label="Prix HT" htmlFor="to-ht"><input id="to-ht" type="number" min="0" step="0.01" className="ds-input" value={d.amountHt} onChange={e => setDraft({ ...d, amountHt: e.target.value })} /></FormField>
                <FormField label="TVA (%)" htmlFor="to-tva"><input id="to-tva" type="number" min="0" step="0.1" className="ds-input" value={d.tvaRate} onChange={e => setDraft({ ...d, tvaRate: e.target.value })} /></FormField>
              </div>
            )}
            {qtyMissing && <p className="prj-note">Renseignez la quantité de la base choisie ({BASIS[d.pricingBasis as PricingBasis]}).</p>}
          </FormSection>
        </Modal>
      )}

      {planning && (
        <Modal title={`Planifier ${planning.order.number}`} onClose={() => setPlanning(null)} width={480} locked={act.isPending}
          footer={<FormFooter onCancel={() => setPlanning(null)} submitLabel="Affecter" busy={act.isPending} disabled={!planning.routeId}
            onSubmit={() => act.mutate(() => transportOrdersApi.plan(planning.order.id, planning.routeId))} />}>
          <FormSection title="Tournée">
            {!openRoutes.length ? <p className="prj-note">Aucune tournée ouverte : créez-en une dans Ventes › Tournées.</p> : (
              <FormField label="Tournée (chauffeur et véhicule)" htmlFor="to-route" required>
                <select id="to-route" className="ds-input" value={planning.routeId} onChange={e => setPlanning({ ...planning, routeId: e.target.value })}>
                  <option value="">Choisir…</option>
                  {openRoutes.map(r => <option key={r.id} value={r.id}>{r.label} · {day(r.route_date)}{r.driver_name ? ` · ${r.driver_name}` : ''}{(r as { vehicle_label?: string | null }).vehicle_label ? ` · ${(r as { vehicle_label?: string | null }).vehicle_label}` : ''}</option>)}
                </select>
              </FormField>
            )}
          </FormSection>
        </Modal>
      )}

      {delivering && (
        <Modal title={`Livraison de ${delivering.order.number}`} onClose={() => setDelivering(null)} width={480} locked={act.isPending}
          footer={<FormFooter onCancel={() => setDelivering(null)} submitLabel="Confirmer la livraison" busy={act.isPending} disabled={!delivering.podName.trim()}
            onSubmit={() => act.mutate(() => transportOrdersApi.deliver(delivering.order.id, delivering.podName, delivering.podNote))} />}>
          <FormSection title="Preuve de livraison">
            <FormField label="Réceptionné par" htmlFor="to-pod" required>
              <input id="to-pod" className="ds-input" value={delivering.podName} onChange={e => setDelivering({ ...delivering, podName: e.target.value })} />
            </FormField>
            <FormField label="Réserves" htmlFor="to-podn">
              <textarea id="to-podn" className="ds-input" rows={2} value={delivering.podNote} onChange={e => setDelivering({ ...delivering, podNote: e.target.value })} />
            </FormField>
          </FormSection>
        </Modal>
      )}
    </SalesPageShell>
  );
}
