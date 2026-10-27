import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Loader2, FileSpreadsheet, RefreshCw, Undo2, History } from 'lucide-react';
import { settingsApi, type ImportPreview, type ImportMode, type DataStatus } from '../../api/settings.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Import générique (mig 370) : modèle Excel, association des colonnes du fichier aux
 * champs de la fiche (champs personnalisés compris), mode, aperçu ligne par ligne,
 * validation tout ou rien, journal et annulation du dernier import d'un type de fiche.
 */
const MODE_LABELS: Record<ImportMode, { label: string; hint: string }> = {
  upsert: { label: 'Créer et mettre à jour', hint: 'les fiches retrouvées sont mises à jour, les autres créées' },
  create: { label: 'Créer seulement', hint: 'les fiches déjà existantes sont ignorées' },
  update: { label: 'Mettre à jour seulement', hint: 'les lignes sans fiche correspondante sont ignorées' },
};
const ACTION_TAG = {
  create: { cls: 'odoo-tag odoo-tag-green', label: 'Création' },
  update: { cls: 'odoo-tag odoo-tag-blue', label: 'Mise à jour' },
  error: { cls: 'odoo-tag odoo-tag-red', label: 'Erreur' },
  skip: { cls: 'odoo-tag odoo-tag-grey', label: 'Ignorée' },
} as const;
const select: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } } } };
  return e?.response?.data?.error?.message || fallback;
}

