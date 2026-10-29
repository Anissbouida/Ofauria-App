import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ListChecks, Plus, X, Loader2, CheckCircle2, XCircle, Trash2, Power } from 'lucide-react';
import { qualityApi, type QualityTemplate, type QualityItem, type QualityResult, type AppliesTo } from '../../api/quality.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

const APPLIES: Record<AppliesTo, string> = { general: 'Général', reception: 'Réception', production: 'Production', product: 'Produit' };
const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });

export default function QualityTab() {
  const [view, setView] = useState<'inspections' | 'templates'>('inspections');
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={ListChecks} title="Contrôle qualité paramétrable">
        Définissez des modèles d'inspection (points à vérifier, mesures dans une plage), puis enregistrez des inspections qui calculent la conformité. Indépendant des contrôles de réception et de production.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={view === 'inspections' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('inspections')}>Inspections</button>
        <button className={view === 'templates' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('templates')}>Modèles</button>
      </div>
      {view === 'inspections' ? <Inspections /> : <Templates />}
    </div>
  );
}

/* ── Inspections ── */
function Inspections() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['quality', 'inspections'], queryFn: () => qualityApi.inspections() });
  const [newInsp, setNewInsp] = useState(false);
  return (
    <>
      <div><button className="odoo-btn-primary" onClick={() => setNewInsp(true)}><Plus size={14} /> Nouvelle inspection</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Inspection</th><th>Modèle</th><th>Référence</th><th style={{ textAlign: 'center' }}>Conformité</th><th>Par</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune inspection.</td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(r.inspected_on)}</td>
                <td style={{ fontWeight: 500 }}>{r.title}</td>
                <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{r.template_name}</td>
                <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{r.reference_note || '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  {r.conformity
                    ? <span className="odoo-tag odoo-tag-green"><CheckCircle2 size={11} style={{ display: 'inline', verticalAlign: -1, marginRight: 3 }} />Conforme</span>
                    : <span className="odoo-tag odoo-tag-red"><XCircle size={11} style={{ display: 'inline', verticalAlign: -1, marginRight: 3 }} />{r.failed} non conforme{r.failed > 1 ? 's' : ''}</span>}
                </td>
                <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>{r.inspected_by_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {newInsp && <InspectionForm onClose={() => setNewInsp(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['quality'] }); setNewInsp(false); }} />}
    </>
  );
}

function InspectionForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: templates = [] } = useQuery({ queryKey: ['quality', 'templates'], queryFn: qualityApi.templates });
  const activeTemplates = templates.filter(t => t.is_active);
  const [templateId, setTemplateId] = useState('');
  const tpl = activeTemplates.find(t => t.id === templateId) || null;
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  // résultats indexés sur les points du modèle
  const [vals, setVals] = useState<Record<number, { ok: boolean; value: string; note: string }>>({});

  const results = useMemo<QualityResult[]>(() => {
    if (!tpl) return [];
    return tpl.items.map((it, i) => {
      const v = vals[i] || { ok: false, value: '', note: '' };
      let ok = v.ok;
      let value: number | null = null;
      if (it.kind === 'measure') {
        value = v.value === '' ? null : Number(v.value);
        ok = value != null && (it.min == null || value >= it.min) && (it.max == null || value <= it.max);
      }
      return { label: it.label, kind: it.kind, ok, value, note: v.note || null };
    });
  }, [tpl, vals]);
  const conform = results.length > 0 && results.every(r => r.ok);

  const save = useMutation({
    mutationFn: () => qualityApi.createInspection({ templateId: templateId || null, title: title.trim(), referenceNote: reference || null, inspectedOn: date, results, notes: notes || null }),
    onSuccess: () => { notify.success('Inspection enregistrée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const setVal = (i: number, patch: Partial<{ ok: boolean; value: string; note: string }>) =>
    setVals(v => { const cur = v[i] ?? { ok: false, value: '', note: '' }; return { ...v, [i]: { ...cur, ...patch } }; });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(620px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><ListChecks size={16} /> Nouvelle inspection</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Modèle">
              <select value={templateId} onChange={e => { setTemplateId(e.target.value); setVals({}); }} style={inp}>
                <option value="">— Choisir un modèle —</option>
                {activeTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Intitulé"><input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. Lot farine LI-260610" style={inp} /></Field>
            <Field label="Référence (optionnel)"><input type="text" value={reference} onChange={e => setReference(e.target.value)} style={inp} /></Field>
          </div>

          {tpl && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflow: 'hidden' }}>
              <div className="odoo-section-header" style={{ padding: '8px 12px', background: 'var(--theme-bg-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>Points à vérifier</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {tpl.items.map((it, i) => {
                  const r = results[i];
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', padding: '8px 12px', borderTop: i ? '1px solid var(--odoo-border)' : 'none' }}>
                      <div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{it.label}
                          {it.kind === 'measure' && <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontSize: '0.78rem' }}> (attendu {it.min ?? '−∞'} à {it.max ?? '+∞'}{it.unit ? ' ' + it.unit : ''})</span>}
                        </div>
                        <input type="text" value={vals[i]?.note ?? ''} onChange={e => setVal(i, { note: e.target.value })} placeholder="Remarque…" style={{ ...inp, marginTop: 4, fontSize: '0.78rem', padding: '0.3rem 0.5rem' }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'end' }}>
                        {it.kind === 'ok' ? (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={vals[i]?.ok ?? false} onChange={e => setVal(i, { ok: e.target.checked })} style={{ accentColor: 'var(--theme-accent)' }} /> Conforme
                          </label>
                        ) : (
                          <input type="number" step="any" value={vals[i]?.value ?? ''} onChange={e => setVal(i, { value: e.target.value })} placeholder={it.unit || 'valeur'} style={{ ...inp, width: 110 }} />
                        )}
                        {r && (vals[i]?.value || vals[i]?.ok || it.kind === 'ok') && (r.ok ? <CheckCircle2 size={16} style={{ color: '#15803d' }} /> : <XCircle size={16} style={{ color: '#dc2626' }} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <Field label="Notes (optionnel)"><textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp, minHeight: 56 }} /></Field>
          {tpl && <div style={{ fontWeight: 600, color: conform ? '#15803d' : '#dc2626' }}>Résultat : {conform ? 'Conforme' : 'Non conforme'}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!tpl || !title.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Enregistrer
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ── Modèles ── */
function Templates() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['quality', 'templates'], queryFn: qualityApi.templates });
  const [editing, setEditing] = useState<QualityTemplate | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => qualityApi.setTemplateActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quality', 'templates'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      <div><button className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Nouveau modèle</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Modèle</th><th>S'applique à</th><th style={{ textAlign: 'right' }}>Points</th><th style={{ textAlign: 'right' }}>Inspections</th><th>État</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun modèle. Créez-en un pour commencer.</td></tr>}
            {rows.map(t => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(t)}>
                <td style={{ fontWeight: 500 }}>{t.name}</td>
                <td>{APPLIES[t.applies_to]}</td>
                <td style={{ textAlign: 'right' }}>{t.items.length}</td>
                <td style={{ textAlign: 'right' }}>{t.inspections_count}</td>
                <td><span className={`odoo-tag ${t.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{t.is_active ? 'Actif' : 'Inactif'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                    onClick={e => { e.stopPropagation(); toggle.mutate({ id: t.id, active: !t.is_active }); }} title={t.is_active ? 'Désactiver' : 'Activer'}>
                    <Power size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <TemplateForm tpl={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['quality', 'templates'] }); setEditing(null); }} />}
    </>
  );
}

function TemplateForm({ tpl, onClose, onSaved }: { tpl: QualityTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tpl?.name ?? '');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(tpl?.applies_to ?? 'general');
  const [items, setItems] = useState<QualityItem[]>(tpl?.items ?? [{ label: '', kind: 'ok' }]);

  const save = useMutation({
    mutationFn: () => {
      const clean = items.filter(i => i.label.trim());
      return tpl ? qualityApi.updateTemplate(tpl.id, { name: name.trim(), appliesTo, items: clean })
                 : qualityApi.createTemplate({ name: name.trim(), appliesTo, items: clean });
    },
    onSuccess: () => { notify.success(tpl ? 'Modèle enregistré' : 'Modèle créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const setItem = (i: number, patch: Partial<QualityItem>) => setItems(a => a.map((it, j) => j === i ? { ...it, ...patch } : it));
  const valid = name.trim().length >= 2 && items.some(i => i.label.trim());

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(640px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><ListChecks size={16} /> {tpl ? 'Modifier le modèle' : 'Nouveau modèle'}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Nom du modèle"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Réception matière première" style={inp} /></Field>
            <Field label="S'applique à">
              <select value={appliesTo} onChange={e => setAppliesTo(e.target.value as AppliesTo)} style={inp}>
                {(Object.keys(APPLIES) as AppliesTo[]).map(k => <option key={k} value={k}>{APPLIES[k]}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Points à vérifier</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="text" value={it.label} onChange={e => setItem(i, { label: e.target.value })} placeholder="Point à vérifier" style={{ ...inp, flex: 1, minWidth: 160 }} />
                <select value={it.kind} onChange={e => setItem(i, { kind: e.target.value as 'ok' | 'measure' })} style={{ ...inp, width: 150 }}>
                  <option value="ok">Conforme / non</option>
                  <option value="measure">Mesure (plage)</option>
                </select>
                {it.kind === 'measure' && (
                  <>
                    <input type="number" step="any" value={it.min ?? ''} onChange={e => setItem(i, { min: e.target.value === '' ? null : Number(e.target.value) })} placeholder="min" style={{ ...inp, width: 70 }} />
                    <input type="number" step="any" value={it.max ?? ''} onChange={e => setItem(i, { max: e.target.value === '' ? null : Number(e.target.value) })} placeholder="max" style={{ ...inp, width: 70 }} />
                    <input type="text" value={it.unit ?? ''} onChange={e => setItem(i, { unit: e.target.value })} placeholder="unité" style={{ ...inp, width: 70 }} />
                  </>
                )}
                <button type="button" className="odoo-btn-secondary" style={{ padding: '0.3rem 0.4rem' }} onClick={() => setItems(a => a.filter((_, j) => j !== i))} title="Retirer"><Trash2 size={13} /></button>
              </div>
            ))}
            <button type="button" className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setItems(a => [...a, { label: '', kind: 'ok' }])}><Plus size={13} /> Ajouter un point</button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {tpl ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', width: '100%', font: 'inherit' };
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1, minWidth: 180 }}><span style={{ color: 'var(--theme-text-muted)' }}>{label}</span>{children}</label>;
}
