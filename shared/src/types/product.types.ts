export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  displayOrder: number;
  createdAt: string;
}

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
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {}
