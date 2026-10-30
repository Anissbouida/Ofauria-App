import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Repeat, X, Loader2, ArrowRight, AlertTriangle, Undo2, CheckCircle } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import SearchSelect from '../../components/ui/SearchSelect';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', flex: 1, minWidth: 180 };
const lbl: React.CSSProperties = { color: 'var(--theme-text-muted)', fontWeight: 500 };

/**
 * Remplacement de composant en masse A→B (mig 401) : aperçu des recettes
 * impactées, application, et annulation via le journal. Admin uniquement.
 */
export default function BulkReplaceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');

  const { data: sources } = useQuery({ queryKey: ['component-sources'], queryFn: recipesApi.componentSources });
  const ingOptions = useMemo(
    () => ((sources?.ingredients ?? []) as { id: string; name: string; unit: string }[])
      .map(i => ({ id: i.id, label: `${i.name} (${i.unit})` })),
    [sources]
  );
  const { data: logs } = useQuery({ queryKey: ['bulk-replace-logs'], queryFn: recipesApi.bulkReplaceLogs });

  const canPreview = !!source && !!target && source !== target;

  const preview = useQuery({
    queryKey: ['bulk-replace-preview', source, target],
    queryFn: () => recipesApi.bulkReplacePreview(source, target),
    enabled: canPreview,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['bulk-replace-logs'] });
    qc.invalidateQueries({ queryKey: ['recipes'] });
    qc.invalidateQueries({ queryKey: ['recipe'] });
    qc.invalidateQueries({ queryKey: ['bulk-replace-preview'] });
  };
  const apply = useMutation({
    mutationFn: () => recipesApi.bulkReplaceApply(source, target),
    onSuccess: (d) => { notify.success(`Remplacé sur ${d.recipes_count} recette(s) · ${d.rows_count} ligne(s)`); invalidateAll(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const revert = useMutation({
    mutationFn: (logId: string) => recipesApi.bulkReplaceRevert(logId),
    onSuccess: (d) => { notify.success(`Annulé · ${d.restored} ligne(s) restaurée(s)`); invalidateAll(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(680px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Repeat size={16} /> Remplacer un ingrédient sur toutes les recettes</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={fieldCol}><span style={lbl}>Ingrédient à remplacer</span>
              <SearchSelect options={ingOptions} value={source} onChange={setSource} placeholder="Choisir…" width="100%" />
            </label>
            <ArrowRight size={18} style={{ color: 'var(--theme-text-muted)', marginBottom: 8 }} />
            <label style={fieldCol}><span style={lbl}>Nouvel ingrédient</span>
              <SearchSelect options={ingOptions.filter(o => o.id !== source)} value={target} onChange={setTarget} placeholder="Choisir…" width="100%" />
            </label>
          </div>

          {canPreview && preview.isLoading && (
            <div style={{ padding: 12, color: 'var(--theme-text-muted)' }}><Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> Analyse…</div>
          )}

          {canPreview && preview.data && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: '0.86rem' }}>
                <b>{preview.data.recipes_count}</b> recette(s) impactée(s), <b>{preview.data.rows_count}</b> ligne(s) ·
                {' '}<span style={{ color: 'var(--theme-text-muted)' }}>{preview.data.source?.name} → {preview.data.target?.name}</span>
              </div>
              {preview.data.unit_mismatch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#b45309', background: 'rgba(234,179,8,0.08)', borderRadius: 4, padding: '6px 8px' }}>
                  <AlertTriangle size={13} /> Unités différentes ({preview.data.source?.unit} → {preview.data.target?.unit}) : vérifiez les quantités après remplacement.
                </div>
              )}
              {preview.data.recipes.length > 0 ? (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
                  <table className="odoo-table" style={{ margin: 0 }}>
                    <thead><tr><th>Recette</th><th style={{ textAlign: 'right' }}>Occurrences</th></tr></thead>
                    <tbody>{preview.data.recipes.map(r => (
                      <tr key={r.id}><td>{r.name}</td><td style={{ textAlign: 'right' }}>{r.occurrences}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>Cet ingrédient n'est utilisé dans aucune recette.</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="odoo-btn-primary" disabled={apply.isPending || preview.data.rows_count === 0}
                  onClick={() => apply.mutate()}>
                  {apply.isPending ? <Loader2 size={13} className="animate-spin" /> : <Repeat size={13} />} Remplacer ({preview.data.rows_count})
                </button>
              </div>
            </div>
          )}

          {/* Journal annulable */}
          {logs && logs.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>Derniers remplacements</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead><tr><th>Quand</th><th>Remplacement</th><th style={{ textAlign: 'right' }}>Recettes</th><th>État</th><th /></tr></thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{new Date(l.performed_at).toLocaleString('fr-FR')}</td>
                        <td style={{ fontSize: '0.82rem' }}>{l.source_name} → {l.target_name}</td>
                        <td style={{ textAlign: 'right' }}>{l.recipes_count}</td>
                        <td>{l.reverted_at
                          ? <span className="odoo-tag odoo-tag-grey">Annulé</span>
                          : <span className="odoo-tag odoo-tag-green"><CheckCircle size={10} style={{ display: 'inline' }} /> Appliqué</span>}</td>
                        <td style={{ textAlign: 'right' }}>
                          {!l.reverted_at && (
                            <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem' }} disabled={revert.isPending}
                              title="Annuler ce remplacement" onClick={() => revert.mutate(l.id)}>
                              <Undo2 size={12} /> Annuler
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
