import type { ShiftCode } from '../constants/shifts.js';

export interface Employee {
  id: string;
  userId?: string;
  firstName: string;
  lastName: string;
  role: string;
  phone?: string;
  hourlyRate?: number;
  hireDate: string;
  isActive: boolean;
  createdAt: string;
  defaultShiftCode?: ShiftCode | null;
}

export interface Shift {
  code: ShiftCode;
  label: string;
  startTime: string;
  endTime: string;
  isNight: boolean;
  displayOrder: number;
  isActive: boolean;
}

export interface Schedule {
  id: string;
  employeeId: string;
  employee?: Employee;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  shiftCode?: ShiftCode | null;
  notes?: string;
  createdAt: string;
}

export type LeaveStatus = 'approved' | 'pending';
export interface LeaveInfo {
  type: string;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
}

/**
 * Une ligne de la matrice hebdomadaire (cote API) : un employe et ses
 * assignations Lun -> Dim. `leaveDays` mappe YYYY-MM-DD -> infos conge
 * (type, statut, periode). `onLeaveDays` est conservé pour rétrocompat.
 */
export interface WeekScheduleRow {
  employeeId: string;
  firstName: string;
  lastName: string;
  role: string;
  defaultShiftCode: ShiftCode | null;
  /** Map YYYY-MM-DD -> ShiftCode (jour non liste = repos) */
  assignments: Record<string, ShiftCode | null>;
  /** Liste des YYYY-MM-DD ou l'employe est en conge (approved + pending) */
  onLeaveDays: string[];
  /** Detail par jour : type de conge, statut, periode globale */
  leaveDays: Record<string, LeaveInfo>;
}

export interface WeekScheduleResponse {
  weekStart: string;
  weekEnd: string;
  rows: WeekScheduleRow[];
}

export interface WeekScheduleAssignment {
  employeeId: string;
  date: string;
  shiftCode: ShiftCode | null;
}

export interface BulkWeekScheduleRequest {
  weekStart: string;
  assignments: WeekScheduleAssignment[];
}

export interface CreateEmployeeRequest {
  userId?: string;
  firstName: string;
  lastName: string;
  role: string;
  phone?: string;
  hourlyRate?: number;
  hireDate: string;
}

export interface CreateScheduleRequest {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes?: number;
  notes?: string;
}
