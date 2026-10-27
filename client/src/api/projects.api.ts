import api from './client';

/** Projets (mig 358) : projets, tâches, temps passé. */
export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'critical';
export type BillingType = 'none' | 'fixed' | 'time';

export type Project = {
  id: string; number: string; name: string; description: string | null; store_id: string | null;
  customer_id: string | null; customer_label: string | null; order_id: string | null; order_number: string | null;
  status: ProjectStatus; priority: Priority; start_date: string | null; due_date: string | null; completed_at: string | null;
  manager_id: string | null; manager_name: string | null; billing_type: BillingType; hourly_rate: string | null;
  budget_amount: string | null; estimated_hours: string | null; notes: string | null;
  created_by_name: string | null; created_at: string; updated_at: string;
  hours_spent: string; cost_spent: string; billable_amount: string; unbilled_amount: string; unbilled_hours: string;
  task_count: number; task_done: number; task_late: number; is_overdue: boolean;
  tasks?: Task[];
};
export type Task = {
  id: string; project_id: string; parent_task_id: string | null; title: string; description: string | null;
  status: TaskStatus; priority: Priority; assignee_id: string | null; assignee_name: string | null; assignee_role: string | null;
  start_date: string | null; due_date: string | null; estimated_hours: string | null; display_order: number;
  completed_at: string | null; hours_spent: string; is_overdue: boolean; project_number?: string; project_name?: string;
};
export type TimeEntry = {
  id: string; project_id: string; project_number: string; project_name: string; task_id: string | null; task_title: string | null;
  employee_id: string; employee_name: string; employee_role: string | null; work_date: string; hours: string;
  activity_code: string | null; activity_label: string | null; note: string | null; billable: boolean;
  cost_rate: string; billing_rate: string; cost: string; amount: string; invoice_id: string | null; created_at: string;
};
export type Person = { id: string; name: string; role: string | null; user_id: string | null; cost_rate: string };

export type ProjectInput = {
  name: string; description?: string | null; customerId?: string | null; orderId?: string | null; priority?: Priority;
  startDate?: string | null; dueDate?: string | null; managerId?: string | null; billingType?: BillingType;
  hourlyRate?: number | null; budgetAmount?: number | null; estimatedHours?: number | null; notes?: string | null;
};
export type TaskInput = {
  title: string; description?: string | null; parentTaskId?: string | null; priority?: Priority; assigneeId?: string | null;
  startDate?: string | null; dueDate?: string | null; estimatedHours?: number | null; displayOrder?: number; status?: TaskStatus;
};
export type TimeInput = {
  projectId: string; taskId?: string | null; employeeId: string; workDate: string; hours: number;
  activityCode?: string | null; note?: string | null; billable?: boolean; billingRate?: number | null;
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Brouillon', active: 'En cours', on_hold: 'En pause', completed: 'Terminé', cancelled: 'Annulé',
};
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { todo: 'À faire', in_progress: 'En cours', done: 'Fait', cancelled: 'Annulée' };
export const PRIORITY_LABELS: Record<Priority, string> = { critical: 'Critique', high: 'Haute', normal: 'Normale', low: 'Basse' };
export const BILLING_LABELS: Record<BillingType, string> = { none: 'Non facturé / inclus', fixed: 'Forfait', time: 'Au temps passé' };

export const projectsApi = {
  list: (params: Record<string, string>): Promise<{ rows: Project[]; total: number; byStatus: Record<string, { count: number; overdue: number }> }> =>
    api.get('/projects', { params }).then(r => r.data.data),
  overview: (params: Record<string, string>): Promise<{
    projects: { active: number; on_hold: number; draft: number; overdue: number };
    time: { hours: string; cost: string; amount: string; unbilled: string };
    tasks: { open: number; overdue: number };
    active: Project[];
  }> => api.get('/projects/overview', { params }).then(r => r.data.data),
  people: (): Promise<Person[]> => api.get('/projects/people').then(r => r.data.data),
  openTasks: (params: Record<string, string> = {}): Promise<Task[]> => api.get('/projects/tasks/open', { params }).then(r => r.data.data),
  get: (id: string): Promise<Project & { tasks: Task[] }> => api.get(`/projects/${id}`).then(r => r.data.data),
  create: (data: ProjectInput): Promise<Project> => api.post('/projects', data).then(r => r.data.data),
  update: (id: string, data: Partial<ProjectInput>): Promise<Project> => api.patch(`/projects/${id}`, data).then(r => r.data.data),
  setStatus: (id: string, status: ProjectStatus): Promise<Project> => api.post(`/projects/${id}/status`, { status }).then(r => r.data.data),
  createTask: (projectId: string, data: TaskInput): Promise<Task> => api.post(`/projects/${projectId}/tasks`, data).then(r => r.data.data),
  updateTask: (taskId: string, data: Partial<TaskInput>): Promise<Task> => api.patch(`/projects/tasks/${taskId}`, data).then(r => r.data.data),
  deleteTask: (taskId: string) => api.delete(`/projects/tasks/${taskId}`).then(r => r.data.data),
  listTime: (params: Record<string, string>): Promise<{ rows: TimeEntry[]; total: number; hours: string; cost: string; amount: string; page: number; pageSize: number }> =>
    api.get('/projects/time/entries', { params }).then(r => r.data.data),
  addTime: (data: TimeInput): Promise<TimeEntry> => api.post('/projects/time/entries', data).then(r => r.data.data),
  deleteTime: (id: string) => api.delete(`/projects/time/entries/${id}`).then(r => r.data.data),
};
