import type { Response } from 'express';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { recipeRepository } from '../repositories/recipe.repository.js';
import { restoreRecipeVersion, RecipeRestoreError } from '../repositories/recipe-restore.helper.js';

import { recipeFicheRepository } from '../repositories/recipe-fiche.repository.js';
import { generateRecipeFichePdf, type FicheFormat } from '../services/recipe-fiche-pdf.service.js';
import { db } from '../config/database.js';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : parseFloat(String(v)) || 0);
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : (Number.isFinite(parseFloat(String(v))) ? parseFloat(String(v)) : null);

/** Logo du PDF : data URI persiste en base (FS ephemere en prod), sinon fichier. */
async function resolveLogo(): Promise<string | undefined> {
  const settings = await db.query('SELECT logo_url FROM company_settings WHERE id = 1').catch(() => null);
  const logoUrl = settings?.rows?.[0]?.logo_url as string | undefined;
  if (logoUrl?.startsWith('data:')) return logoUrl;

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const candidates = [
    logoUrl ? resolve(projectRoot, 'uploads', logoUrl) : '',
    logoUrl ? resolve(projectRoot, logoUrl) : '',
    resolve(projectRoot, 'client', 'public', 'images', 'logo-horizontal.png'),
  ].filter(Boolean);
  return candidates.find(c => existsSync(c));
}

