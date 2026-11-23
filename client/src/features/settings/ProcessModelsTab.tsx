import { useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2 } from 'lucide-react';
import { settingsApi, type ProcessCatalog, type ProcessModel, type ProcessStage } from '../../api/settings.api';
import { Alert, DataPanel, EmptyState, FormField, FormFooter, LoadingState, Modal } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { SettingsSection } from './SettingsPrimitives';
import ParametersPanel from './ParametersPanel';

/**
 * Parcours configurables (plan d'exécution multi-industries, étape 5).
 *
 * Un parcours par type d'ordre, composé à partir du catalogue fermé (gardes, actions,
 * conditions). On modifie un BROUILLON ; la publication remplace la version en vigueur.
 * Le moteur s'allume par la politique « Moteur de parcours configurable » : en ombre il
 * journalise ses désaccords avec le parcours historique, en actif il décide.
 */
const TECH_LABELS: Record<string, string> = {
  draft: 'Brouillon', confirmed: 'Confirmé', awaiting_ingredients: 'Attente matières',
  ready_to_produce: 'Prêt à produire', in_progress: 'En cours', completed: 'Terminé',
};
const DOC_LABELS: Record<string, string> = {
  ordre_fabrication: 'Ordre de fabrication', bon_sortie: 'Bon de sortie', fiche_suivi: 'Fiche de suivi',
  rapport_production: 'Rapport de production', bon_transfert: 'Bon de transfert', certificat_conformite: 'Certificat de conformité',
  fiche_controle: 'Fiche de contrôle', etiquette_lot: 'Étiquette de lot',
};
const errMsg = (e: unknown) => {
  const err = (e as { response?: { data?: { error?: { message?: string; details?: string[] } } } })?.response?.data?.error;
  return [err?.message ?? 'Opération impossible', ...(err?.details ?? [])].join(' — ');
};
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'e_$1').slice(0, 40) || 'etape';
const blankStage = (n: number): ProcessStage => ({
  code: `etape_${n}`, label: '', techStatus: 'in_progress', guards: [], actions: [], documentKey: null,
  responsibleRole: null, delayMinutes: null, conditionKey: null, parallelGroup: null, requiredFields: [], allowResume: true,
});

type EditorValue = { orderType: string; orderTypeLabel: string; label: string; stages: ProcessStage[] };

