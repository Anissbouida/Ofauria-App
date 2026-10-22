import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, Database, Loader2, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { settingsApi, type ImportPreview } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
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
const ACTION_TAG = {
  create: { cls: 'odoo-tag odoo-tag-green', label: 'Création' },
  update: { cls: 'odoo-tag odoo-tag-blue', label: 'Mise à jour' },
  error: { cls: 'odoo-tag odoo-tag-red', label: 'Erreur' },
  skip: { cls: 'odoo-tag odoo-tag-grey', label: 'Ligne vide' },
} as const;

export default function DataTab() {
  const queryClient = useQueryClient();
  const { canCreate } = usePermissions();
  const { data: status, isLoading } = useQuery({ queryKey: ['data-status'], queryFn: settingsApi.dataStatus });
  const [busy, setBusy] = useState<string | null>(null);
  const [entity, setEntity] = useState('suppliers');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showAll, setShowAll] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (err) { notify.error(errorMessage(err, 'Opération impossible')); } finally { setBusy(null); }
  };
  const doExport = (path: string, label: string) => run(path, async () => {
    await save(path);
    notify.success(`${label} téléchargé`);
    queryClient.invalidateQueries({ queryKey: ['data-status'] });
  });
  const pick = (f: File | null) => {
    setFile(f); setPreview(null);
    if (f) run('preview', async () => setPreview(await settingsApi.importPreview(entity, f)));
  };
  const commit = () => file && run('commit', async () => {
    const r = await settingsApi.importCommit(entity, file);
    notify.success(`Import terminé : ${r.created} création(s), ${r.updated} mise(s) à jour`);
    setFile(null); setPreview(null);
    if (input.current) input.current.value = '';
    queryClient.invalidateQueries({ queryKey: ['data-status'] });
  });

  if (isLoading || !status) return <Loader2 className="animate-spin" size={18} />;
  const rows = preview ? (showAll ? preview.rows : preview.rows.filter(r => r.action === 'error')) : [];
  const card: React.CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg)' };

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      {/* ── Import guidé ── */}
      <section style={card}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Upload size={15} /> Importer des données</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          Téléchargez le modèle, remplissez-le dans Excel, puis déposez-le : chaque ligne est contrôlée avant tout enregistrement.
          L'import n'a lieu que si aucune ligne n'est en erreur. Ingrédients, fiches techniques et produits s'importent depuis leur propre écran.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select id="import-entity" aria-label="Données à importer" value={entity} onChange={e => { setEntity(e.target.value); setFile(null); setPreview(null); }}
            style={{ fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' }}>
            {status.entities.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
          <button className="odoo-btn-secondary" onClick={() => run('tpl', () => save(`import/${entity}/template`))} disabled={busy !== null}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FileSpreadsheet size={13} /> Modèle Excel
          </button>
          {canCreate('settings') && (
            <label className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <Upload size={13} /> {file ? file.name : 'Choisir le fichier'}
              <input ref={input} id="import-file" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => pick(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {busy === 'preview' && <Loader2 className="animate-spin" size={16} />}
        </div>

        {preview && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={ACTION_TAG.create.cls}>{preview.summary.create} création(s)</span>
              <span className={ACTION_TAG.update.cls}>{preview.summary.update} mise(s) à jour</span>
              <span className={ACTION_TAG.error.cls}>{preview.summary.error} erreur(s)</span>
              {preview.summary.skip > 0 && <span className={ACTION_TAG.skip.cls}>{preview.summary.skip} ligne(s) vide(s)</span>}
            </div>
            {preview.unknownHeaders.length > 0 && (
              <StatusBanner tone="warning" icon={FileSpreadsheet} title="Colonnes ignorées">
                {preview.unknownHeaders.join(', ')} : non reconnues. Colonnes attendues : {preview.columns.join(', ')}.
              </StatusBanner>
            )}
            {preview.summary.error > 0 && (
              <StatusBanner tone="danger" icon={FileSpreadsheet} title="Corrigez le fichier avant d'importer">
                Rien n'a été enregistré. Corrigez les lignes ci-dessous dans Excel, puis déposez à nouveau le fichier.
              </StatusBanner>
            )}
            <label htmlFor="import-show-all" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
              <input id="import-show-all" type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Afficher toutes les lignes
            </label>
            {rows.length > 0 && (
              <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                <table className="odoo-table">
                  <thead><tr><th style={{ width: 60 }}>Ligne</th><th style={{ width: 120 }}>Résultat</th><th>Données</th><th>Motif</th></tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.line}>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.line}</td>
                        <td><span className={ACTION_TAG[r.action].cls}>{ACTION_TAG[r.action].label}</span></td>
                        <td style={{ fontSize: '0.8125rem' }}>{Object.values(r.values).filter(Boolean).slice(0, 4).join(' · ')}</td>
                        <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-danger, #b3261e)' }}>{r.errors.map(e => `${e.column} : ${e.message}`).join(' ; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="odoo-btn-secondary" onClick={() => pick(null)}>Annuler</button>
              <button className="odoo-btn-primary" onClick={commit}
                disabled={busy !== null || preview.summary.error > 0 || preview.summary.create + preview.summary.update === 0}>
                {busy === 'commit' ? 'Import…' : `Importer ${preview.summary.create + preview.summary.update} ligne(s)`}
              </button>
            </div>
          </div>
        )}
      </section>

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
