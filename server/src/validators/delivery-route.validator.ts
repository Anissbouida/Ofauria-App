import { z } from 'zod';
import { uuid } from './common.validator.js';
import { body, txt, bool } from './route-body.validator.js';

/**
 * G0-07 — Tournées de livraison (delivery-route.routes). delivery-route.controller garde ses
 * messages (libellé requis, statut connu, au moins un bon) ; types seulement.
 */
export const createDeliveryRouteSchema = body({ label: txt(200), routeDate: txt(40), driverName: txt(200), notes: txt(2000) });
export const deliveryRouteStatusSchema = body({ status: txt(30) });
export const deliveryRouteStopsSchema = body({ deliveryNoteIds: z.array(uuid).max(500).optional() });
export const deliveryRouteReorderSchema = body({ stopIds: z.array(uuid).max(500).optional() });
export const deliveryStopDeliveredSchema = body({ delivered: bool });
