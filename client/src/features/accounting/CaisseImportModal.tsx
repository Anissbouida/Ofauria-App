import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload, X, AlertTriangle, Check, Loader2, ArrowRight } from 'lucide-react';
import { caisseImportApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface PreviewData {
  meta: { year: number; month: number; importSource: string };
  summary: {
    nbOperations: number; nbRecettes: number;
    totalExpenses: number; totalIncomeOps: number;
    totalRecettesCash: number; totalRecettesCard: number;
  };
  suppliers: {
    existingCount: number;
    toCreate: { key: string; name: string; kind: 'real' | 'personnel' }[];
  };
  alreadyImported: number;
  warnings: string[];
  sample: {
    sourceRow: number; date: string; supplier: string; supplierKind: 'real' | 'personnel';
    designation: string; type: 'expense' | 'income'; amount: number;
  }[];
}

interface CommitResult {
  meta: { year: number; month: number; importSource: string };
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
  newSuppliers: string[];
  warnings: string[];
}

function fmt(n: number) { return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function CaisseImportModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const qc = useQueryClient();

  const previewMut = useMutation({
    mutationFn: (f: File) => caisseImportApi.preview(f),
    onSuccess: (data: PreviewData) => setPreview(data),
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur d\'analyse du fichier');
    },
  });

  const commitMut = useMutation({
    mutationFn: (f: File) => caisseImportApi.commit(f),
    onSuccess: (data: CommitResult) => {
      setResult(data);
      notify.success(`Import réussi : ${data.created} ligne(s) créée(s)`);
      qc.invalidateQueries({ queryKey: ['caisse-register'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold">Importer un journal de caisse Excel</h2>
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
              </div>

              <p className="text-xs text-gray-500">
                Format attendu : 7 colonnes (DATE, TYPE, N°, FOURNISSEUR, DÉSIGNATION, ENTRÉE, SORTIE).
                Les lignes déjà importées (même fichier) seront ignorées automatiquement.
              </p>
            </>
          )}

          {/* Preview */}
          {preview && !result && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                <div className="font-medium text-emerald-900">
                  Mois détecté : {MONTHS[preview.meta.month - 1]} {preview.meta.year}
                </div>
                <div className="text-xs text-emerald-700 mt-1">
                  Source : <code>{preview.meta.importSource}</code>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Opérations" value={String(preview.summary.nbOperations)} />
                <Kpi label="Recettes (jours)" value={String(preview.summary.nbRecettes)} />
                <Kpi label="Total dépenses" value={fmt(preview.summary.totalExpenses) + ' DH'} />
                <Kpi label="Total recettes" value={fmt(preview.summary.totalRecettesCash + preview.summary.totalRecettesCard) + ' DH'} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2 bg-gray-50 rounded">Recettes espèces : <b>{fmt(preview.summary.totalRecettesCash)} DH</b></div>
                <div className="p-2 bg-gray-50 rounded">Recettes carte : <b>{fmt(preview.summary.totalRecettesCard)} DH</b></div>
              </div>

              {preview.alreadyImported > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                  ℹ️ {preview.alreadyImported} ligne(s) déjà importée(s) pour ce mois — elles seront ignorées à l'import.
                </div>
              )}

              {preview.suppliers.toCreate.length > 0 && (
                <div className="border rounded p-3">
                  <div className="font-medium mb-2 text-sm">Fournisseurs à créer ({preview.suppliers.toCreate.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.suppliers.toCreate.map(s => (
                      <span
                        key={s.key}
                        className={`text-xs px-2 py-0.5 rounded ${s.kind === 'personnel' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <details className="border border-amber-200 rounded">
                  <summary className="p-2 bg-amber-50 cursor-pointer text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    {preview.warnings.length} avertissement(s)
                  </summary>
                  <ul className="p-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                    {preview.warnings.map((w, i) => <li key={i} className="text-amber-900">• {w}</li>)}
                  </ul>
                </details>
              )}

              <details className="border rounded">
                <summary className="p-2 bg-gray-50 cursor-pointer text-sm">
                  Aperçu (50 premières opérations)
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-1.5 text-left">Date</th>
                        <th className="p-1.5 text-left">Fournisseur</th>
                        <th className="p-1.5 text-left">Désignation</th>
                        <th className="p-1.5 text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map(r => (
                        <tr key={r.sourceRow} className="border-t">
                          <td className="p-1.5">{r.date}</td>
                          <td className="p-1.5">
                            <span className={r.supplierKind === 'personnel' ? 'text-blue-700' : 'text-purple-700'}>
                              {r.supplier}
                            </span>
                          </td>
                          <td className="p-1.5">{r.designation}</td>
                          <td className={`p-1.5 text-right ${r.type === 'expense' ? 'text-red-700' : 'text-green-700'}`}>
                            {r.type === 'expense' ? '-' : '+'}{fmt(r.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 border border-green-200 rounded flex items-start gap-3">
                <Check className="w-6 h-6 text-green-600 flex-shrink-0" />
                <div>
                  <div className="font-semibold text-green-900">Import terminé</div>
                  <div className="text-sm text-green-800 mt-1">
                    {result.created} ligne(s) créée(s), {result.skipped} ignorée(s) (déjà importées)
                  </div>
                </div>
              </div>

              {result.newSuppliers.length > 0 && (
                <div className="p-3 border rounded text-sm">
                  <div className="font-medium mb-1">Nouveaux fournisseurs créés</div>
                  <div className="text-gray-700">{result.newSuppliers.join(', ')}</div>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <div className="font-medium text-red-900 mb-1">Erreurs ({result.errors.length})</div>
                  <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-red-800">Ligne {e.row} : {e.message}</li>
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
              disabled={busy}
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-white border rounded">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}
