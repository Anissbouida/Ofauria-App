import { currencySymbol } from '../../utils/money';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileSpreadsheet, Upload, AlertTriangle, Check, Loader2, Download,
} from 'lucide-react';
import { Alert, DataPanel, FormField, FormFooter, FormSection, KpiCard, KpiGrid, Modal } from '../../components/ds';
import { recipesApi } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

interface PreviewRow {
  sourceRow: number;
  name: string;
  isBase: boolean;
  productName: string | null;
  yieldQuantity: number;
  yieldUnit: string;
  marginMultiplier: number | null;
  ingredientsCount: number;
  subRecipesCount: number;
  packagingCount: number;
  changes?: string[];
}

interface MissingIngredient {
  name: string;
  unit: string;
  firstRow: number;
}

interface MissingProduct {
  name: string;
  firstRow: number;
}

interface PreviewData {
  summary: {
    totalRows: number; toCreate: number; toUpdate: number;
    unchanged: number; errors: number;
    ingredientsToCreate: number; productsToCreate: number;
  };
  toCreate: PreviewRow[];
  toUpdate: PreviewRow[];
  ingredientsToCreate: MissingIngredient[];
  productsToCreate: MissingProduct[];
  errors: { sheet: string; sourceRow: number; message: string }[];
  warnings: string[];
}

interface CommitResult {
  created: number;
  updated: number;
  unchanged: number;
  ingredientsCreated: number;
  productsCreated: number;
  warnings: string[];
  errors: { row: number; sheet?: string; message: string }[];
}