export default function ProcessModelsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['process-models'], queryFn: settingsApi.processModels });
  const { data: shadow = [] } = useQuery({ queryKey: ['process-shadow-log'], queryFn: settingsApi.processShadowLog });
  const [editing, setEditing] = useState<EditorValue | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['process-models'] });

  const save = useMutation({
    mutationFn: (e: EditorValue) => settingsApi.saveProcessDraft(e.orderType, { label: e.label, stages: e.stages }),
    onSuccess: () => { refresh(); setEditing(null); notify.success('Brouillon enregistré'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });
  const publish = useMutation({
    mutationFn: (id: number) => settingsApi.publishProcess(id),
    onSuccess: () => { refresh(); notify.success('Parcours publié : les ordres confirmés ensuite le suivent'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });
  const discard = useMutation({
    mutationFn: (id: number) => settingsApi.discardProcessDraft(id),
    onSuccess: () => { refresh(); notify.success('Brouillon abandonné'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });

  if (isLoading || !data) return <LoadingState />;
  const open = (code: string, label: string, base: ProcessModel | null) =>
    setEditing({ orderType: code, orderTypeLabel: label, label: base?.label ?? 'Parcours', stages: (base?.stages ?? []).map(s => ({ ...s })) });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <ParametersPanel keys={['production.process_engine']} />

      <SettingsSection title="Parcours par type d'ordre" columns={1}
        description="Chaque type d'ordre suit un parcours d'étapes. Une étape se rattache à un état de l'ordre, porte ses conditions de passage (gardes), ses actions et son document. Modifier crée un brouillon ; publier le met en vigueur pour les ordres confirmés ensuite.">
        <DataPanel label="Parcours">
          <table className="odoo-table">
            <thead><tr><th>Type d'ordre</th><th>Parcours en vigueur</th><th>Étapes</th><th>Brouillon</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.orderTypes.map(t => (
                <tr key={t.orderTypeCode}>
                  <td className="ds-strong">{t.orderTypeLabel}</td>
                  <td>{t.published ? <>{t.published.label} <span className="odoo-setting-help">v{t.published.versionNo}</span></> : '—'}</td>
                  <td><StageStrip stages={t.published?.stages ?? []} /></td>
                  <td>{t.draft ? <StatusTag tone="progress" label={`v${t.draft.versionNo} en cours`} /> : '—'}</td>
                  <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                    {t.draft && <>
                      <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={publish.isPending} onClick={() => publish.mutate(t.draft!.id)}>Publier</button>{' '}
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={discard.isPending} onClick={() => discard.mutate(t.draft!.id)}>Abandonner</button>{' '}
                    </>}
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => open(t.orderTypeCode, t.orderTypeLabel, t.draft ?? t.published)}>
                      {t.draft ? 'Modifier le brouillon' : 'Modifier'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      </SettingsSection>

      <SettingsSection title="Journal du mode ombre" columns={1}
        description="Désaccords entre le moteur de parcours et le parcours historique. Passer en mode actif seulement après une période réelle sans désaccord.">
        {shadow.length === 0
          ? <EmptyState icon={GitBranch} title="Aucun désaccord enregistré" bare />
          : (
            <DataPanel label="Journal du mode ombre">
              <table className="odoo-table">
                <thead><tr><th>Date</th><th>Ordre</th><th>Étape</th><th>Moteur</th><th>Historique</th><th>Motifs du moteur</th></tr></thead>
                <tbody>
                  {shadow.map(r => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleString('fr-FR')}</td>
                      <td>{r.of_number ?? r.plan_id.slice(0, 8)}</td>
                      <td>{r.transition}</td>
                      <td><StatusTag tone={r.engine_allows ? 'done' : 'cancelled'} label={r.engine_allows ? 'Autorise' : 'Refuse'} /></td>
                      <td><StatusTag tone={r.legacy_allows ? 'done' : 'cancelled'} label={r.legacy_allows ? 'Autorise' : 'Refuse'} /></td>
                      <td>{r.engine_reasons.join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          )}
      </SettingsSection>

      {editing && (
        <StageEditor catalog={data.catalog} value={editing} busy={save.isPending}
          onChange={setEditing} onCancel={() => setEditing(null)} onSave={() => save.mutate(editing)} />
      )}
    </div>
  );
}

function StageStrip({ stages }: { stages: ProcessStage[] }) {
  if (!stages.length) return <>—</>;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {stages.map((s, i) => (
        <span key={s.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className={`odoo-tag ${s.parallelGroup ? 'odoo-tag-teal' : s.conditionKey ? 'odoo-tag-gold' : 'odoo-tag-blue'}`}
            title={[s.guards.length ? `Gardes : ${s.guards.join(', ')}` : '', s.conditionKey ? `Si : ${s.conditionKey}` : '', s.parallelGroup ? `Parallèle : ${s.parallelGroup}` : ''].filter(Boolean).join(' — ') || undefined}>
            {s.label}
          </span>
          {i < stages.length - 1 && <span aria-hidden="true" className="odoo-setting-help">›</span>}
        </span>
      ))}
    </span>
  );
}

function StageEditor({ catalog, value, busy, onChange, onCancel, onSave }: {
  catalog: ProcessCatalog; value: EditorValue; busy: boolean;
  onChange: (v: EditorValue) => void; onCancel: () => void; onSave: () => void;
}) {
  const [sel, setSel] = useState(0);
  const stages = value.stages;
  const st = stages[sel];
  const set = (patch: Partial<ProcessStage>) => onChange({ ...value, stages: stages.map((s, i) => i === sel ? { ...s, ...patch } : s) });
  const move = (d: -1 | 1) => {
    const j = sel + d; if (j < 0 || j >= stages.length) return;
    const next = [...stages]; [next[sel], next[j]] = [next[j], next[sel]];
    onChange({ ...value, stages: next }); setSel(j);
  };
  const add = () => { onChange({ ...value, stages: [...stages, blankStage(stages.length + 1)] }); setSel(stages.length); };
  const remove = () => { onChange({ ...value, stages: stages.filter((_, i) => i !== sel) }); setSel(Math.max(0, sel - 1)); };
  const toggle = (key: 'guards' | 'actions', k: string) =>
    set({ [key]: st[key].includes(k) ? st[key].filter(x => x !== k) : [...st[key], k] } as Partial<ProcessStage>);
  const box: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' };
  const missing = stages.some(s => !s.label.trim());

  return (
    <Modal title={`Parcours — ${value.orderTypeLabel}`} subtitle="Brouillon : rien ne change pour les ordres tant qu'il n'est pas publié."
      onClose={onCancel} width={960} locked={busy}
      footer={<FormFooter onCancel={onCancel} busy={busy} disabled={missing || stages.length < 2} submitLabel="Enregistrer le brouillon" onSubmit={onSave} />}>
      <div style={{ display: 'grid', gap: 14 }}>
        <FormField label="Nom du parcours" htmlFor="proc-label" required>
          <input id="proc-label" className="ds-input" value={value.label} onChange={e => onChange({ ...value, label: e.target.value })} />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }} aria-label="Étapes du parcours">
              {stages.map((s, i) => (
                <li key={i}>
                  <button type="button" onClick={() => setSel(i)} aria-current={i === sel || undefined}
                    className={i === sel ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
                    style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', display: 'flex', gap: 6 }}>
                    <span style={{ opacity: 0.7 }}>{i + 1}.</span> {s.label || <em>Sans libellé</em>}
                    {s.parallelGroup && <span className="odoo-tag odoo-tag-teal" style={{ marginLeft: 'auto' }}>∥</span>}
                  </button>
                </li>
              ))}
            </ol>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={add}><Plus size={12} /> Étape</button>
              <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => move(-1)} disabled={sel === 0} aria-label="Monter l'étape"><ArrowUp size={12} /></button>
              <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => move(1)} disabled={sel >= stages.length - 1} aria-label="Descendre l'étape"><ArrowDown size={12} /></button>
              <button type="button" className="ds-btn-danger ds-btn-sm" onClick={remove} disabled={stages.length <= 1} aria-label="Supprimer l'étape"><Trash2 size={12} /></button>
            </div>
          </div>

          {st ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <FormField label="Libellé" htmlFor="st-label" required>
                  <input id="st-label" className="ds-input" value={st.label}
                    onChange={e => set({ label: e.target.value, ...(st.id ? {} : { code: slug(e.target.value) }) })} />
                </FormField>
                <FormField label="Code" htmlFor="st-code">
                  <input id="st-code" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} value={st.code} onChange={e => set({ code: e.target.value })} />
                </FormField>
                <FormField label="État de l'ordre" htmlFor="st-tech">
                  <select id="st-tech" className="ds-input" value={st.techStatus} onChange={e => set({ techStatus: e.target.value })}>
                    {catalog.techStatuses.map(t => <option key={t} value={t}>{TECH_LABELS[t] ?? t}</option>)}
                  </select>
                </FormField>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <FormField label="Document" htmlFor="st-doc">
                  <select id="st-doc" className="ds-input" value={st.documentKey ?? ''} onChange={e => set({ documentKey: e.target.value || null })}>
                    <option value="">Aucun</option>
                    {catalog.documents.map(d => <option key={d} value={d}>{DOC_LABELS[d] ?? d}</option>)}
                  </select>
                </FormField>
                <FormField label="Condition" htmlFor="st-cond" hint="Étape sautée si fausse">
                  <select id="st-cond" className="ds-input" value={st.conditionKey ?? ''} onChange={e => set({ conditionKey: e.target.value || null })}>
                    <option value="">Toujours</option>
                    {catalog.conditions.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </FormField>
                <FormField label="Groupe parallèle" htmlFor="st-par" hint="Même nom = en même temps">
                  <input id="st-par" className="ds-input" value={st.parallelGroup ?? ''} onChange={e => set({ parallelGroup: e.target.value || null })} />
                </FormField>
                <FormField label="Délai (min)" htmlFor="st-delay">
                  <input id="st-delay" className="ds-input" type="number" min={0} value={st.delayMinutes ?? ''}
                    onChange={e => set({ delayMinutes: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))) })} />
                </FormField>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <fieldset className="ds-fieldset"><legend>Conditions de passage (gardes)</legend>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {catalog.guards.map(g => (
                      <label key={g.key} style={box}>
                        <input type="checkbox" checked={st.guards.includes(g.key)} onChange={() => toggle('guards', g.key)} />
                        <span><span className="ds-strong">{g.label}</span><br /><span className="odoo-setting-help">{g.description}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="ds-fieldset"><legend>Actions</legend>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {catalog.actions.map(a => (
                      <label key={a.key} style={box}>
                        <input type="checkbox" checked={st.actions.includes(a.key)} onChange={() => toggle('actions', a.key)} />
                        <span><span className="ds-strong">{a.label}</span><br /><span className="odoo-setting-help">{a.description}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          ) : <Alert tone="info">Ajoutez une étape.</Alert>}
        </div>
      </div>
    </Modal>
  );
}