export const recipeController = {
  async list(req: AuthRequest, res: Response) {
    // ?archived=1 → vue « Archivées » (fiches retirées des listes, restaurables).
    const recipes = await recipeRepository.findAll(req.query.archived === '1');
    res.json({ success: true, data: recipes });
  },
  async getById(req: AuthRequest, res: Response) {
    const recipe = await recipeRepository.findById(req.params.id);
    if (!recipe) { res.status(404).json({ success: false, error: { message: 'Recette non trouvée' } }); return; }
    res.json({ success: true, data: recipe });
  },
  async getExplosion(req: AuthRequest, res: Response) {
    const data = await recipeRepository.getExplosion(req.params.id as string);
    res.json({ success: true, data });
  },
  async getByProductId(req: AuthRequest, res: Response) {
    const recipe = await recipeRepository.findByProductId(req.params.productId);
    if (!recipe) { res.status(404).json({ success: false, error: { message: 'Aucune recette pour ce produit' } }); return; }
    res.json({ success: true, data: recipe });
  },
  async baseRecipes(_req: AuthRequest, res: Response) {
    const recipes = await recipeRepository.findBaseRecipes();
    res.json({ success: true, data: recipes });
  },
  async listCategories(_req: AuthRequest, res: Response) {
    const categories = await recipeRepository.listCategories();
    res.json({ success: true, data: categories });
  },
  async create(req: AuthRequest, res: Response) {
    try {
      const recipe = await recipeRepository.create(req.body);
      res.status(201).json({ success: true, data: recipe });
    } catch (err: any) {
      if (err.message?.includes('circulaire')) {
        res.status(400).json({ success: false, error: { message: err.message } });
        return;
      }
      if (err?.code === 'PIECE_WEIGHT_REQUIRED') {
        res.status(422).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
  },
  async update(req: AuthRequest, res: Response) {
    try {
      const recipe = await recipeRepository.update(req.params.id, {
        ...req.body,
        changedBy: req.user?.userId,
      });
      if (!recipe) { res.status(404).json({ success: false, error: { message: 'Recette non trouvée' } }); return; }
      res.json({ success: true, data: recipe });
    } catch (err: any) {
      if (err.message?.includes('circulaire')) {
        res.status(400).json({ success: false, error: { message: err.message } });
        return;
      }
      if (err?.code === 'PIECE_WEIGHT_REQUIRED') {
        res.status(422).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
  },
  async versions(req: AuthRequest, res: Response) {
    const versions = await recipeRepository.findVersions(req.params.id);
    res.json({ success: true, data: versions });
  },
  // POST /recipes/:id/versions/:versionNumber/restore — re-applique la capture
  // complete d'une version (mig 346), apres avoir verse l'etat courant en version.
  async restoreVersion(req: AuthRequest, res: Response) {
    const versionNumber = parseInt(req.params.versionNumber, 10);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      res.status(400).json({ success: false, error: { message: 'Numero de version invalide' } });
      return;
    }
    try {
      const result = await restoreRecipeVersion(req.params.id, versionNumber, req.user?.userId ?? null);
      const recipe = await recipeRepository.findById(req.params.id);
      res.json({ success: true, data: recipe, restore: result });
    } catch (err) {
      if (err instanceof RecipeRestoreError) {
        const status = err.code === 'VERSION_NOT_FOUND' ? 404 : 409;
        res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
  },
  // DELETE /recipes/:id ARCHIVE la fiche (mig 346) : plus de suppression physique,
  // l'historique de production la reference encore. Restaurable.
  async remove(req: AuthRequest, res: Response) {
    const result = await recipeRepository.archive([req.params.id], req.user?.userId ?? null);
    res.json({ success: true, data: result });
  },
  async restore(req: AuthRequest, res: Response) {
    const result = await recipeRepository.restore([req.params.id]);
    res.json({ success: true, data: result });
  },
  async bulkArchive(req: AuthRequest, res: Response) {
    const result = await recipeRepository.archive(req.body.ids as string[], req.user?.userId ?? null);
    res.json({ success: true, data: result });
  },
  async bulkRestore(req: AuthRequest, res: Response) {
    const result = await recipeRepository.restore(req.body.ids as string[]);
    res.json({ success: true, data: result });
  },
  async bulkRemove(req: AuthRequest, res: Response) {
    const { ids } = req.body as { ids: string[] };
    const result = await recipeRepository.bulkDelete(ids);
    res.json({ success: true, data: result });
  },

  // ─── Remplacement de composant en masse A→B, annulable (mig 401) — lot 6 ───
  async bulkReplacePreview(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.sourceIngredientId || !b.targetIngredientId) { res.status(400).json({ success: false, error: { message: 'Ingrédient source et cible requis' } }); return; }
    if (b.sourceIngredientId === b.targetIngredientId) { res.status(400).json({ success: false, error: { message: 'La source et la cible doivent être différentes' } }); return; }
    const data = await recipeRepository.previewBulkReplace(String(b.sourceIngredientId), String(b.targetIngredientId));
    res.json({ success: true, data });
  },
  async bulkReplaceApply(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.sourceIngredientId || !b.targetIngredientId) { res.status(400).json({ success: false, error: { message: 'Ingrédient source et cible requis' } }); return; }
    const data = await recipeRepository.applyBulkReplace(String(b.sourceIngredientId), String(b.targetIngredientId), req.user!.userId);
    res.json({ success: true, data });
  },
  async bulkReplaceRevert(req: AuthRequest, res: Response) {
    const result = await recipeRepository.revertBulkReplace(req.params.logId as string, req.user!.userId);
    if (!result.ok) {
      const msg = result.reason === 'already_reverted' ? 'Remplacement déjà annulé' : 'Journal introuvable';
      res.status(result.reason === 'already_reverted' ? 409 : 404).json({ success: false, error: { message: msg } });
      return;
    }
    res.json({ success: true, data: result });
  },
  async bulkReplaceLogs(_req: AuthRequest, res: Response) {
    const data = await recipeRepository.listBulkReplaceLogs();
    res.json({ success: true, data });
  },

  /**
   * Fiche technique imprimable (PDF A4).
   *
   * Le cout par format vient de deux vues selon le mode :
   *   - compose     : v_recipe_compose_cost donne le cout du LANCEMENT complet
   *                   (le cadre entier) — on divise par nb_par_defaut pour la piece ;
   *   - ratio_poids : v_recipe_format_cost donne deja le cout a la piece — on
   *                   remultiplie pour afficher le lancement.
   * Sans ca, un cadre a 70 pieces et un moule a 1 piece seraient lus sur la
   * meme colonne avec deux significations differentes.
   */
  async downloadFiche(req: AuthRequest, res: Response) {
    try {
      // ?format=<uuid> : la fiche du SEUL cadre selectionne dans l'editeur de
      // nomenclature. Sans le parametre, on imprime tous les formats actifs.
      const rawFormat = typeof req.query.format === 'string' ? req.query.format.trim() : '';
      const formatId = /^[0-9a-f-]{36}$/i.test(rawFormat) ? rawFormat : null;

      const data = await recipeFicheRepository.findForFiche(req.params.id, formatId);
      if (!data) {
        res.status(404).json({ success: false, error: { message: 'Recette non trouvée' } });
        return;
      }
      const r = data.recipe;
      const isCompose = r.mode_cout === 'compose';

      const formats: FicheFormat[] = data.formats.map((f) => {
        const nbPieces = Math.max(1, Number(f.nb_par_defaut) || 1);
        const coutLancement = isCompose
          ? numOrNull(f.cout_compose_dh)
          : (numOrNull(f.cout_matiere_unitaire) !== null
              ? num(f.cout_matiere_unitaire) * nbPieces
              : numOrNull(f.cout_matiere_format));
        const coutPiece = isCompose
          ? (coutLancement !== null ? coutLancement / nbPieces : null)
          : numOrNull(f.cout_matiere_unitaire);

        // En mode compose, v_recipe_format_cost calcule quand meme un cout
        // complet et un prix — mais au prorata du POIDS, ce qui n'a pas de sens
        // pour un assemblage (on afficherait un cout complet inferieur au cout
        // matiere). On laisse donc la colonne vide et on reconstruit le prix
        // comme le fait la liste des fiches : cout/piece x multiplicateur.
        const marge = numOrNull(f.margin_multiplier_override) ?? numOrNull(r.margin_multiplier) ?? 0;
        const prixVente = isCompose
          ? (numOrNull(f.prix_vente_unitaire_override)
              ?? (coutPiece !== null && marge > 0 ? coutPiece * marge : null))
          : numOrNull(f.prix_vente_unitaire);

        return {
          contenantNom: (f.contenant_nom as string) || null,
          isDefault: Boolean(f.is_default),
          nbParDefaut: Number(f.nb_par_defaut) || 1,
          nbParts: f.nb_parts === null ? null : Number(f.nb_parts),
          quantiteParFormat: num(f.quantite_par_format),
          quantiteParFormatUnite: (f.quantite_par_format_unite as string) || 'g',
          coutFormatDh: coutLancement,
          coutUnitaireDh: coutPiece,
          coutCompletUnitaireDh: isCompose ? null : numOrNull(f.cout_unitaire_complet),
          prixVenteUnitaireDh: prixVente,
          components: data.components
            .filter(c => c.format_id === f.id)
            .map(c => ({
              role: (c.role as string) || null,
              sourceName: (c.source_name as string) || '—',
              sourceType: c.source_type as 'recipe' | 'ingredient',
              quantite: num(c.quantite),
              unite: (c.unite as string) || 'g',
              pertePct: num(c.perte_pct),
              coutDh: numOrNull(c.cout_dh),
              // NULL = pas de ligne dans la vue : on ne crie pas au faux positif.
              conversionOk: c.conversion_ok !== false,
            })),
        };
      });

      const etapesRaw = Array.isArray(r.etapes) ? (r.etapes as Record<string, unknown>[]) : [];

      const buffer = await generateRecipeFichePdf({
        name: r.name as string,
        categoryLabel: (r.category_label as string) || null,
        isBase: Boolean(r.is_base),
        modeCout: (r.mode_cout as string) || 'ratio_poids',
        yieldQuantity: num(r.yield_quantity),
        yieldUnit: (r.yield_unit as string) || 'unit',
        perteStandardPct: num(r.perte_standard_pct),
        totalCostDh: numOrNull(r.total_cost),
        productName: (r.product_name as string) || null,
        instructions: (r.instructions as string) || null,
        ingredients: data.ingredients.map(i => ({
          name: i.name as string,
          quantity: num(i.quantity),
          unit: (i.unit as string) || 'g',
          coutDh: numOrNull(i.cout_dh),
        })),
        formats,
        scopedToFormat: formatId !== null,
        // Les lignes arrivent a plat (une par ingredient de base) : on regroupe
        // par preparation en preservant l'ordre alphabetique de la requete.
        bases: (() => {
          const byId = new Map<string, {
            name: string; yieldQuantity: number; yieldUnit: string;
            perteStandardPct: number; coutFourneeDh: number | null;
            besoinNet: number | null; facteur: number | null;
            ingredients: Array<{ name: string; quantity: number; unit: string; coutDh: number | null }>;
          }>();
          for (const row of data.bases) {
            const id = String(row.base_id);
            if (!byId.has(id)) {
              const brut = num(row.yield_quantity);
              const perte = num(row.perte_standard_pct);
              const net = brut * (1 - perte / 100);
              const besoin = numOrNull(row.besoin_net);
              // Combien de fournees standard couvrent le besoin du format. On
              // divise par le rendement NET : c'est ce qui sort utilisable, donc
              // ce qui se compare a la quantite reclamee par la nomenclature.
              const facteur = besoin !== null && net > 0 ? besoin / net : null;
              byId.set(id, {
                name: row.base_name as string,
                yieldQuantity: brut,
                yieldUnit: (row.yield_unit as string) || 'unit',
                perteStandardPct: perte,
                coutFourneeDh: numOrNull(row.base_cost),
                besoinNet: besoin,
                facteur,
                ingredients: [],
              });
            }
            // LEFT JOIN : une base sans composition remonte une ligne a nom nul.
            if (row.ingredient_name) {
              byId.get(id)!.ingredients.push({
                name: row.ingredient_name as string,
                quantity: num(row.quantity),
                unit: (row.unit as string) || 'g',
                coutDh: numOrNull(row.cout_dh),
              });
            }
          }
          return [...byId.values()];
        })(),
        etapes: etapesRaw.map((e, idx) => ({
          ordre: Number(e.ordre) || idx + 1,
          nom: (e.nom as string) || `Étape ${idx + 1}`,
          dureeMin: e.duree_estimee_min == null ? null : Number(e.duree_estimee_min),
          controleQualite: Boolean(e.controle_qualite),
          checklist: Array.isArray(e.checklist_items) ? (e.checklist_items as string[]) : [],
          // Darija : la fiche Masterclass est bilingue, le labo lit souvent la
          // colonne arabe. Absente sur les fiches non traduites, d'ou le null.
          nomAr: (e.nom_ar as string) || null,
          checklistAr: Array.isArray(e.checklist_items_ar) ? (e.checklist_items_ar as string[]) : [],
        })),
        editedAt: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        logoPath: await resolveLogo(),
      });

      const filename = `Fiche technique - ${r.name}.pdf`.replace(/[/\\]/g, '-');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('Erreur génération fiche technique PDF:', err);
      res.status(500).json({ success: false, error: { message: 'Erreur lors de la génération de la fiche' } });
    }
  },
};