export default function ImportSection({ status, onTemplate }: { status: DataStatus; onTemplate: (entity: string) => Promise<void> }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canCreate, canEdit } = usePermissions();
  const [entity, setEntity] = useState(status.entities[0]?.key ?? 'suppliers');
  const def = status.entities.find(e => e.key === entity);
  const modes = (def?.modes?.length ? def.modes : ['upsert']) as ImportMode[];
  const [mode, setMode] = useState<ImportMode>(modes[0]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [filter, setFilter] = useState<'issues' | 'all'>('issues');
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { data: imports = [] } = useQuery({ queryKey: ['data-imports'], queryFn: settingsApi.imports });

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (err) { notify.error(errorMessage(err, 'Opération impossible')); } finally { setBusy(null); }
  };
  const reset = () => { setFile(null); setPreview(null); setMapping(null); setMappingDirty(false); if (input.current) input.current.value = ''; };
  const runPreview = (f: File, m: Record<string, string> | null, md: ImportMode) => run('preview', async () => {
    const p = await settingsApi.importPreview(entity, f, { mapping: m, mode: md });
    setPreview(p); setMapping(p.mapping); setMappingDirty(false);
  });
  const pick = (f: File | null) => { reset(); if (f) { setFile(f); runPreview(f, null, mode); } };
  const commit = () => file && run('commit', async () => {
    const r = await settingsApi.importCommit(entity, file, { mapping, mode });
    notify.success(`Import terminé : ${r.created} création(s), ${r.updated} mise(s) à jour`);
    reset();
    qc.invalidateQueries({ queryKey: ['data-status'] }); qc.invalidateQueries({ queryKey: ['data-imports'] }); qc.invalidateQueries();
  });
  const undo = async (id: string, label: string) => {
    if (!(await confirm(`Annuler l'import « ${label} » ? Les fiches créées seront supprimées (ou désactivées si elles sont déjà utilisées) et les valeurs modifiées remises comme avant.`))) return;
    run(`undo:${id}`, async () => {
      const r = await settingsApi.undoImport(id);
      notify.success(`Import annulé : ${r.deleted} supprimée(s), ${r.deactivated} désactivée(s), ${r.restored} remise(s) en l'état`);
      qc.invalidateQueries();
    });
  };

  const rows = preview ? (filter === 'all' ? preview.rows : preview.rows.filter(r => r.action === 'error')) : [];
  const usedTargets = new Set(Object.values(mapping ?? {}).filter(Boolean));
  const missingRequired = preview ? preview.fields.filter(f => f.required && !f.custom && !usedTargets.has(f.key) && mode !== 'update') : [];
  const card: React.CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg)' };

  return (
    <>
      <section style={card}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Upload size={15} /> Importer des données</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          Téléchargez le modèle ou partez de votre propre fichier Excel ou CSV : vous associez ses colonnes aux champs de la fiche,
          chaque ligne est contrôlée, puis tout est importé d'un coup (ou rien s'il reste une erreur). Chaque import s'annule depuis le journal.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label="Données à importer" value={entity} style={select}
            onChange={e => { const k = e.target.value; setEntity(k); const m = (status.entities.find(x => x.key === k)?.modes ?? ['upsert']) as ImportMode[]; setMode(m[0]); reset(); }}>
            {status.entities.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
          <select aria-label="Mode d'import" value={mode} style={select} disabled={modes.length < 2}
            onChange={e => { const md = e.target.value as ImportMode; setMode(md); if (file) runPreview(file, mapping, md); }}>
            {modes.map(m => <option key={m} value={m}>{MODE_LABELS[m].label}</option>)}
          </select>
          <button className="odoo-btn-secondary" onClick={() => run('tpl', () => onTemplate(entity))} disabled={busy !== null} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FileSpreadsheet size={13} /> Modèle Excel
          </button>
          {canCreate('settings') && (
            <label className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <Upload size={13} /> {file ? file.name : 'Choisir le fichier'}
              <input ref={input} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => pick(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {busy === 'preview' && <Loader2 className="animate-spin" size={16} />}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{MODE_LABELS[mode].hint}{def?.note ? ` · ${def.note}` : ''}</div>

        {preview && mapping && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Colonnes du fichier</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr><th>Colonne du fichier</th><th>Champ de la fiche</th></tr></thead>
                <tbody>{preview.headers.map(h => (
                  <tr key={h}>
                    <td>{h}</td>
                    <td>
                      <select aria-label={`Champ pour la colonne ${h}`} value={mapping[h] ?? ''} style={{ ...select, minWidth: 240 }}
                        onChange={e => { setMapping({ ...mapping, [h]: e.target.value }); setMappingDirty(true); }}>
                        <option value="">— ignorer cette colonne —</option>
                        {preview.fields.map(f => (
                          <option key={f.key} value={f.key} disabled={usedTargets.has(f.key) && mapping[h] !== f.key}>
                            {f.header}{f.required ? ' *' : ''}{f.custom ? ' (champ personnalisé)' : ''}{f.match ? ' (sert à retrouver la fiche)' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {missingRequired.length > 0 && (
              <StatusBanner tone="warning" icon={FileSpreadsheet} title="Champ obligatoire non associé">
                {missingRequired.map(f => f.header).join(', ')} : associez une colonne, sinon les créations seront en erreur.
              </StatusBanner>
            )}
            {mappingDirty && (
              <div><button className="odoo-btn-primary" disabled={busy !== null} onClick={() => file && runPreview(file, mapping, mode)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={13} /> Appliquer et recontrôler
              </button></div>
            )}

            {!mappingDirty && (<>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={ACTION_TAG.create.cls}>{preview.summary.create} création(s)</span>
                <span className={ACTION_TAG.update.cls}>{preview.summary.update} mise(s) à jour</span>
                <span className={ACTION_TAG.error.cls}>{preview.summary.error} erreur(s)</span>
                {preview.summary.skip > 0 && <span className={ACTION_TAG.skip.cls}>{preview.summary.skip} ignorée(s)</span>}
                <div style={{ flex: 1 }} />
                <select aria-label="Lignes affichées" value={filter} onChange={e => setFilter(e.target.value as typeof filter)} style={select}>
                  <option value="issues">Lignes en erreur</option><option value="all">Toutes les lignes</option>
                </select>
              </div>
              {preview.summary.error > 0 && (
                <StatusBanner tone="danger" icon={FileSpreadsheet} title="Corrigez le fichier avant d'importer">
                  Rien n'a été enregistré. Corrigez les lignes ci-dessous (ou l'association des colonnes), puis recontrôlez.
                </StatusBanner>
              )}
              {rows.length > 0 && (
                <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                  <table className="odoo-table">
                    <thead><tr><th style={{ width: 60 }}>Ligne</th><th style={{ width: 120 }}>Résultat</th><th>Données</th><th>Motif</th></tr></thead>
                    <tbody>{rows.map(r => (
                      <tr key={r.line}>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.line}</td>
                        <td><span className={ACTION_TAG[r.action].cls}>{ACTION_TAG[r.action].label}</span></td>
                        <td style={{ fontSize: '0.8125rem' }}>{Object.values(r.values).filter(v => v !== null && v !== '').slice(0, 4).map(String).join(' · ')}</td>
                        <td style={{ fontSize: '0.8125rem', color: r.action === 'error' ? 'var(--odoo-danger, #b3261e)' : 'var(--odoo-text-muted)' }}>
                          {r.errors.length ? r.errors.map(e => `${e.column} : ${e.message}`).join(' ; ') : r.reason ?? ''}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="odoo-btn-secondary" onClick={reset}>Annuler</button>
                <button className="odoo-btn-primary" onClick={commit}
                  disabled={busy !== null || preview.summary.error > 0 || preview.summary.create + preview.summary.update === 0}>
                  {busy === 'commit' ? 'Import…' : `Importer ${preview.summary.create + preview.summary.update} ligne(s)`}
                </button>
              </div>
            </>)}
          </div>
        )}
      </section>

      <section style={card}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><History size={15} /> Journal des imports</div>
        {imports.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 }}>Aucun import enregistré.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>Date</th><th>Données</th><th>Fichier</th><th>Mode</th><th style={{ textAlign: 'right' }}>Créées</th><th style={{ textAlign: 'right' }}>Mises à jour</th><th>Par</th><th>Statut</th><th></th></tr></thead>
              <tbody>{imports.map(i => (
                <tr key={i.id} style={{ opacity: i.status === 'undone' ? 0.6 : 1 }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(i.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{i.entity_label}</td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{i.file_name ?? '—'}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{MODE_LABELS[i.mode].label}</td>
                  <td style={{ textAlign: 'right' }}>{i.created_count}</td>
                  <td style={{ textAlign: 'right' }}>{i.updated_count}</td>
                  <td>{i.by_name ?? '—'}</td>
                  <td>{i.status === 'undone'
                    ? <span className="odoo-tag odoo-tag-grey" title={i.undo_report ? `${i.undo_report.deleted} supprimée(s), ${i.undo_report.deactivated} désactivée(s), ${i.undo_report.restored} remise(s) en l'état` : undefined}>Annulé{i.undone_by_name ? ` par ${i.undone_by_name}` : ''}</span>
                    : <span className="odoo-tag odoo-tag-green">Importé</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {i.can_undo && canEdit('settings') && (
                      <button className="odoo-btn-secondary" style={{ padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={busy !== null}
                        onClick={() => undo(i.id, `${i.entity_label} · ${i.file_name ?? ''}`)}><Undo2 size={12} /> Annuler</button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
