import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details: Record<string, string[]> = {};
        for (const issue of err.issues) {
          const key = issue.path.join('.');
          if (!details[key]) details[key] = [];
          details[key].push(issue.message);
        }
        res.status(400).json({
          success: false,
          error: { message: 'Données invalides', details },
        });
        return;
      }
      next(err);
    }
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refuse en 400 tout paramètre de route qui n'est pas un UUID (sinon Postgres répond 500). */
export function validateUuidParams(...names: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const name of names) {
      const v = req.params[name];
      if (typeof v !== 'string' || !UUID_RE.test(v)) {
        res.status(400).json({ success: false, error: { message: `Paramètre ${name} invalide` } });
        return;
      }
    }
    next();
  };
}

/** Valide et normalise req.query (coercitions zod incluses). */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: 'Paramètres invalides', details: parsed.error.issues.map(i => i.message) } });
      return;
    }
    (req as any).validatedQuery = parsed.data;
    next();
  };
}
