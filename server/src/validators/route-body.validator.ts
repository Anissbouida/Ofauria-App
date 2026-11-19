import { z } from 'zod';

/**
 * G0-07 (plan pilote 2026-11) — briques des schémas « Importantes » et « Secondaires ».
 *
 * Ces routes avaient déjà, pour la plupart, leurs contrôles détaillés dans le contrôleur
 * (messages métier, listes de valeurs, existence en base). Les schémas ajoutés ici ne
 * reprennent que les TYPES et les bornes évidentes ; aucune règle métier nouvelle.
 *  - tout objet est en .passthrough() : validate() remplace req.body par la sortie du schéma
 *    et aucun champ envoyé par le client ne doit disparaître ;
 *  - un corps absent (route sans analyseur JSON, POST sans corps) vaut {} ;
 *  - une chaîne vide ou null vaut « absent » pour les nombres facultatifs.
 */
const blankToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

/** Corps objet (absent = {}), champs non déclarés conservés. */
export const body = <T extends z.ZodRawShape>(shape: T) =>
  z.preprocess(v => v ?? {}, z.object(shape).passthrough());

/** Objet imbriqué, champs non déclarés conservés. */
export const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

/** Texte requis, non vide après trim, borné. */
export const reqText = (max: number, msg = 'Champ requis') => z.string().trim().min(1, msg).max(max);
/** Texte facultatif (null accepté), borné. Pas de trim : le contrôleur décide. */
export const txt = (max: number) => z.string().max(max).nullish();

/** Nombre fini facultatif (texte numérique accepté ; vide / null = absent). */
export const optNum = z.preprocess(blankToUndef, z.coerce.number().finite('Nombre invalide').optional());
/** Nombre fini facultatif qui conserve null (le contrôleur distingue null « effacer » d'absent). */
export const nullableNum = z.preprocess(v => (v === '' ? null : v), z.union([z.null(), z.coerce.number().finite('Nombre invalide')]).optional());
/** Nombre fini requis (texte numérique accepté). */
export const num = z.coerce.number().finite('Nombre invalide');
/** Entier facultatif. */
export const optInt = z.preprocess(blankToUndef, z.coerce.number().int('Entier attendu').optional());

/** Nombre ou texte numérique laissé TEL QUEL (le contrôleur convertit et contrôle lui-même) :
 *  vide et null acceptés, tout texte non numérique refusé. */
export const numish = z.union([
  z.number().finite('Nombre invalide'),
  z.string().max(40).refine(v => v.trim() === '' || Number.isFinite(Number(v)), 'Nombre invalide'),
]).nullish();

/** Booléen facultatif (null accepté). */
export const bool = z.boolean().nullish();
/** Booléen envoyé par un formulaire multipart (« true » / « false ») ou en JSON. */
export const formBool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on', 'off', ''])]).optional();

/** Liste de chaînes. */
export const strList = (max = 1000) => z.array(z.string()).max(max);

/** Valeur quelconque (JSON libre que le contrôleur ou le service vérifie lui-même). */
export const any = z.unknown().optional();
