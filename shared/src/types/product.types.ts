export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  displayOrder: number;
  createdAt: string;
}

export type SaleUnit = 'unit' | 'weight';

export interface Product {
  id: string;
  name: string;
  slug: string;
  categoryId: number;
  category?: Category;
  description?: string;
  price: number;
  costPrice?: number;
  imageUrl?: string;
  isAvailable: boolean;
  isCustomOrderable: boolean;
  preparationTimeMin?: number;
  // 'unit' = vendu à la pièce (quantity = nb de pièces).
  // 'weight' = vendu au poids ; le caissier saisit le poids en grammes,
  // le subtotal = poids_g / 1000 * price_per_kg.
  saleUnit: SaleUnit;
  pricePerKg?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductRequest {
  name: string;
  categoryId: number;
  description?: string;
  price: number;
  costPrice?: number;
  isAvailable?: boolean;
  isCustomOrderable?: boolean;
  preparationTimeMin?: number;
  saleUnit?: SaleUnit;
  pricePerKg?: number;
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {}
