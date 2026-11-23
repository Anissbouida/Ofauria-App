import ProcessingRegisterCard from './ProcessingRegisterCard';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Database } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { settingsApi } from '../../api/settings.api';
import ImportSection from './ImportSection';
import { notify } from '../../components/ui/InlineNotification';
import { DataPanel, LoadingState, SectionHeader } from '../../components/ds';
import { useProdTerms } from '../../hooks/useProdTerms';

/**
 * Paramètres › Données (audit Paramètres, lot 7) : import guidé (modèle, aperçu
 * ligne par ligne, validation tout ou rien), exports de la configuration et des
 * données de base, état de la base.
 */

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: Blob | { error?: { message?: string } } } };
  const d = e?.response?.data as { error?: { message?: string } } | undefined;
  return d?.error?.message || fallback;
}

async function save(path: string) {
  const { blob, filename } = await settingsApi.download(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const COUNT_LABELS: Record<string, string> = {
  products: 'Produits', ingredients: 'Ingrédients', suppliers: 'Fournisseurs', customers: 'Clients',
  employees: 'Personnel', sales: 'Ventes', invoices: 'Factures', stores: 'Établissements', users: 'Utilisateurs',
};
const EVENT_LABELS = { config_export: 'Export de la configuration', data_export: 'Export des données', data_import: 'Import' };

export default function DataTab() {
  const queryClient = useQueryClient();
  const { ingredients, ingredientsLc } = useProdTerms();
  const { data: status, isLoading } = useQuery({ queryKey: ['data-status'], queryFn: settingsApi.dataStatus });
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (err) { notify.error(errorMessage(err, 'Opération impossible')); } finally { setBusy(null); }
  };
  const doExport = (path: string, label: string) => run(path, async () => {
    await save(path);
    notify.success(`${label} téléchargé`);
    queryClient.invalidateQueries({ queryKey: ['data-status'] });
  });

  if (isLoading || !status) return <LoadingState />;
  const card: React.CSSProperties = { padding: '16px 18px', display: 'grid', gap: 12 };

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      {/* ── Import générique (mig 370) ── */}
      <ImportSection status={status} onTemplate={entity => save(`import/${entity}/template`)} />

      {/* ── Exports ── */}
      <section className="ds-panel" style={card}>
        <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Download size={15} aria-hidden="true" /> Exporter</span>} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', display: 'grid', gap: 6, alignContent: 'start' }}>
            <div style={{ fontSize: '14px' }}><strong>Configuration</strong> (fichier JSON)</div>
            <div style={{ fontSize: '13px', color: 'var(--ds-muted)' }}>
              Société, établissements, rôles et droits, séries de numéros, modèles, notifications, TVA, référentiel. Sans mot de passe ni code PIN.
            </div>
            <button type="button" className="odoo-btn-secondary" style={{ justifySelf: 'start' }} disabled={busy !== null} onClick={() => doExport('export/configuration', 'Configuration')}>
              {busy === 'export/configuration' ? 'Export…' : 'Exporter la configuration'}
            </button>
          </div>
          <div style={{ flex: '1 1 260px', display: 'grid', gap: 6, alignContent: 'start' }}>
            <div style={{ fontSize: '14px' }}><strong>Données de base</strong> (classeur Excel)</div>
            <div style={{ fontSize: '13px', color: 'var(--ds-muted)' }}>
              Produits, {ingredientsLc}, fournisseurs, clients, personnel, établissements : une feuille chacun. Contient des données personnelles.
            </div>
            <button type="button" className="odoo-btn-secondary" style={{ justifySelf: 'start' }} disabled={busy !== null} onClick={() => doExport('export/base', 'Export des données')}>
              {busy === 'export/base' ? 'Export…' : 'Exporter les données'}
            </button>
          </div>
        </div>
      </section>

      {/* ── État de la base ── */}
      <section className="ds-panel" style={card}>
        <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Database size={15} aria-hidden="true" /> État de la base</span>} />
        <PageNote help="Les sauvegardes automatiques de la base sont faites par l'hébergeur et ne sont pas visibles ici. Gardez en plus un export mensuel des données et de la configuration.">
          Sauvegardes assurées par l'hébergeur ; exportez aussi chaque mois.
        </PageNote>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '14px' }}>
          <span>Taille : <strong>{status.size}</strong></span>
          {status.lastMigration && <span>Version de la base : <strong>{status.lastMigration.name.replace(/\.sql$/, '')}</strong></span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(status.counts).filter(([, v]) => v !== null).map(([k, v]) => (
            <span key={k} className="odoo-tag odoo-tag-grey" style={{ fontVariantNumeric: 'tabular-nums' }}>{k === 'ingredients' ? ingredients : COUNT_LABELS[k] ?? k} : {v}</span>
          ))}
        </div>
        {status.exports.length > 0 && (
          <DataPanel label="Exports et imports récents">
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Opération</th><th>Par</th><th>Détail</th></tr></thead>
            <tbody>
              {status.exports.map((e, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="ds-strong">{EVENT_LABELS[e.event_type]}</td>
                  <td>{e.by_name || '—'}</td>
                  <td style={{ fontSize: '13px', color: 'var(--ds-muted)' }}>
                    {e.event_type === 'data_import' && e.details ? `${String(e.details.entity)} · ${String(e.details.created)} créé(s), ${String(e.details.updated)} mis à jour` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </DataPanel>
        )}
      </section>
      {/* G3-11 : registre des traitements de données personnelles. */}
      <ProcessingRegisterCard />
    </div>
  );
}
