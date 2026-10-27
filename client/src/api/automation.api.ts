import api from './client';

/** E-mails et tâches planifiées (mig 364). */
export type MailStatus = {
  mode: 'smtp' | 'log' | 'off'; configured: boolean; enabled: boolean; fromAddress: string | null; host: string | null;
  settings: { enabled: boolean; from_name: string | null; reply_to: string | null; footer: string | null };
  counts: { queued: number; failed: number; sent_30d: number };
};
export type OutboxMessage = {
  id: string; to_email: string; to_name: string | null; subject: string; type: string | null; type_label: string | null; reference_type: string | null;
  status: 'queued' | 'sent' | 'failed' | 'cancelled'; attempts: number; last_error: string | null; next_attempt_at: string; sent_at: string | null; created_at: string;
};
export type JobRun = { id: string; job_key: string; started_at: string; finished_at: string | null; status: 'running' | 'ok' | 'error'; items: number; message: string | null; trigger: 'auto' | 'manual' | 'external' };
export type ScheduledJob = {
  key: string; label: string; description: string | null; domain: string; enabled: boolean; interval_minutes: number;
  next_run_at: string; last_run_at: string | null; last_status: 'ok' | 'error' | null; last_message: string | null; last_duration_ms: number | null;
  implemented: boolean; runs: JobRun[];
};
export type JobsPayload = { jobs: ScheduledJob[]; engine: { internal: boolean; externalConfigured: boolean; lastExternalTick: string | null; lastInternalTick: string | null } };

export const automationApi = {
  mail: (): Promise<MailStatus> => api.get('/automation/mail').then(r => r.data.data),
  saveMail: (data: { enabled?: boolean; fromName?: string | null; replyTo?: string | null; footer?: string | null }) => api.put('/automation/mail', data).then(r => r.data.data),
  testMail: (to: string) => api.post('/automation/mail/test', { to }).then(r => r.data.data),
  outbox: (status?: string): Promise<OutboxMessage[]> => api.get('/automation/mail/outbox', { params: status ? { status } : {} }).then(r => r.data.data),
  outboxAction: (id: string, action: 'retry' | 'cancel') => api.post(`/automation/mail/outbox/${id}/${action}`).then(r => r.data),
  jobs: (): Promise<JobsPayload> => api.get('/automation/jobs').then(r => r.data.data),
  updateJob: (key: string, data: { enabled?: boolean; intervalMinutes?: number }) => api.patch(`/automation/jobs/${key}`, data).then(r => r.data.data),
  runJob: (key: string): Promise<{ status: 'ok' | 'error'; items: number; message: string; durationMs: number }> =>
    api.post(`/automation/jobs/${key}/run`).then(r => r.data.data),
};
