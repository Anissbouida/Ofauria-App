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
}

export interface Schedule {
  id: string;
  employeeId: string;
  employee?: Employee;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  notes?: string;
  createdAt: string;
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
