import api from './client';

export interface RecallSale {
  saleItemId: string;
  saleId: string;
  saleNumber: string | null;
  createdAt: string;
  quantity: number;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  storeId: string | null;
  storeName: string | null;
  cashierName: string | null;
  approximate: boolean;
}

export interface RecallBatch {
  productLotId: string;
  productId: string;
  productName: string;
  lotNumber: string;
  producedAt: string;
  expiresAt: string | null;
  displayExpiresAt: string | null;
  status: string;
  quantityTotal: number;
  states: {
    sold: number;
    backroom: number;
    vitrine: number;
    wasted: number;
    recycled: number;
  };
  linkedSoldQty: number;
  sales: RecallSale[];
  approximateSales: RecallSale[];
  recycledInto: RecallNode[];
}

export interface RecallPlan {
  productionPlanId: string;
  planDate: string | null;
  planStatus: string | null;
  planType: string | null;
  ingredientName: string;
  quantityUsed: number;
  batches: RecallBatch[];
}

export interface RecallNode {
  ingredientLot: {
    id: string;
    lotNumber: string;
    supplierLotNumber: string | null;
    ingredientName: string | null;
    supplierName: string | null;
    expirationDate: string | null;
    receivedAt: string | null;
    status: string;
    quantityReceived: number;
  };
  recycled: boolean;
  sourceProductLotId: string | null;
  plans: RecallPlan[];
}

export interface RecallResult {
  root: RecallNode;
  summary: {
    totalPlans: number;
    totalBatches: number;
    soldQty: number;
    inStockQty: number;
    wastedQty: number;
    recycledQty: number;
    tracedSalesCount: number;
    approximateSalesCount: number;
    customersToContact: number;
    anonymousSalesCount: number;
  };
  generatedAt: string;
}

export interface IngredientLotLite {
  id: string;
  lot_number: string;
  supplier_lot_number: string | null;
  ingredient_name?: string;
  supplier_name?: string;
  expiration_date: string | null;
  received_at: string | null;
  status: string;
}

export const recallApi = {
  /**
   * Lots matière sélectionnables (réutilise la liste des lots d'ingrédients).
   * On récupère une page large SANS paramètre `search` et on filtre côté client :
   *  - le `search` serveur plante sur un bug pré-existant de findAll (sa requête
   *    COUNT référence l'alias suppliers `s` sans le JOIN) ;
   *  - et le filtre client couvre aussi le n° de lot interne, que l'API ignore.
   */
  lots: (): Promise<IngredientLotLite[]> =>
    api
      .get('/ingredient-lots', { params: { limit: '1000' } })
      .then(r => r.data.data),

  /** Arbre d'impact d'un rappel à partir d'un lot matière. */
  recall: (lotId: string): Promise<RecallResult> =>
    api.get(`/traceability/recall/ingredient-lot/${lotId}`).then(r => r.data.data),
};
