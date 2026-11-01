import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, History, Loader2, RotateCcw } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

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
export default function VersionsSection({ recipeId }: { recipeId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const confirm = useConfirm();

  const { data: versions = [], isLoading, isError } = useQuery<Version[]>({
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
    const ok = await confirm(
      `Restaurer la version ${v} ? La composition, les formats, les étapes et les paramètres actuels seront remplacés par ceux de cette version. Une nouvelle version est créée au passage.`,
      { title: 'Restaurer une version', confirmLabel: 'Restaurer', danger: true },
    );
    if (ok) restore.mutate(v);
  };

  const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <div className="odoo-section" style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="odoo-section-header"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <History size={12} /> Historique des versions
        {open && versions.length > 0 && (
          <span style={{ marginLeft: 8, color: 'var(--theme-text-muted)', fontSize: '0.78rem', fontWeight: 400 }}>{versions.length} version(s)</span>
        )}
      </button>

      {open && (
        <div style={{ padding: '0.5rem 0' }}>
          {isLoading && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
              <Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
            </div>
          )}
          {isError && !isLoading && (
            <div style={{ padding: 12, color: 'var(--theme-danger, #dc3545)', fontSize: '0.85rem' }}>Impossible de charger l'historique.</div>
          )}
          {!isLoading && !isError && versions.length === 0 && (
            <div style={{ padding: 12, color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>Aucune version enregistrée pour l'instant.</div>
          )}
          {!isLoading && !isError && versions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'right' }}>Version</th>
                    <th>Date</th>
                    <th>Auteur</th>
                    <th>Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version_number}>
                      <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>#{v.version_number}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDate(v.changed_at)}</td>
                      <td>{v.changed_by_name || '—'}</td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{v.change_note || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="odoo-btn-secondary"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          disabled={restore.isPending}
                          onClick={() => onRestore(v.version_number)}
                        >
                          <RotateCcw size={12} /> Restaurer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.72rem', color: 'var(--theme-text-muted)', padding: '6px 2px 0' }}>
            Chaque modification de composition ou de finance, et chaque restauration, crée une version. Restaurer remplace l'état actuel.
          </p>
        </div>
      )}
    </div>
  );
}
