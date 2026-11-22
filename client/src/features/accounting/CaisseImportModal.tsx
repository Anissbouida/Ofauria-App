import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { caisseImportApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { money, currencySymbol } from '../../utils/money';
import { Modal, FormSection, FormField, FormFooter, KpiGrid, KpiCard, Alert, SectionHeader, DataPanel } from '../../components/ds';

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

  const cur = currencySymbol();
  return (
    <Modal title={<><FileSpreadsheet size={16} aria-hidden="true" style={{ color: 'var(--ds-success)', verticalAlign: '-2px' }} /> Importer un journal de caisse Excel</>}
      onClose={onClose} width={900} locked={busy}
      footer={result
        ? <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
        : preview
          ? <FormFooter onCancel={onClose} onSubmit={onConfirm} busy={commitMut.isPending} disabled={busy} submitLabel="Confirmer et importer" />
          : <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>}>
      {!result && (
        <FormSection title="Fichier">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <FormField label="Journal de caisse (.xlsx)" htmlFor="ci-file" required
              hint="Format attendu : 7 colonnes (DATE, TYPE, N°, FOURNISSEUR, DÉSIGNATION, ENTRÉE, SORTIE). Les lignes déjà importées (même fichier) seront ignorées automatiquement.">
              <input id="ci-file" type="file" accept=".xlsx" onChange={onFileChange} style={{ fontSize: 14 }} />
            </FormField>
            {file && (
              <button type="button" className="odoo-btn-primary" onClick={onAnalyze} disabled={busy} aria-busy={previewMut.isPending || undefined}>
                {previewMut.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} Analyser
              </button>
            )}
          </div>
        </FormSection>
      )}

      {/* Preview */}
      {preview && !result && (
        <>
          <Alert tone="success">
            <strong>Mois détecté : {MONTHS[preview.meta.month - 1]} {preview.meta.year}</strong>
            <div style={{ fontSize: 12, marginTop: 2 }}>Source : <code>{preview.meta.importSource}</code></div>
          </Alert>

          <KpiGrid>
            <KpiCard label="Opérations" value={String(preview.summary.nbOperations)} />
            <KpiCard label="Recettes (jours)" value={String(preview.summary.nbRecettes)} />
            <KpiCard label="Total dépenses" value={money(preview.summary.totalExpenses)} />
            <KpiCard label="Total recettes" value={money(preview.summary.totalRecettesCash + preview.summary.totalRecettesCard)}
              sub={`Espèces ${money(preview.summary.totalRecettesCash)} · carte ${money(preview.summary.totalRecettesCard)}`} />
          </KpiGrid>

          {preview.alreadyImported > 0 && (
            <Alert tone="warning">
              {preview.alreadyImported} ligne(s) déjà importée(s) pour ce mois — elles seront ignorées à l'import.
            </Alert>
          )}

          {preview.suppliers.toCreate.length > 0 && (
            <div>
              <SectionHeader title={`Fournisseurs à créer (${preview.suppliers.toCreate.length})`} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {preview.suppliers.toCreate.map(s => (
                  <span key={s.key} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4,
                    background: s.kind === 'personnel' ? 'var(--ds-info-bg)' : 'var(--ds-bg)', color: s.kind === 'personnel' ? 'var(--ds-info)' : 'var(--ds-ink)', border: '1px solid var(--ds-hair)' }}>
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <details className="ds-panel">
              <summary style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ds-warning)' }}>
                <AlertTriangle size={14} aria-hidden="true" /> {preview.warnings.length} avertissement(s)
              </summary>
              <ul style={{ margin: 0, padding: '8px 12px 8px 28px', fontSize: 12, maxHeight: 160, overflowY: 'auto' }}>
                {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 0' }}>Aperçu (50 premières opérations)</summary>
            <DataPanel label="Aperçu des opérations">
              <table className="odoo-table ds-dense">
                <thead>
                  <tr><th>Date</th><th>Fournisseur</th><th>Désignation</th><th className="ds-num">Montant ({cur})</th></tr>
                </thead>
                <tbody>
                  {preview.sample.map(r => (
                    <tr key={r.sourceRow}>
                      <td>{r.date}</td>
                      <td className="ds-strong" style={{ color: r.supplierKind === 'personnel' ? 'var(--ds-info)' : undefined }}>{r.supplier}</td>
                      <td>{r.designation}</td>
                      <td className="ds-num" style={{ color: r.type === 'expense' ? 'var(--ds-danger)' : 'var(--ds-success)' }}>
                        {r.type === 'expense' ? '-' : '+'}{fmt(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          </details>
        </>
      )}

      {/* Result */}
      {result && (
        <>
          <Alert tone="success" icon={Check}>
            <strong>Import terminé</strong>
            <div style={{ marginTop: 2 }}>{result.created} ligne(s) créée(s), {result.skipped} ignorée(s) (déjà importées)</div>
          </Alert>

          {result.newSuppliers.length > 0 && (
            <div>
              <SectionHeader title="Nouveaux fournisseurs créés" />
              <p style={{ margin: 0, fontSize: 14 }}>{result.newSuppliers.join(', ')}</p>
            </div>
          )}

          {result.errors.length > 0 && (
            <Alert tone="danger" icon={AlertTriangle}>
              <strong>Erreurs ({result.errors.length})</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, maxHeight: 160, overflowY: 'auto' }}>
                {result.errors.map((e, i) => <li key={i}>Ligne {e.row} : {e.message}</li>)}
              </ul>
            </Alert>
          )}
        </>
      )}
    </Modal>
  );
}
