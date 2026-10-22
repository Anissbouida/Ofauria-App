import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { storeRepository, type StoreInput } from '../repositories/store.repository.js';

const KINDS = ['shop', 'workshop', 'warehouse', 'office', 'mixed'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = { mon: 'lundi', tue: 'mardi', wed: 'mercredi', thu: 'jeudi', fri: 'vendredi', sat: 'samedi', sun: 'dimanche' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Contrôle et normalisation des champs d'un établissement (mig 331). Retourne un message d'erreur ou les champs. */
function readStore(body: Record<string, unknown>): StoreInput | string {
  const out: StoreInput = {};
  const text = (k: keyof StoreInput, max: number) => {
    const v = body[k];
    if (v === undefined) return;
    (out as Record<string, unknown>)[k] = v === null ? null : String(v).trim().slice(0, max) || null;
  };
  if (body.name !== undefined) {
    const n = String(body.name ?? '').trim();
    if (!n) return 'Nom requis';
    out.name = n.slice(0, 100);
  }
  text('city', 100); text('address', 300); text('phone', 40);
  if (body.isActive !== undefined) out.isActive = !!body.isActive;
  if (body.code !== undefined) {
    const c = body.code === null ? '' : String(body.code).trim().toUpperCase();
    if (c && !/^[A-Z0-9]{2,10}$/.test(c)) return 'Code : 2 à 10 lettres ou chiffres';
    out.code = c || null;
  }
  if (body.kind !== undefined) {
    if (!KINDS.includes(String(body.kind))) return 'Type d\'établissement inconnu';
    out.kind = String(body.kind);
  }
  if (body.managerUserId !== undefined) out.managerUserId = body.managerUserId ? String(body.managerUserId) : null;
  if (body.email !== undefined) {
    const e = body.email ? String(body.email).trim() : '';
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'E-mail invalide';
    out.email = e || null;
  }
  if (body.patente !== undefined) {
    const p = body.patente ? String(body.patente).replace(/\s/g, '') : '';
    if (p && !/^\d{1,15}$/.test(p)) return 'Patente : chiffres uniquement';
    out.patente = p || null;
  }
  if (body.openingHours !== undefined) {
    const h = body.openingHours;
    if (h !== null) {
      if (typeof h !== 'object' || Array.isArray(h)) return 'Horaires invalides';
      for (const [day, v] of Object.entries(h as Record<string, unknown>)) {
        if (!DAYS.includes(day)) return `Jour inconnu : ${day}`;
        const d = v as { closed?: boolean; open?: string; close?: string };
        if (d.closed) continue;
        if (!HHMM.test(String(d.open)) || !HHMM.test(String(d.close))) return `Horaires du ${DAY_LABELS[day]} : format HH:MM attendu`;
        if (String(d.open) >= String(d.close)) return `Horaires du ${DAY_LABELS[day]} : l'ouverture doit précéder la fermeture`;
      }
    }
    out.openingHours = h as Record<string, unknown> | null;
  }
  if (body.isHeadquarters !== undefined) out.isHeadquarters = !!body.isHeadquarters;
  return out;
}

function conflict(err: unknown, res: Response): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === '23505' && e.constraint === 'uq_stores_code') {
    res.status(409).json({ success: false, error: { message: 'Ce code est déjà utilisé par un autre établissement' } });
    return true;
  }
  if (e?.code === '23503') {
    res.status(400).json({ success: false, error: { message: 'Responsable inconnu' } });
    return true;
  }
  return false;
}

export const storeController = {
  async list(_req: AuthRequest, res: Response) {
    const stores = await storeRepository.findAll();
    res.json({ success: true, data: stores });
  },

  async getById(req: AuthRequest, res: Response) {
    const store = await storeRepository.findById(req.params.id);
    if (!store) { res.status(404).json({ success: false, error: { message: 'Point de vente non trouve' } }); return; }
    res.json({ success: true, data: store });
  },

  async create(req: AuthRequest, res: Response) {
    const data = readStore(req.body ?? {});
    if (typeof data === 'string') { res.status(400).json({ success: false, error: { message: data } }); return; }
    if (!data.name) { res.status(400).json({ success: false, error: { message: 'Nom requis' } }); return; }
    try {
      const store = await storeRepository.create({ ...data, name: data.name }, req.user?.userId);
      res.status(201).json({ success: true, data: store });
    } catch (err) {
      if (!conflict(err, res)) throw err;
    }
  },

  async update(req: AuthRequest, res: Response) {
    const data = readStore(req.body ?? {});
    if (typeof data === 'string') { res.status(400).json({ success: false, error: { message: data } }); return; }
    try {
      const store = await storeRepository.update(req.params.id, data, req.user?.userId);
      if (!store) { res.status(404).json({ success: false, error: { message: 'Point de vente non trouve' } }); return; }
      res.json({ success: true, data: store });
    } catch (err) {
      if (!conflict(err, res)) throw err;
    }
  },

  async remove(req: AuthRequest, res: Response) {
    await storeRepository.remove(req.params.id, req.user?.userId);
    res.json({ success: true, data: null });
  },
};
