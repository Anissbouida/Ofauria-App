import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileSpreadsheet, Upload, X, AlertTriangle, Check, Loader2, ArrowRight, Download,
} from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';

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

interface PreviewData {
  summary: {
    totalRows: number; toCreate: number; toUpdate: number;
    unchanged: number; errors: number; ingredientsToCreate: number;
  };
  toCreate: PreviewRow[];
  toUpdate: PreviewRow[];
  ingredientsToCreate: MissingIngredient[];
  errors: { sheet: string; sourceRow: number; message: string }[];
  warnings: string[];
}

interface CommitResult {
  created: number;
  updated: number;
  unchanged: number;
  ingredientsCreated: number;
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
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur d\'analyse du fichier');
    },
  });

  const commitMut = useMutation({
    mutationFn: (f: File) => recipesApi.importCommit(f),
    onSuccess: (data: CommitResult) => {
      setResult(data);
      const parts: string[] = [];
      if (data.created) parts.push(`${data.created} cree(s)`);
      if (data.updated) parts.push(`${data.updated} mise(s) a jour`);
      if (data.ingredientsCreated) parts.push(`${data.ingredientsCreated} ingredient(s) auto-cree(s)`);
      notify.success(`Import termine — ${parts.join(', ') || 'aucun changement'}`);
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'import');
    },
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold">Importer des recettes (Excel)</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!result && (
            <>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded border">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={onFileChange}
                  className="text-sm"
                />
                {file && (
                  <button
                    onClick={onAnalyze}
                    disabled={busy}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 text-sm"
                  >
                    {previewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Analyser
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => recipesApi.downloadTemplate()}
                  className="ml-auto flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                  title="Telecharger un modele Excel vide"
                >
                  <Download className="w-3 h-3" /> Modele vide
                </button>
              </div>

              <div className="text-xs text-gray-600 space-y-1 p-3 bg-blue-50 border border-blue-200 rounded">
                <p className="font-medium text-blue-900">Structure attendue (4 feuilles) :</p>
                <p><strong>Recettes</strong> : Nom | Base? (oui/non) | Produit | Rendement | Unite | Marge | Instructions</p>
                <p><strong>Ingredients</strong> : Recette | Ingredient | Quantite | Unite</p>
                <p><strong>Sous-recettes</strong> : Recette | Sous-recette | Quantite</p>
                <p><strong>Emballages</strong> : Recette | Emballage | Quantite | Unite</p>
                <p className="text-blue-700 pt-1">
                  Les recettes existantes (meme nom) seront mises a jour, les nouvelles creees.
                  Les <strong>ingredients absents</strong> de l'economat seront <strong>auto-crees</strong>
                  (cout 0, categorie "autre") — a completer apres dans l'economat.
                  Les <strong>produits</strong> et <strong>emballages</strong> doivent deja exister.
                </p>
              </div>
            </>
          )}

          {/* Preview */}
          {preview && !result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Kpi label="Total recettes" value={String(preview.summary.totalRows)} />
                <Kpi label="A creer" value={String(preview.summary.toCreate)} tone="emerald" />
                <Kpi label="A mettre a jour" value={String(preview.summary.toUpdate)} tone="amber" />
                <Kpi label="Inchangees" value={String(preview.summary.unchanged)} tone="gray" />
                <Kpi label="Ing. auto-crees" value={String(preview.summary.ingredientsToCreate)} tone="blue" />
              </div>

              {preview.ingredientsToCreate.length > 0 && (
                <details className="border border-blue-200 rounded" open>
                  <summary className="p-2 bg-blue-50 cursor-pointer text-sm font-medium text-blue-900">
                    Ingredients absents de l'economat ({preview.ingredientsToCreate.length}) — seront auto-crees
                  </summary>
                  <div className="p-2 bg-white text-xs">
                    <p className="text-blue-800 mb-2">
                      Cout = 0 DH, categorie = "autre", unite = celle du fichier.
                      A completer apres dans l'economat.
                    </p>
                    <div className="overflow-x-auto max-h-48 overflow-y-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="p-1.5 text-left">Nom</th>
                            <th className="p-1.5 text-left">Unite</th>
                            <th className="p-1.5 text-left">1re apparition (ligne)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.ingredientsToCreate.map((ing, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-1.5 font-medium">{ing.name}</td>
                              <td className="p-1.5">{ing.unit}</td>
                              <td className="p-1.5 text-gray-500">{ing.firstRow}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              )}

              {preview.errors.length > 0 && (
                <div className="border border-red-200 rounded">
                  <div className="p-2 bg-red-50 text-sm flex items-center gap-2 text-red-900 font-medium">
                    <AlertTriangle className="w-4 h-4" /> {preview.errors.length} erreur(s) bloquante(s) — corrigez le fichier
                  </div>
                  <ul className="p-2 text-xs space-y-1 max-h-40 overflow-y-auto bg-white">
                    {preview.errors.map((e, i) => (
                      <li key={i} className="text-red-800">
                        [{e.sheet}] Ligne {e.sourceRow} : {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <details className="border border-amber-200 rounded">
                  <summary className="p-2 bg-amber-50 cursor-pointer text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    {preview.warnings.length} avertissement(s)
                  </summary>
                  <ul className="p-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                    {preview.warnings.map((w, i) => <li key={i} className="text-amber-900">- {w}</li>)}
                  </ul>
                </details>
              )}

              {preview.toCreate.length > 0 && (
                <details className="border border-emerald-200 rounded" open>
                  <summary className="p-2 bg-emerald-50 cursor-pointer text-sm font-medium text-emerald-900">
                    A creer ({preview.toCreate.length})
                  </summary>
                  <PreviewTable rows={preview.toCreate} kind="create" />
                </details>
              )}

              {preview.toUpdate.length > 0 && (
                <details className="border border-amber-200 rounded">
                  <summary className="p-2 bg-amber-50 cursor-pointer text-sm font-medium text-amber-900">
                    A mettre a jour ({preview.toUpdate.length})
                  </summary>
                  <PreviewTable rows={preview.toUpdate} kind="update" />
                </details>
              )}

              {nothingToDo && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900">
                  Rien a importer — toutes les recettes du fichier correspondent deja aux donnees actuelles.
                </div>
              )}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 border border-green-200 rounded flex items-start gap-3">
                <Check className="w-6 h-6 text-green-600 flex-shrink-0" />
                <div>
                  <div className="font-semibold text-green-900">Import termine</div>
                  <div className="text-sm text-green-800 mt-1">
                    {result.created} creee(s), {result.updated} mise(s) a jour, {result.unchanged} inchangee(s)
                  </div>
                  {result.ingredientsCreated > 0 && (
                    <div className="text-sm text-blue-800 mt-1">
                      {result.ingredientsCreated} ingredient(s) auto-cree(s) — completer les couts dans l'economat.
                    </div>
                  )}
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <div className="font-medium text-red-900 mb-1">Erreurs ({result.errors.length})</div>
                  <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-red-800">
                        {e.sheet ? `[${e.sheet}] ` : ''}Ligne {e.row} : {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {preview && !result && (
            <button
              onClick={onConfirm}
              disabled={busy || blockCommit || !!nothingToDo}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 text-sm"
            >
              {commitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Confirmer et importer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'gray' | 'blue' }) {
  const color =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber' ? 'text-amber-700' :
    tone === 'blue' ? 'text-blue-700' :
    tone === 'gray' ? 'text-gray-500' : 'text-gray-900';
  return (
    <div className="p-3 bg-white border rounded">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-base font-semibold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

function PreviewTable({ rows, kind }: { rows: PreviewRow[]; kind: 'create' | 'update' }) {
  const visible = rows.slice(0, 200);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-1.5 text-left">Ligne</th>
            <th className="p-1.5 text-left">Nom</th>
            <th className="p-1.5 text-left">Type</th>
            <th className="p-1.5 text-left">Produit</th>
            <th className="p-1.5 text-right">Rendement</th>
            <th className="p-1.5 text-center">Ing.</th>
            <th className="p-1.5 text-center">Sous-rec.</th>
            <th className="p-1.5 text-center">Embal.</th>
            {kind === 'update' && <th className="p-1.5 text-left">Champs modifies</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <tr key={r.sourceRow} className="border-t">
              <td className="p-1.5 text-gray-500">{r.sourceRow}</td>
              <td className="p-1.5 font-medium">{r.name}</td>
              <td className="p-1.5">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${r.isBase ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>
                  {r.isBase ? 'Base' : 'Produit'}
                </span>
              </td>
              <td className="p-1.5 text-gray-600">{r.productName || '-'}</td>
              <td className="p-1.5 text-right">{r.yieldQuantity} {r.yieldUnit}</td>
              <td className="p-1.5 text-center">{r.ingredientsCount}</td>
              <td className="p-1.5 text-center">{r.subRecipesCount}</td>
              <td className="p-1.5 text-center">{r.packagingCount}</td>
              {kind === 'update' && (
                <td className="p-1.5">
                  {r.changes && r.changes.length > 0
                    ? r.changes.map(c => (
                        <span key={c} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">
                          {c}
                        </span>
                      ))
                    : '-'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > visible.length && (
        <div className="p-2 text-xs text-gray-500">
          ... et {rows.length - visible.length} autre(s) ligne(s) — toutes seront traitees a l'import.
        </div>
      )}
    </div>
  );
}
