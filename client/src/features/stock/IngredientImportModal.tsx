import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, AlertTriangle, Check, Loader2, Download } from 'lucide-react';
import { Modal, FormSection, FormField, FormFooter, KpiGrid, KpiCard, Alert, DataPanel } from '../../components/ds';
import { ingredientsApi } from '../../api/inventory.api';
import { notify } from '../../components/ui/InlineNotification';
import { currencySymbol } from '../../utils/money';

interface PreviewRow {
  sourceRow: number;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  supplier: string | null;
  allergens: string[];
  changes?: string[];
}

interface PreviewData {
  summary: {
    totalRows: number; toCreate: number; toUpdate: number;
    unchanged: number; errors: number;
  };
  toCreate: PreviewRow[];
  toUpdate: PreviewRow[];
  errors: { sourceRow: number; message: string }[];
  warnings: string[];
}

interface CommitResult {
  created: number;
  updated: number;
  unchanged: number;
  warnings: string[];
  errors: { row: number; message: string }[];
  cascadedRecipes: number;
}

export default function IngredientImportModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const qc = useQueryClient();

  const previewMut = useMutation({
    mutationFn: (f: File) => ingredientsApi.importPreview(f),
    onSuccess: (data: PreviewData) => setPreview(data),
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur d\'analyse du fichier');
    },
  });

  const commitMut = useMutation({
    mutationFn: (f: File) => ingredientsApi.importCommit(f),
    onSuccess: (data: CommitResult) => {
      setResult(data);
      const parts: string[] = [];
      if (data.created) parts.push(`${data.created} cree(s)`);
      if (data.updated) parts.push(`${data.updated} mis a jour`);
      notify.success(`Import termine — ${parts.join(', ') || 'aucun changement'}`);
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-alerts'] });
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
    <Modal
      title="Importer des ingrédients"
      subtitle="Ingrédients › Importer depuis Excel"
      onClose={onClose}
      locked={busy}
      width={896}
      footer={result ? (
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" className="odoo-btn-primary" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <FormFooter
          onCancel={onClose}
          submitLabel="Confirmer et importer"
          busy={commitMut.isPending}
          disabled={!preview || busy || blockCommit || !!nothingToDo}
          onSubmit={onConfirm}
        />
      )}
    >
      <div className="space-y-4">
        {!result && (
          <FormSection title="Fichier">
            <FormField label="Fichier Excel (.xlsx)" htmlFor="ingredient-import-file" required
              hint={<>Colonnes attendues : <code>Nom | Categorie | Unite | Cout ({currencySymbol()}) | Fournisseur | Allergenes</code>. Les ingredients existants (meme nom) seront mis a jour, les nouveaux crees. Toute modification du cout cascade automatiquement sur les recettes liees.</>}>
              <div className="flex items-center gap-3 flex-wrap">
                <input id="ingredient-import-file" type="file" accept=".xlsx" onChange={onFileChange} className="text-sm" />
                {file && (
                  <button type="button" onClick={onAnalyze} disabled={busy} className="odoo-btn-secondary ds-btn-sm">
                    {previewMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Analyser
                  </button>
                )}
                <button type="button" onClick={() => ingredientsApi.downloadTemplate()} className="ds-btn-ghost ds-btn-sm" style={{ marginLeft: 'auto' }}
                  title="Telecharger un modele Excel vide">
                  <Download size={14} /> Modele vide
                </button>
              </div>
            </FormField>
          </FormSection>
        )}

        {/* Preview */}
        {preview && !result && (
          <div className="space-y-4">
            <KpiGrid label="Analyse du fichier">
              <KpiCard label="Total lignes" value={String(preview.summary.totalRows)} />
              <KpiCard label="A creer" value={String(preview.summary.toCreate)} />
              <KpiCard label="A mettre a jour" value={String(preview.summary.toUpdate)} />
              <KpiCard label="Inchanges" value={String(preview.summary.unchanged)} />
            </KpiGrid>

            {preview.errors.length > 0 && (
              <Alert tone="danger" icon={AlertTriangle}>
                <strong>{preview.errors.length} erreur(s) bloquante(s) — corrigez le fichier</strong>
                <ul className="text-xs space-y-1 max-h-40 overflow-y-auto mt-1">
                  {preview.errors.map((e, i) => <li key={i}>Ligne {e.sourceRow} : {e.message}</li>)}
                </ul>
              </Alert>
            )}

            {preview.warnings.length > 0 && (
              <Alert tone="warning" icon={AlertTriangle}>
                <details>
                  <summary className="cursor-pointer">{preview.warnings.length} avertissement(s)</summary>
                  <ul className="text-xs space-y-1 max-h-40 overflow-y-auto mt-1">
                    {preview.warnings.map((w, i) => <li key={i}>- {w}</li>)}
                  </ul>
                </details>
              </Alert>
            )}

            {preview.toCreate.length > 0 && (
              <details open>
                <summary className="cursor-pointer ds-strong" style={{ marginBottom: 8 }}>A creer ({preview.toCreate.length})</summary>
                <PreviewTable rows={preview.toCreate} kind="create" />
              </details>
            )}

            {preview.toUpdate.length > 0 && (
              <details>
                <summary className="cursor-pointer ds-strong" style={{ marginBottom: 8 }}>A mettre a jour ({preview.toUpdate.length})</summary>
                <PreviewTable rows={preview.toUpdate} kind="update" />
              </details>
            )}

            {nothingToDo && (
              <Alert tone="info">Rien a importer — toutes les lignes du fichier correspondent deja aux donnees actuelles.</Alert>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            <Alert tone="success" icon={Check}>
              <strong>Import termine</strong>
              <div>
                {result.created} cree(s), {result.updated} mis a jour, {result.unchanged} inchange(s)
                {result.cascadedRecipes > 0 && ` — ${result.cascadedRecipes} recette(s) recalculee(s)`}
              </div>
            </Alert>

            {result.errors.length > 0 && (
              <Alert tone="danger">
                <strong>Erreurs ({result.errors.length})</strong>
                <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto mt-1">
                  {result.errors.map((e, i) => <li key={i}>Ligne {e.row} : {e.message}</li>)}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PreviewTable({ rows, kind }: { rows: PreviewRow[]; kind: 'create' | 'update' }) {
  const visible = rows.slice(0, 200);
  return (
    <DataPanel label={kind === 'create' ? 'Lignes à créer' : 'Lignes à mettre à jour'}
      footer={rows.length > visible.length ? (
        <div className="p-2 text-xs" style={{ color: 'var(--ds-muted)' }}>
          ... et {rows.length - visible.length} autre(s) ligne(s) — toutes seront traitees a l'import.
        </div>
      ) : undefined}>
      <table className="odoo-table ds-dense">
        <thead>
          <tr>
            <th className="ds-num">Ligne</th>
            <th>Nom</th>
            <th>Categorie</th>
            <th>Unite</th>
            <th className="ds-num">Cout ({currencySymbol()})</th>
            <th>Fournisseur</th>
            {kind === 'update' && <th>Champs modifies</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <tr key={r.sourceRow}>
              <td className="ds-num">{r.sourceRow}</td>
              <td className="ds-strong">{r.name}</td>
              <td>{r.category}</td>
              <td>{r.unit}</td>
              <td className="ds-num">{r.unitCost.toFixed(2)}</td>
              <td>{r.supplier || '-'}</td>
              {kind === 'update' && (
                <td>
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
    </DataPanel>
  );
}
