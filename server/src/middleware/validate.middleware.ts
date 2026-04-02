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
