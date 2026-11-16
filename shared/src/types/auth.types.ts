import type { Role } from '../constants/roles.js';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  storeId?: string | null;
  /** G0-06 : mot de passe antérieur à la politique — à changer avant toute autre action. */
  mustChangePassword?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: Omit<User, 'createdAt' | 'updatedAt'>;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: Role;
}
