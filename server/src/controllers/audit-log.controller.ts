import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max = 100): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}
function page(q: AuthRequest['query']) {
  const limit = Math.min(Math.max(parseInt(String(q.limit ?? '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(q.offset ?? '0'), 10) || 0, 0);
  return { limit, offset };
}
function dateParam(v: unknown) {
  const s = str(v, 10);
  return s && DATE_RE.test(s) ? s : undefined;
}
function uuidParam(v: unknown) {
  const s = str(v, 36);
  return s && UUID_RE.test(s) ? s : undefined;
}

export const auditLogController = {
  /** Journal des modifications du paramétrage (mig 328) + référentiel. */
  async list(req: AuthRequest, res: Response) {
    const q = req.query;
    const result = await auditLogRepository.list({
      table: str(q.table, 60),
      changedBy: uuidParam(q.changedBy),
      subjectId: str(q.subjectId, 60),
      from: dateParam(q.from),
      to: dateParam(q.to),
      q: str(q.q),
      ...page(q),
    });
    res.json({ success: true, data: result });
  },

  async tables(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await auditLogRepository.tables() });
  },

  /** Connexions, échecs, verrouillages, créations de comptes (auth_events). */
  async authEvents(req: AuthRequest, res: Response) {
    const q = req.query;
    const success = q.success === 'true' ? true : q.success === 'false' ? false : undefined;
    const result = await auditLogRepository.authEvents({
      eventType: str(q.eventType, 40),
      userId: uuidParam(q.userId),
      success,
      from: dateParam(q.from),
      to: dateParam(q.to),
      ...page(q),
    });
    res.json({ success: true, data: result });
  },
};
