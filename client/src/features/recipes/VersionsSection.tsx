import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, History, Loader2, RotateCcw } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

import { EmptyState, ErrorState, LoadingState } from '../../components/ds';
import '../production/production.css';
type Version = {
  version_number: number;
  change_note?: string | null;
  changed_at?: string;
  changed_by_name?: string | null;
};

/**
 * Historique des versions d'une fiche (mig 041/346) : chaque modification de la
 * composition / des finances, et chaque restauration, crée une version complète
 * (snapshot). On peut revenir à n'importe laquelle. Réintégré dans l'éditeur
 * unifié (L3) — cette fonction n'était plus accessible que depuis un écran mort.
 */
export default function VersionsSection({ recipeId, defaultOpen = false }: { recipeId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const qc = useQueryClient();
  const confirm = useConfirm();

  const { data: versions = [], isLoading, isError, error } = useQuery<Version[]>({
    queryKey: ['recipe-versions', recipeId],
    queryFn: () => recipesApi.versions(recipeId),
    enabled: open,
  });

  const restore = useMutation({
    mutationFn: (v: number) => recipesApi.restoreVersion(recipeId, v),
    onSuccess: (res) => {
      const warnings = res?.restore?.warnings ?? [];
      if (warnings.length > 0) notify.error(`Version restaurée, avec avertissements : ${warnings.join(' · ')}`);
      else notify.success('Version restaurée.');
      qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipe-versions', recipeId] });
      qc.invalidateQueries({ queryKey: ['format-components'] });
      qc.invalidateQueries({ queryKey: ['recipe-explosion', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipe-children', recipeId] });
    },
    onError: (e: unknown) => notify.error(apiErrorMessage(e, 'Échec de la restauration.')),
  });

  const onRestore = async (v: number) => {
    const ok = await confirm(`Restaurer la version ${v} ? La composition, les formats, les étapes et les paramètres actuels seront remplacés par ceux de cette version. Une nouvelle version est créée au passage.`,
      { title: 'Restaurer une version', confirmLabel: 'Restaurer', danger: true },
    );
    if (ok) restore.mutate(v);
  };

  const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <div className="ds-panel pd-section" style={{ marginTop: 16 }}>
      <button type="button" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="pd-section-head"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <History size={12} /> Historique des versions
        {open && versions.length > 0 && (
          <span style={{ marginLeft: 8, color: 'var(--ds-muted)', fontSize: '0.78rem', fontWeight: 400 }}>{versions.length} version(s)</span>
        )}
      </button>

      {open && (
        <div style={{ padding: '0.5rem 0' }}>
          {isLoading && (
            <LoadingState bare />
          )}
          {isError && !isLoading && (
            <ErrorState bare error={error} title="L'historique n'a pas pu être chargé" />
          )}
          {!isLoading && !isError && versions.length === 0 && (
            <EmptyState bare icon={History} title="Aucune version enregistrée" text="Une version est créée à chaque modification de la composition ou de la finance." />
          )}
          {!isLoading && !isError && versions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th className="ds-num">Version</th>
                    <th>Date</th>
                    <th>Auteur</th>
                    <th>Note</th>
                    <th className="ds-actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version_number}>
                      <td className="ds-num ds-strong">{v.version_number}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDate(v.changed_at)}</td>
                      <td>{v.changed_by_name || '—'}</td>
                      <td style={{ color: 'var(--ds-muted)' }}>{v.change_note || '—'}</td>
                      <td className="ds-actions">
                        <button
                          type="button"
                          className="odoo-btn-secondary ds-btn-sm"
                          disabled={restore.isPending}
                          onClick={() => onRestore(v.version_number)}
                        >
                          <RotateCcw size={12} aria-hidden="true" /> Restaurer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.72rem', color: 'var(--ds-muted)', padding: '6px 2px 0' }}>
            Chaque modification de composition ou de finance, et chaque restauration, crée une version. Restaurer remplace l'état actuel.
          </p>
        </div>
      )}
    </div>
  );
}
