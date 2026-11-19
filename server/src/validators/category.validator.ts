import { z } from 'zod';
import { body, txt, numish } from './route-body.validator.js';

/**
 * G0-07 — Catégories de produits (categories.routes ; identifiant entier). category.controller
 * calcule le slug à partir du nom : le nom doit être un texte à la création (sinon erreur 500).
 */
const fields = { description: txt(2000), displayOrder: numish, family: txt(120) };
export const createCategorySchema = body({ ...fields, name: z.string().trim().min(1, 'Nom requis').max(200) });
export const updateCategorySchema = body({ ...fields, name: z.string().trim().min(1, 'Nom requis').max(200).optional() });
