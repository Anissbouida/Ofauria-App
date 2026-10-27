import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Database, Loader2, ShieldCheck } from 'lucide-react';
import { settingsApi } from '../../api/settings.api';
import ImportSection from './ImportSection';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

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

  if (isLoading || !status) return <Loader2 className="animate-spin" size={18} />;
  const card: React.CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg)' };

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      {/* ── Import générique (mig 370) ── */}
      <ImportSection status={status} onTemplate={entity => save(`import/${entity}/template`)} />

      {/* ── Exports ── */}
      <section style={card}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Download size={15} /> Exporter</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', display: 'grid', gap: 6, alignContent: 'start' }}>
            <div style={{ fontSize: '0.875rem' }}><strong>Configuration</strong> (fichier JSON)</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
              Société, établissements, rôles et droits, séries de numéros, modèles, notifications, TVA, référentiel. Sans mot de passe ni code PIN.
            </div>
            <button className="odoo-btn-secondary" style={{ justifySelf: 'start' }} disabled={busy !== null} onClick={() => doExport('export/configuration', 'Configuration')}>
              {busy === 'export/configuration' ? 'Export…' : 'Exporter la configuration'}
            </button>
          </div>
          <div style={{ flex: '1 1 260px', display: 'grid', gap: 6, alignContent: 'start' }}>
            <div style={{ fontSize: '0.875rem' }}><strong>Données de base</strong> (classeur Excel)</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
              Produits, ingrédients, fournisseurs, clients, personnel, établissements : une feuille chacun. Contient des données personnelles.
            </div>
            <button className="odoo-btn-secondary" style={{ justifySelf: 'start' }} disabled={busy !== null} onClick={() => doExport('export/base', 'Export des données')}>
              {busy === 'export/base' ? 'Export…' : 'Exporter les données'}
            </button>
          </div>
        </div>
      </section>

      {/* ── État de la base ── */}
      <section style={card}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Database size={15} /> État de la base</div>
        <StatusBanner tone="info" icon={ShieldCheck} title="Sauvegardes">
          Les sauvegardes automatiques de la base sont assurées par l'hébergeur et ne sont pas visibles depuis l'application.
          Gardez en plus un export mensuel des données et de la configuration.
        </StatusBanner>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '0.875rem' }}>
          <span>Taille : <strong>{status.size}</strong></span>
          {status.lastMigration && <span>Version de la base : <strong>{status.lastMigration.name.replace(/\.sql$/, '')}</strong></span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(status.counts).filter(([, v]) => v !== null).map(([k, v]) => (
            <span key={k} className="odoo-tag odoo-tag-grey" style={{ fontVariantNumeric: 'tabular-nums' }}>{COUNT_LABELS[k] ?? k} : {v}</span>
          ))}
        </div>
        {status.exports.length > 0 && (
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Opération</th><th>Par</th><th>Détail</th></tr></thead>
            <tbody>
              {status.exports.map((e, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{EVENT_LABELS[e.event_type]}</td>
                  <td>{e.by_name || '—'}</td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
                    {e.event_type === 'data_import' && e.details ? `${String(e.details.entity)} · ${String(e.details.created)} créé(s), ${String(e.details.updated)} mis à jour` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
