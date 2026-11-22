import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Repeat, X, Loader2, ArrowRight, AlertTriangle, Undo2, Shuffle } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import SearchSelect from '../../components/ui/SearchSelect';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';

const fieldCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', flex: 1, minWidth: 180 };
const lbl: React.CSSProperties = { color: 'var(--theme-text-muted)', fontWeight: 500 };
const input: React.CSSProperties = { padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.85rem', background: 'var(--odoo-bg)' };

type Mode = 'replace' | 'substitute';

/**
 * Remplacement de composant en masse (mig 401), outil de mise à jour des nomenclatures (M4-05) :
 *  - « Remplacer » : A → B sur les fiches cochées, quantités × ratio, puis nouvelle version
 *    des fiches modifiées (circuit d'approbation des nomenclatures) ;
 *  - « Déclarer comme substitut » : B devient substitut de A (proposé au bon de sortie en cas
 *    de rupture) pour les fiches cochées ou pour toutes ; la composition ne change pas.
 * Chaque opération est annulable depuis le journal.
 */
export default function BulkReplaceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<Mode>('replace');
  const [ratio, setRatio] = useState('1');
  const [priority, setPriority] = useState('1');
  const [allRecipes, setAllRecipes] = useState(false);
  const [activateVersions, setActivateVersions] = useState(true);
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());

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
  // Toutes les fiches cochées à chaque nouvel aperçu.
  useEffect(() => { setChecked(new Set((preview.data?.recipes ?? []).map(r => r.id))); }, [preview.data]);

  const ratioNum = Number(ratio.replace(',', '.'));
  const ratioOk = Number.isFinite(ratioNum) && ratioNum > 0 && ratioNum <= 1000;
  const recipes = preview.data?.recipes ?? [];
  const selected = recipes.filter(r => checked.has(r.id));
  const everyChecked = recipes.length > 0 && selected.length === recipes.length;
  const scopeIds = mode === 'substitute' && allRecipes ? null : everyChecked && mode === 'replace' ? null : selected.map(r => r.id);
  const canApply = ratioOk && (mode === 'substitute' ? (allRecipes || selected.length > 0) : selected.length > 0);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['bulk-replace-logs'] });
    qc.invalidateQueries({ queryKey: ['recipes'] });
    qc.invalidateQueries({ queryKey: ['recipe'] });
    qc.invalidateQueries({ queryKey: ['bulk-replace-preview'] });
  };
  const apply = useMutation({
    mutationFn: () => recipesApi.bulkReplaceApply({
      sourceIngredientId: source, targetIngredientId: target, mode, ratio: ratioNum, recipeIds: scopeIds,
      priority: Number(priority) || 1, activateVersions: mode === 'replace' && activateVersions, reason: reason.trim() || undefined,
    }),
    onSuccess: (d) => {
      if (d.mode === 'substitute') notify.success(`Substitut déclaré · ${d.rows_count} ligne(s)`);
      else {
        const done = d.versions.filter(v => v.version_no && !v.pending && !v.error).length;
        const pending = d.versions.filter(v => v.pending).length;
        const failed = d.versions.filter(v => v.error).length;
        notify.success(`Remplacé sur ${d.recipes_count} fiche(s) · ${d.rows_count} ligne(s)`
          + (d.versions.length ? ` · ${done} version(s) activée(s)${pending ? `, ${pending} en approbation` : ''}${failed ? `, ${failed} non activée(s)` : ''}` : ''));
      }
      invalidateAll();
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const revert = useMutation({
    mutationFn: (logId: string) => recipesApi.bulkReplaceRevert(logId),
    onSuccess: (d) => { notify.success(`Annulé · ${d.restored} ligne(s) restaurée(s)`); invalidateAll(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const toggle = (id: string) => setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(720px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Repeat size={16} /> Remplacer ou substituer un ingrédient</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={fieldCol}><span style={lbl}>Ingrédient actuel</span>
              <SearchSelect options={ingOptions} value={source} onChange={setSource} placeholder="Choisir…" width="100%" />
            </label>
            <ArrowRight size={18} style={{ color: 'var(--theme-text-muted)', marginBottom: 8 }} />
            <label style={fieldCol}><span style={lbl}>Nouvel ingrédient</span>
              <SearchSelect options={ingOptions.filter(o => o.id !== source)} value={target} onChange={setTarget} placeholder="Choisir…" width="100%" />
            </label>
          </div>

          <div role="radiogroup" aria-label="Opération" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([['replace', Repeat, 'Remplacer dans les fiches', 'La composition change ; nouvelle version des fiches'],
               ['substitute', Shuffle, 'Déclarer comme substitut', 'Proposé au bon de sortie en cas de rupture ; la composition ne change pas']] as const)
              .map(([m, Icon, title, help]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                  className={mode === m ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
                  style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left', padding: '8px 10px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}><Icon size={13} /> {title}</span>
                  <span style={{ fontSize: '0.72rem', opacity: 0.85, fontWeight: 400 }}>{help}</span>
                </button>
              ))}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...fieldCol, flex: 'none', width: 200 }}>
              <span style={lbl}>Ratio (nouveau pour 1 actuel)</span>
              <input style={input} inputMode="decimal" value={ratio} onChange={e => setRatio(e.target.value)} aria-invalid={!ratioOk} />
              {!ratioOk && <span style={{ fontSize: '0.72rem', color: 'var(--odoo-danger, #b91c1c)' }}>Nombre positif attendu</span>}
            </label>
            {mode === 'substitute' && (
              <label style={{ ...fieldCol, flex: 'none', width: 140 }}>
                <span style={lbl}>Priorité</span>
                <input style={input} type="number" min={1} max={99} value={priority} onChange={e => setPriority(e.target.value)} />
              </label>
            )}
            {mode === 'replace' && (
              <label style={fieldCol}>
                <span style={lbl}>Motif de la nouvelle version</span>
                <input style={input} value={reason} onChange={e => setReason(e.target.value)} placeholder="Remplacement en masse" maxLength={1000} />
              </label>
            )}
          </div>

          {canPreview && preview.isLoading && (
            <div style={{ padding: 12, color: 'var(--theme-text-muted)' }}><Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> Analyse…</div>
          )}

          {canPreview && preview.data && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: '0.86rem' }}>
                <b>{preview.data.recipes_count}</b> fiche(s) utilisent {preview.data.source?.name}, <b>{preview.data.rows_count}</b> ligne(s)
              </div>
              {preview.data.unit_mismatch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--ds-warning)', background: 'rgba(234,179,8,0.08)', borderRadius: 4, padding: '6px 8px' }}>
                  <AlertTriangle size={13} /> Unités différentes ({preview.data.source?.unit} → {preview.data.target?.unit}) : le ratio doit convertir la quantité.
                </div>
              )}
              {mode === 'substitute' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                  <input type="checkbox" checked={allRecipes} onChange={e => setAllRecipes(e.target.checked)} />
                  Substitut valable pour toutes les fiches (actuelles et futures)
                </label>
              )}
              {recipes.length > 0 ? (
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4, opacity: mode === 'substitute' && allRecipes ? 0.5 : 1 }}>
                  <table className="odoo-table" style={{ margin: 0 }}>
                    <thead><tr>
                      <th style={{ width: 32 }}>
                        <input type="checkbox" aria-label="Toutes les fiches" checked={everyChecked} disabled={mode === 'substitute' && allRecipes}
                          onChange={e => setChecked(e.target.checked ? new Set(recipes.map(r => r.id)) : new Set())} />
                      </th>
                      <th>Fiche</th><th className="ds-num">Lignes</th><th>Version active</th>
                    </tr></thead>
                    <tbody>{recipes.map(r => (
                      <tr key={r.id}>
                        <td><input type="checkbox" aria-label={r.name} checked={checked.has(r.id)} disabled={mode === 'substitute' && allRecipes} onChange={() => toggle(r.id)} /></td>
                        <td>{r.name}</td>
                        <td className="ds-num">{r.occurrences}</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{r.active_version ? `v${r.active_version}` : '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>Cet ingrédient n'est utilisé dans aucune fiche.</div>
              )}
              {mode === 'replace' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                  <input type="checkbox" checked={activateVersions} onChange={e => setActivateVersions(e.target.checked)} />
                  Activer une nouvelle version des fiches modifiées (selon le circuit d'approbation)
                </label>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="odoo-btn-primary" disabled={apply.isPending || !canApply} onClick={() => apply.mutate()}>
                  {apply.isPending ? <Loader2 size={13} className="animate-spin" /> : mode === 'replace' ? <Repeat size={13} /> : <Shuffle size={13} />}
                  {mode === 'replace' ? ` Remplacer (${selected.length} fiche${selected.length > 1 ? 's' : ''})`
                    : allRecipes ? ' Déclarer pour toutes les fiches' : ` Déclarer (${selected.length} fiche${selected.length > 1 ? 's' : ''})`}
                </button>
              </div>
            </div>
          )}

          {logs && logs.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>Dernières opérations</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead><tr><th>Quand</th><th>Opération</th><th className="ds-num">Ratio</th><th className="ds-num">Fiches</th><th>État</th><th /></tr></thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>{new Date(l.performed_at).toLocaleString('fr-FR')}</td>
                        <td style={{ fontSize: '0.82rem' }}>
                          {l.mode === 'substitute' ? 'Substitut' : 'Remplacement'} : {l.source_name} → {l.target_name}
                          {l.activated_versions > 0 && <span style={{ color: 'var(--theme-text-muted)' }}> · {l.activated_versions} version(s)</span>}
                        </td>
                        <td className="ds-num">{Number(l.ratio ?? 1).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</td>
                        <td className="ds-num">{l.mode === 'substitute' && !l.recipes_count ? 'Toutes' : l.recipes_count}</td>
                        <td>{l.reverted_at
                          ? <StatusTag tone="cancelled" label="Annulé" />
                          : <StatusTag tone="done" label="Appliqué" />}</td>
                        <td className="ds-num">
                          {!l.reverted_at && (
                            <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem' }} disabled={revert.isPending}
                              title={l.mode === 'substitute' ? 'Retirer les substituts créés' : 'Restaurer l\'ingrédient et les quantités'} onClick={() => revert.mutate(l.id)}>
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