export default function RecipeImportModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const qc = useQueryClient();

  const previewMut = useMutation({
    mutationFn: (f: File) => recipesApi.importPreview(f),
    onSuccess: (data: PreviewData) => setPreview(data),
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur d\'analyse du fichier')),
  });

  const commitMut = useMutation({
    mutationFn: (f: File) => recipesApi.importCommit(f),
    onSuccess: (data: CommitResult) => {
      setResult(data);
      const parts: string[] = [];
      if (data.created) parts.push(`${data.created} cree(s)`);
      if (data.updated) parts.push(`${data.updated} mise(s) a jour`);
      if (data.ingredientsCreated) parts.push(`${data.ingredientsCreated} ingredient(s) auto-créé(s)`);
      if (data.productsCreated) parts.push(`${data.productsCreated} produit(s) auto-créé(s)`);
      notify.success(`Import termine — ${parts.join(', ') || 'aucun changement'}`);
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur lors de l\'import')),
  });

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(null);
    setResult(null);
  }

  function onAnalyze() {
    if (!file) return;
    previewMut.mutate(file);
  }

  function onConfirm() {
    if (!file) return;
    commitMut.mutate(file);
  }

  const busy = previewMut.isPending || commitMut.isPending;
  const blockCommit = preview ? preview.errors.length > 0 : true;
  const nothingToDo = preview && preview.summary.toCreate === 0 && preview.summary.toUpdate === 0;

  const footer = result
    ? <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
    : preview
      ? <FormFooter onCancel={onClose} submitLabel="Confirmer et importer" busy={commitMut.isPending}
          disabled={busy || blockCommit || !!nothingToDo} onSubmit={onConfirm} />
      : <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>;

  return (
    <Modal title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><FileSpreadsheet size={18} aria-hidden="true" /> Importer des recettes (Excel)</span>}
      onClose={onClose} width={896} locked={busy} footer={footer}>
          {!result && (
            <>
              <FormSection title="Fichier">
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <FormField label="Classeur Excel (.xlsx)" htmlFor="recipe-import-file" required>
                      <input id="recipe-import-file" type="file" accept=".xlsx" onChange={onFileChange} className="text-sm" />
                    </FormField>
                  </div>
                  {file && (
                    <button type="button" onClick={onAnalyze} disabled={busy} className="odoo-btn-secondary">
                      {previewMut.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
                      Analyser
                    </button>
                  )}
                  <button type="button" onClick={() => recipesApi.downloadTemplate()} className="ds-btn-ghost ds-btn-sm" title="Télécharger un modèle Excel vide">
                    <Download size={13} aria-hidden="true" /> Modèle vide
                  </button>
                </div>
              </FormSection>

              <Alert tone="info">
                <div className="text-xs space-y-1">
                  <p className="font-medium">Structure attendue (4 feuilles) :</p>
                  <p><strong>Recettes</strong> : Nom | Base? (oui/non) | Produit | Rendement | Unité | Marge | Instructions</p>
                  <p><strong>Ingrédients</strong> : Recette | Ingrédient | Quantité | Unité</p>
                  <p><strong>Sous-recettes</strong> : Recette | Sous-recette | Quantité</p>
                  <p><strong>Emballages</strong> : Recette | Emballage | Quantité | Unité</p>
                  <p className="pt-1">
                    Les recettes existantes (meme nom) seront mises à jour, les nouvelles créées.
                    Les <strong>ingrédients</strong> et <strong>produits</strong> absents seront <strong>auto-crees</strong>
                    (coût/prix = 0) — a compléter après. Les unités non standards (ex: "cadre") sont acceptees.
                    Les <strong>emballages</strong> doivent déjà exister.
                  </p>
                </div>
              </Alert>
            </>
          )}

          {/* Preview */}
          {preview && !result && (
            <div className="space-y-4">
              <KpiGrid label="Résumé de l'analyse">
                <KpiCard label="Total recettes" value={String(preview.summary.totalRows)} />
                <KpiCard label="À créer" value={String(preview.summary.toCreate)} />
                <KpiCard label="À mettre à jour" value={String(preview.summary.toUpdate)} />
                <KpiCard label="Inchangées" value={String(preview.summary.unchanged)} />
                <KpiCard label="Ingrédients auto-créés" value={String(preview.summary.ingredientsToCreate)} />
                <KpiCard label="Produits auto-créés" value={String(preview.summary.productsToCreate)} />
              </KpiGrid>

              {preview.ingredientsToCreate.length > 0 && (
                <details open>
                  <summary className="ds-subhead" style={{ cursor: 'pointer', marginBottom: 8 }}>
                    Ingrédients absents de l'économat ({preview.ingredientsToCreate.length}) — seront auto-crees
                  </summary>
                  <p className="ds-field-hint" style={{ marginBottom: 8 }}>
                    Coût = 0 {currencySymbol()}, catégorie = "autre", unité = celle du fichier.
                    A compléter après dans l'économat.
                  </p>
                  <DataPanel label="Ingrédients à créer" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    <table className="odoo-table ds-dense">
                      <thead><tr><th>Nom</th><th>Unité</th><th className="ds-num">1re apparition (ligne)</th></tr></thead>
                      <tbody>
                        {preview.ingredientsToCreate.map((ing, i) => (
                          <tr key={i}>
                            <td className="ds-strong">{ing.name}</td>
                            <td>{ing.unit}</td>
                            <td className="ds-num">{ing.firstRow}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </DataPanel>
                </details>
              )}

              {preview.productsToCreate.length > 0 && (
                <details open>
                  <summary className="ds-subhead" style={{ cursor: 'pointer', marginBottom: 8 }}>
                    Produits absents du catalogue ({preview.productsToCreate.length}) — seront auto-crees
                  </summary>
                  <p className="ds-field-hint" style={{ marginBottom: 8 }}>
                    Prix = 0 {currencySymbol()}, catégorie par defaut, marque disponible.
                    A compléter après dans le catalogue produits.
                  </p>
                  <DataPanel label="Produits à créer" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    <table className="odoo-table ds-dense">
                      <thead><tr><th>Nom du produit</th><th className="ds-num">1re apparition (ligne Recettes)</th></tr></thead>
                      <tbody>
                        {preview.productsToCreate.map((p, i) => (
                          <tr key={i}>
                            <td className="ds-strong">{p.name}</td>
                            <td className="ds-num">{p.firstRow}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </DataPanel>
                </details>
              )}

              {preview.errors.length > 0 && (
                <Alert tone="danger" icon={AlertTriangle}>
                  <strong>{preview.errors.length} erreur(s) bloquante(s) — corrigez le fichier</strong>
                  <ul className="text-xs space-y-1 max-h-40 overflow-y-auto mt-1">
                    {preview.errors.map((e, i) => (
                      <li key={i}>[{e.sheet}] Ligne {e.sourceRow} : {e.message}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              {preview.warnings.length > 0 && (
                <details>
                  <summary className="ds-subhead" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--ds-warning)' }} />
                    {preview.warnings.length} avertissement(s)
                  </summary>
                  <ul className="p-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                    {preview.warnings.map((w, i) => <li key={i}>- {w}</li>)}
                  </ul>
                </details>
              )}

              {preview.toCreate.length > 0 && (
                <details open>
                  <summary className="ds-subhead" style={{ cursor: 'pointer', marginBottom: 8 }}>
                    A creer ({preview.toCreate.length})
                  </summary>
                  <PreviewTable rows={preview.toCreate} kind="create" />
                </details>
              )}

              {preview.toUpdate.length > 0 && (
                <details>
                  <summary className="ds-subhead" style={{ cursor: 'pointer', marginBottom: 8 }}>
                    A mettre a jour ({preview.toUpdate.length})
                  </summary>
                  <PreviewTable rows={preview.toUpdate} kind="update" />
                </details>
              )}

              {nothingToDo && (
                <Alert tone="info">Rien à importer — toutes les recettes du fichier correspondent déjà aux données actuelles.</Alert>
              )}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <Alert tone="success" icon={Check}>
                <strong>Import termine</strong>
                <div className="text-sm mt-1">
                  {result.created} créée(s), {result.updated} mise(s) a jour, {result.unchanged} inchangee(s)
                </div>
                {result.ingredientsCreated > 0 && (
                  <div className="text-sm mt-1">
                    {result.ingredientsCreated} ingrédient(s) auto-créé(s) — compléter les coûts dans l'économat.
                  </div>
                )}
                {result.productsCreated > 0 && (
                  <div className="text-sm mt-1">
                    {result.productsCreated} produit(s) auto-créé(s) — compléter les prix dans le catalogue.
                  </div>
                )}
              </Alert>

              {result.errors.length > 0 && (
                <Alert tone="danger" icon={AlertTriangle}>
                  <strong>Erreurs ({result.errors.length})</strong>
                  <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto mt-1">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e.sheet ? `[${e.sheet}] ` : ''}Ligne {e.row} : {e.message}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          )}
    </Modal>
  );
}

function PreviewTable({ rows, kind }: { rows: PreviewRow[]; kind: 'create' | 'update' }) {
  const visible = rows.slice(0, 200);
  return (
    <DataPanel label={kind === 'create' ? 'Recettes à créer' : 'Recettes à mettre à jour'}
      footer={rows.length > visible.length ? <div className="ds-foot"><span>… et {rows.length - visible.length} autre(s) ligne(s) — toutes seront traitees a l'import.</span></div> : undefined}>
      <table className="odoo-table ds-dense">
        <thead>
          <tr>
            <th className="ds-num">Ligne</th>
            <th>Nom</th>
            <th>Type</th>
            <th>Produit</th>
            <th className="ds-num">Rendement</th>
            <th className="ds-num">Ingrédients</th>
            <th className="ds-num">Sous-recettes</th>
            <th className="ds-num">Emballages</th>
            {kind === 'update' && <th>Champs modifiés</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <tr key={r.sourceRow}>
              <td className="ds-num">{r.sourceRow}</td>
              <td className="ds-strong">{r.name}</td>
              <td><span className={`odoo-tag ${r.isBase ? 'odoo-tag-purple' : 'odoo-tag-green'}`}>{r.isBase ? 'Base' : 'Produit'}</span></td>
              <td>{r.productName || '-'}</td>
              <td className="ds-num">{r.yieldQuantity} {r.yieldUnit}</td>
              <td className="ds-num">{r.ingredientsCount}</td>
              <td className="ds-num">{r.subRecipesCount}</td>
              <td className="ds-num">{r.packagingCount}</td>
              {kind === 'update' && (
                <td>
                  {r.changes && r.changes.length > 0
                    ? r.changes.map(c => <span key={c} className="odoo-tag odoo-tag-orange" style={{ marginRight: 4 }}>{c}</span>)
                    : '-'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );
}
