import { emptyBody } from './common.validator.js';

/**
 * G0-07 — Envois de fichiers (upload.routes : logo, photos de perte / réclamation). Le fichier
 * est lu par multer et contrôlé par le service de stockage ; aucun champ du formulaire n'est lu.
 */
export const uploadFileSchema = emptyBody;
