export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  loyaltyPoints: number;
  totalSpent: number;
  notes?: string;
  createdAt: string;
}

export interface CreateCustomerRequest {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface UpdateCustomerRequest extends Partial<CreateCustomerRequest> {}
