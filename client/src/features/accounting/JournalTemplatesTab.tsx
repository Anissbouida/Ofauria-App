import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NotebookPen, Plus, X, Loader2, Power, Trash2, Play } from 'lucide-react';
import { entryTemplatesApi, planComptableApi, journalsApi, type EntryTemplate, type EntryTemplateLine } from '../../api/ledger.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type EditLine = { account_id: string; side: 'debit' | 'credit'; amount: number; label: string };

/** Modèles d'écritures (mig 391) : structure réutilisable instanciée en OD. Admin / gérant. */
export default function JournalTemplatesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['entry-templates'], queryFn: entryTemplatesApi.list });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [using, setUsing] = useState<EntryTemplate | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['entry-templates'] });
  const toggle = useMutation({ mutationFn: (x: { id: string; active: boolean }) => entryTemplatesApi.setActive(x.id, x.active), onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => entryTemplatesApi.remove(id), onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e)) });

  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={NotebookPen} title="Modèles d'écritures">
        Figez la structure d'une écriture récurrente (provision, abonnement, OD mensuelle) : journal, comptes, sens et montants par défaut. À l'usage, choisissez une date, ajustez les montants si besoin — l'écriture équilibrée est passée au journal.
      </StatusBanner>
      <div><button className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Nouveau modèle</button></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Modèle</th><th>Journal</th><th style={{ textAlign: 'right' }}>Lignes</th><th style={{ textAlign: 'right' }}>Montant</th><th>État</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun modèle. Créez-en un pour vos écritures récurrentes.</td></tr>}
            {rows.map(t => (
              <tr key={t.id}>
                <td style={{ fontWeight: 500, cursor: 'pointer' }} onClick={() => setEditing(t.id)}>{t.name}</td>
                <td>{t.journal_name || t.journal_code}</td>
                <td style={{ textAlign: 'right' }}>{t.line_count ?? 0}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(Number(t.total_debit || 0))}</td>
                <td><span className={`odoo-tag ${t.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{t.is_active ? 'Actif' : 'Inactif'}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {t.is_active && <button className="odoo-btn-primary" style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }} onClick={() => setUsing(t)}><Play size={12} /> Utiliser</button>}
                  <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.45rem', marginLeft: 6 }} title={t.is_active ? 'Désactiver' : 'Activer'} onClick={() => toggle.mutate({ id: t.id, active: !t.is_active })}><Power size={12} /></button>
                  <button className="odoo-btn-secondary" style={{ padding: '0.25rem 0.45rem', marginLeft: 6 }} title="Supprimer" onClick={async () => { if (await confirm(`Supprimer le modèle « ${t.name} » ?`, { danger: true })) remove.mutate(t.id); }}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <TemplateEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { invalidate(); setEditing(null); }} />}
      {using && <UseTemplateModal template={using} onClose={() => setUsing(null)} />}
    </div>
  );
}

function TemplateEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const { data: existing } = useQuery({ queryKey: ['entry-template', id], queryFn: () => entryTemplatesApi.getById(id!), enabled: !!id });
  const { data: accounts = [] } = useQuery({ queryKey: ['plan-comptable'], queryFn: () => planComptableApi.list() });
  const { data: journals = [] } = useQuery({ queryKey: ['journals'], queryFn: () => journalsApi.list() });
  const accountOptions = useMemo(() => accounts.map(a => ({ id: a.id, label: `${a.code} — ${a.label}` })), [accounts]);

  const [name, setName] = useState('');
  const [journalCode, setJournalCode] = useState('OD');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<EditLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (existing && !loaded) {
    setName(existing.name); setJournalCode(existing.journal_code); setDescription(existing.description || '');
    setLines((existing.lines || []).map((l: EntryTemplateLine) => ({ account_id: l.account_id, side: l.side, amount: Number(l.amount), label: l.label || '' })));
    setLoaded(true);
  }
  if (!id && !loaded) { setLines([{ account_id: '', side: 'debit', amount: 0, label: '' }, { account_id: '', side: 'credit', amount: 0, label: '' }]); setLoaded(true); }

  const totalDebit = round2(lines.filter(l => l.side === 'debit').reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const totalCredit = round2(lines.filter(l => l.side === 'credit').reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;
  const complete = lines.length >= 2 && lines.every(l => l.account_id);

  const setLine = (i: number, patch: Partial<EditLine>) => setLines(a => a.map((l, j) => j === i ? { ...l, ...patch } : l));
  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), journalCode, description: description.trim() || null, lines: lines.map(l => ({ accountId: l.account_id, side: l.side, amount: round2(Number(l.amount) || 0), label: l.label.trim() || null })) };
      return id ? entryTemplatesApi.update(id, payload) : entryTemplatesApi.create(payload);
    },
    onSuccess: () => { notify.success(id ? 'Modèle enregistré' : 'Modèle créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(760px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><NotebookPen size={16} /> {id ? 'Modifier le modèle' : 'Nouveau modèle d’écriture'}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 2, minWidth: 220 }}><span style={{ color: 'var(--theme-text-muted)' }}>Nom</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Provision loyer mensuel" style={{ ...inp, width: '100%' }} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1, minWidth: 140 }}><span style={{ color: 'var(--theme-text-muted)' }}>Journal</span>
              <select value={journalCode} onChange={e => setJournalCode(e.target.value)} style={{ ...inp, width: '100%' }}>
                {journals.map(j => <option key={j.code} value={j.code}>{j.code} — {j.label}</option>)}
                {!journals.some(j => j.code === journalCode) && <option value={journalCode}>{journalCode}</option>}
              </select>
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Note (optionnel)</span><input type="text" value={description} onChange={e => setDescription(e.target.value)} style={{ ...inp, width: '100%' }} /></label>

          <div style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Lignes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}><SearchSelect options={accountOptions} value={l.account_id} onChange={v => setLine(i, { account_id: v })} placeholder="Compte…" width="100%" /></div>
                <select value={l.side} onChange={e => setLine(i, { side: e.target.value as 'debit' | 'credit' })} style={{ ...inp, width: 100 }}>
                  <option value="debit">Débit</option>
                  <option value="credit">Crédit</option>
                </select>
                <input type="number" step="0.01" min="0" value={l.amount || ''} onChange={e => setLine(i, { amount: Number(e.target.value) || 0 })} placeholder="0.00" style={{ ...inp, width: 110, textAlign: 'right' }} />
                <input type="text" value={l.label} onChange={e => setLine(i, { label: e.target.value })} placeholder="Libellé" style={{ ...inp, flex: 1, minWidth: 120 }} />
                <button className="odoo-btn-secondary" style={{ padding: '0.3rem 0.4rem' }} disabled={lines.length <= 2} onClick={() => setLines(a => a.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
            <button className="odoo-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setLines(a => [...a, { account_id: '', side: 'debit', amount: 0, label: '' }])}><Plus size={13} /> Ajouter une ligne</button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: '0.85rem', borderTop: '1px solid var(--odoo-border)', paddingTop: 10 }}>
            <span style={{ color: 'var(--theme-text-muted)' }}>Débit {money(totalDebit)}</span>
            <span style={{ color: 'var(--theme-text-muted)' }}>Crédit {money(totalCredit)}</span>
            <span style={{ fontWeight: 600, color: balanced ? '#28a745' : '#dc3545' }}>{balanced ? 'Équilibré' : 'Déséquilibré'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={name.trim().length < 2 || !balanced || !complete || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {id ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function UseTemplateModal({ template, onClose }: { template: EntryTemplate; onClose: () => void }) {
  const { data: full } = useQuery({ queryKey: ['entry-template', template.id], queryFn: () => entryTemplatesApi.getById(template.id) });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const lines = full?.lines || [];
  const amt = (l: EntryTemplateLine) => (l.id && amounts[l.id] !== undefined ? amounts[l.id] : Number(l.amount));
  const totalDebit = round2(lines.filter(l => l.side === 'debit').reduce((s, l) => s + (Number(amt(l)) || 0), 0));
  const totalCredit = round2(lines.filter(l => l.side === 'credit').reduce((s, l) => s + (Number(amt(l)) || 0), 0));
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const post = useMutation({
    mutationFn: () => entryTemplatesApi.instantiate(template.id, { date, label: label.trim() || null, amounts: Object.keys(amounts).length ? amounts : undefined }),
    onSuccess: (r) => { notify.success(`Écriture ${r.entry_number} passée au journal`); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(680px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Play size={16} /> Utiliser « {template.name} »</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', flex: 1, minWidth: 200 }}><span style={{ color: 'var(--theme-text-muted)' }}>Libellé (optionnel)</span><input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder={template.name} style={{ ...inp, width: '100%' }} /></label>
          </div>
          <table className="odoo-table">
            <thead><tr><th>Compte</th><th>Sens</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody>{lines.map(l => (
              <tr key={l.id}>
                <td>{l.account_code} — {l.account_name}</td>
                <td>{l.side === 'debit' ? 'Débit' : 'Crédit'}</td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" step="0.01" min="0" value={amt(l)} onChange={e => l.id && setAmounts(a => ({ ...a, [l.id!]: Number(e.target.value) || 0 }))} style={{ ...inp, width: 120, textAlign: 'right' }} />
                </td>
              </tr>
            ))}</tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--theme-text-muted)' }}>Débit {money(totalDebit)}</span>
            <span style={{ color: 'var(--theme-text-muted)' }}>Crédit {money(totalCredit)}</span>
            <span style={{ fontWeight: 600, color: balanced ? '#28a745' : '#dc3545' }}>{balanced ? 'Équilibré' : 'Déséquilibré'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!balanced || post.isPending} onClick={() => post.mutate()}>{post.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Passer l'écriture</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
