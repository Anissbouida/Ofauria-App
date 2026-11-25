import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, Building, Building2, CircleUser, ClipboardList, Factory, HardHat, HeartHandshake, Hospital, Landmark,
  Package, ShieldCheck, ShoppingCart, Sprout, Store, Truck, User, Users, type LucideIcon,
} from 'lucide-react';
import { customerTypeBehaviors, orderTypeBehaviors, type CustomerTypeBehaviors, type OrderTypeBehaviors } from '@ofauria/shared';
import api from '../api/client';

/**
 * Types de client et types de commande (mig 701) : référentiels pilotés par le secteur.
 * Les écrans lisent ici la liste proposée et les COMPORTEMENTS de chaque valeur ; ils ne
 * comparent plus un code (« particulier », « staff »…).
 *
 * Les fonctions pures (isAccountType, isLegalEntityType…) lisent un cache de module, rempli
 * par le hook : un composant qui les utilise doit appeler useCommercialTypes() pour se
 * redessiner à l'arrivée des données. Avant, ou pour un type inconnu, la règle historique
 * s'applique (tout sauf « particulier » est en compte).
 */
export interface CommercialType {
  code: string; label: string; description: string | null; icon: string | null; color: string | null;
  display_order: number; is_active: boolean; metadata: Record<string, unknown> | null;
}
type Payload = { customerTypes: CommercialType[]; orderTypes: CommercialType[] };

const ICONS: Record<string, LucideIcon> = {
  Briefcase, Building, Building2, CircleUser, ClipboardList, Factory, HardHat, HeartHandshake, Hospital, Landmark,
  Package, ShieldCheck, ShoppingCart, Sprout, Store, Truck, User, Users,
};
export const refIcon = (name: string | null | undefined, fallback: LucideIcon = ClipboardList): LucideIcon => (name && ICONS[name]) || fallback;
export const REF_ICON_NAMES = Object.keys(ICONS);

/** Couleur d'une valeur (hexadécimale, éditable dans le Référentiel) ; bleu par défaut. */
export const refColor = (color: string | null | undefined) => (color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#2563eb');

let customerCache: Record<string, CommercialType> = {};
let orderCache: Record<string, CommercialType> = {};
/** Libellé du type d'une commande (orders.order_kind) ; null si la commande n'en porte pas. */
export const orderKindLabel = (code: string | null | undefined) => (code ? orderCache[code]?.label ?? null : null);

export const customerBehaviors = (code: string | null | undefined): CustomerTypeBehaviors =>
  customerTypeBehaviors(customerCache[code || 'particulier']?.metadata, code || 'particulier');
/** Client en compte (prix HT, BL, facture) plutôt que réglé au comptant. */
export const isAccountType = (code: unknown) => customerBehaviors(code as string | null).settlement === 'compte';
export const isLegalEntityType = (code: unknown) => customerBehaviors(code as string | null).legal_entity;
export const customerTypeLabel = (code: string | null | undefined) => customerCache[code || 'particulier']?.label ?? (code || '—');
export const customerTypeIcon = (code: string | null | undefined) =>
  refIcon(customerCache[code || 'particulier']?.icon, isLegalEntityType(code) ? Building2 : User);

/** Type de commande implicite d'une société qui n'en a défini aucun : une commande client simple. */
const IMPLICIT_ORDER_TYPE: CommercialType = {
  code: '', label: 'Commande client', description: null, icon: 'ClipboardList', color: '#2563eb', display_order: 0, is_active: true,
  metadata: { party: 'customer', settlement: 'any', auto_discount: 'none', direction_only: false },
};

export function useCommercialTypes(enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ['commercial-types'],
    queryFn: () => api.get('/params/commercial-types').then(r => r.data.data as Payload),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  return useMemo(() => {
    const allCustomer = data?.customerTypes ?? [];
    customerCache = Object.fromEntries(allCustomer.map(t => [t.code, t]));
    const allOrder = data?.orderTypes ?? [];
    orderCache = Object.fromEntries(allOrder.map(t => [t.code, t]));
    const activeOrder = allOrder.filter(t => t.is_active);
    return {
      isLoading,
      /** Types de client proposés (actifs). `withCurrent` ajoute le type d'une fiche ancienne. */
      customerTypes: (withCurrent?: string | null) => allCustomer.filter(t => t.is_active || t.code === withCurrent),
      /** Types de commande proposés. Aucun défini : un type implicite, sans étape de choix. */
      orderTypes: data && !activeOrder.length ? [IMPLICIT_ORDER_TYPE] : activeOrder,
      orderType: (code: string | null | undefined) => allOrder.find(t => t.code === code) ?? null,
      orderBehaviors: (t: CommercialType | null | undefined): OrderTypeBehaviors => orderTypeBehaviors(t?.metadata),
    };
  }, [data, isLoading]);
}
