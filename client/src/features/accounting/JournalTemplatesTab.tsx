import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NotebookPen, Plus, Power, Trash2, Play, Pencil } from 'lucide-react';
import { entryTemplatesApi, planComptableApi, journalsApi, type EntryTemplate, type EntryTemplateLine } from '../../api/ledger.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { currencySymbol } from '../../utils/money';
import { LoadingState, DataPanel, EmptyState, ErrorState, TableFooter, HeaderActions, Modal, FormSection, FormField, FormFooter } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { RowMenu } from '../../components/ui/RowMenu';

/** Montant sans devise (la devise est dans l'en-tête de colonne). */
const money = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type EditLine = { account_id: string; side: 'debit' | 'credit'; amount: number; label: string };

/** Modèles d'écritures (mig 391) : structure réutilisable instanciée en OD. Admin / gérant. */
export default function JournalTemplatesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['entry-templates'], queryFn: entryTemplatesApi.list });
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
      <HeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} aria-hidden="true" /> Nouveau modèle</button>
      </HeaderActions>
      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={NotebookPen} title="Aucun modèle d'écriture" text="Créez un modèle pour vos écritures récurrentes : provision, abonnement, OD mensuelle."
          action={<button type="button" className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} aria-hidden="true" /> Nouveau modèle</button>} />
      ) : (
      <DataPanel label="Modèles d'écritures" footer={<TableFooter note={`${rows.length} modèle${rows.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table ds-dense">
          <thead><tr><th>Modèle</th><th>Journal</th><th>Périodicité</th><th className="ds-num">Lignes</th><th className="ds-num">Montant ({currencySymbol()})</th><th>Statut</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.id}>
                <td><button type="button" className="ds-strong" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setEditing(t.id)} title="Modifier le modèle">{t.name}</button></td>
                <td>{t.journal_name || t.journal_code}</td>
                <td>
                  {t.recurrence ? (
                    <>
                      <div>{RECURRENCE_LABEL[t.recurrence]}</div>
                      <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                        {t.next_run_on && (!t.end_on || day(t.next_run_on) <= day(t.end_on)) ? `Prochaine : ${frDate(t.next_run_on)}` : 'Terminée'}
                      </div>
                    </>
                  ) : <span style={{ color: 'var(--ds-muted)' }}>Manuel</span>}
                </td>
                <td className="ds-num">{t.line_count ?? 0}</td>
                <td className="ds-num">{money(Number(t.total_debit || 0))}</td>
                <td><StatusTag tone={t.is_active ? 'done' : 'draft'} label={t.is_active ? 'Actif' : 'Inactif'} /></td>
                <td className="ds-actions">
                  {t.is_active && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setUsing(t)}><Play size={12} aria-hidden="true" /> Utiliser</button>}
                  <RowMenu items={[
                    { label: 'Modifier', icon: Pencil, onSelect: () => setEditing(t.id) },
                    { label: t.is_active ? 'Désactiver' : 'Activer', icon: Power, onSelect: () => toggle.mutate({ id: t.id, active: !t.is_active }) },
                    { label: 'Supprimer', icon: Trash2, danger: true, onSelect: async () => { if (await confirm(`Supprimer le modèle « ${t.name} » ?`, { title: 'Supprimer le modèle', danger: true, confirmLabel: 'Supprimer' })) remove.mutate(t.id); } },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}
      {editing && <TemplateEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { invalidate(); setEditing(null); }} />}
      {using && <UseTemplateModal template={using} onClose={() => setUsing(null)} />}
    </div>
  );
}

const RECURRENCE_LABEL: Record<'monthly' | 'quarterly' | 'yearly', string> = { monthly: 'Mensuelle', quarterly: 'Trimestrielle', yearly: 'Annuelle' };
/** Date civile AAAA-MM-JJ d'une valeur renvoyée par le serveur (date seule ou horodatage). */
const day = (v: string) => (v.length > 10 ? new Date(v).toLocaleDateString('en-CA') : v);
const frDate = (v: string) => day(v).split('-').reverse().join('/');

function TemplateEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const { data: existing } = useQuery({ queryKey: ['entry-template', id], queryFn: () => entryTemplatesApi.getById(id!), enabled: !!id });
  const { data: accounts = [] } = useQuery({ queryKey: ['plan-comptable'], queryFn: () => planComptableApi.list() });
  const { data: journals = [] } = useQuery({ queryKey: ['journals'], queryFn: () => journalsApi.list() });
  const accountOptions = useMemo(() => accounts.map(a => ({ id: a.id, label: `${a.code} — ${a.label}` })), [accounts]);

  const [name, setName] = useState('');
  const [journalCode, setJournalCode] = useState('OD');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<EditLine[]>([]);
  // G1-09 : périodicité du modèle ('' = manuel), première ou prochaine échéance, date de fin.
  const [recurrence, setRecurrence] = useState<'' | 'monthly' | 'quarterly' | 'yearly'>('');
  const [firstRunOn, setFirstRunOn] = useState('');
  const [endOn, setEndOn] = useState('');
  const [loaded, setLoaded] = useState(false);
  if (existing && !loaded) {
    setName(existing.name); setJournalCode(existing.journal_code); setDescription(existing.description || '');
    setRecurrence(existing.recurrence ?? ''); setFirstRunOn(existing.next_run_on ? day(existing.next_run_on) : ''); setEndOn(existing.end_on ? day(existing.end_on) : '');
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
      const payload = {
        name: name.trim(), journalCode, description: description.trim() || null,
        lines: lines.map(l => ({ accountId: l.account_id, side: l.side, amount: round2(Number(l.amount) || 0), label: l.label.trim() || null })),
        recurrence: recurrence || null, firstRunOn: recurrence ? firstRunOn || null : null, endOn: recurrence ? endOn || null : null,
      };
      return id ? entryTemplatesApi.update(id, payload) : entryTemplatesApi.create(payload);
    },
    onSuccess: () => { notify.success(id ? 'Modèle enregistré' : 'Modèle créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const diff = round2(totalDebit - totalCredit);
  return (
    <Modal title={id ? 'Modifier le modèle' : 'Nouveau modèle d’écriture'} onClose={onClose} width={820} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} submitLabel={id ? 'Enregistrer' : 'Créer'}
        disabled={name.trim().length < 2 || !balanced || !complete || (recurrence !== '' && !firstRunOn)} />}>
      <FormSection title="Modèle">
        <div className="ds-form-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <FormField label="Nom" htmlFor="tpl-name" required hint="2 caractères au moins.">
            <input id="tpl-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Provision loyer mensuel" className="ds-input" />
          </FormField>
          <FormField label="Journal" htmlFor="tpl-journal" required>
            <select id="tpl-journal" value={journalCode} onChange={e => setJournalCode(e.target.value)} className="ds-input">
              {journals.map(j => <option key={j.code} value={j.code}>{j.code} — {j.label}</option>)}
              {!journals.some(j => j.code === journalCode) && <option value={journalCode}>{journalCode}</option>}
            </select>
          </FormField>
        </div>
        <FormField label="Note" htmlFor="tpl-desc">
          <input id="tpl-desc" type="text" value={description} onChange={e => setDescription(e.target.value)} className="ds-input" />
        </FormField>
      </FormSection>

      <FormSection title="Périodicité">
        <div className="ds-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <FormField label="Périodicité" htmlFor="tpl-rec">
            <select id="tpl-rec" value={recurrence} onChange={e => setRecurrence(e.target.value as typeof recurrence)} className="ds-input">
              <option value="">Manuel (à utiliser à la demande)</option>
              <option value="monthly">Mensuelle</option>
              <option value="quarterly">Trimestrielle</option>
              <option value="yearly">Annuelle</option>
            </select>
          </FormField>
          {recurrence && (
            <>
              <FormField label={existing?.run_count ? 'Prochaine échéance' : 'Première échéance'} htmlFor="tpl-first" required
                error={!firstRunOn ? 'Indiquez la date de l\'échéance.' : undefined}>
                <input id="tpl-first" type="date" value={firstRunOn} onChange={e => setFirstRunOn(e.target.value)} className="ds-input" />
              </FormField>
              <FormField label="Dernière échéance" htmlFor="tpl-end">
                <input id="tpl-end" type="date" value={endOn} onChange={e => setEndOn(e.target.value)} className="ds-input" />
              </FormField>
            </>
          )}
        </div>
        {recurrence && (
          <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: 0 }}>
            L'écriture est passée automatiquement à chaque échéance, datée de l'échéance, avec les montants du modèle. Une échéance sur une période comptable fermée n'est pas passée : elle est signalée dans Paramètres › Tâches planifiées.
          </p>
        )}
      </FormSection>

      <FormSection title="Lignes">
        <DataPanel label="Lignes du modèle">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Compte</th><th style={{ width: 110 }}>Sens</th><th className="ds-num" style={{ width: 130 }}>Montant ({currencySymbol()})</th><th>Libellé</th><th className="ds-actions" style={{ width: 44 }}><span className="ds-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ minWidth: 200 }}><SearchSelect options={accountOptions} value={l.account_id} onChange={v => setLine(i, { account_id: v })} placeholder="Compte…" width="100%" ariaLabel={`Compte ligne ${i + 1}`} /></td>
                  <td>
                    <select value={l.side} onChange={e => setLine(i, { side: e.target.value as 'debit' | 'credit' })} className="ds-input sm" aria-label={`Sens ligne ${i + 1}`}>
                      <option value="debit">Débit</option>
                      <option value="credit">Crédit</option>
                    </select>
                  </td>
                  <td><input type="number" step="0.01" min="0" value={l.amount || ''} onChange={e => setLine(i, { amount: Number(e.target.value) || 0 })} placeholder="0.00" className="ds-input sm" style={{ textAlign: 'right' }} aria-label={`Montant ligne ${i + 1}`} /></td>
                  <td><input type="text" value={l.label} onChange={e => setLine(i, { label: e.target.value })} placeholder="Libellé" className="ds-input sm" aria-label={`Libellé ligne ${i + 1}`} /></td>
                  <td className="ds-actions"><button type="button" className="ds-icon-btn" disabled={lines.length <= 2} onClick={() => setLines(a => a.filter((_, j) => j !== i))} aria-label={`Supprimer la ligne ${i + 1}`}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setLines(a => [...a, { account_id: '', side: 'debit', amount: 0, label: '' }])}><Plus size={13} /> Ajouter une ligne</button>
                </td>
                <td className="ds-num">D {money(totalDebit)}<br />C {money(totalCredit)}</td>
                <td colSpan={2} style={{ color: balanced ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{balanced ? 'Équilibré' : 'Déséquilibré'}</td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
        {!balanced && (
          <div className="ds-field error"><span className="ds-field-hint" role="alert">
            {totalDebit === 0 && totalCredit === 0 ? 'Saisissez les montants des lignes.' : `Écart de ${money(Math.abs(diff))} ${currencySymbol()} entre le débit et le crédit : le modèle doit être équilibré.`}
          </span></div>
        )}
      </FormSection>
    </Modal>
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

  const diff = round2(totalDebit - totalCredit);
  return (
    <Modal title={`Utiliser « ${template.name} »`} onClose={onClose} width={700} locked={post.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => post.mutate()} busy={post.isPending} disabled={!balanced} submitLabel="Passer l'écriture" />}>
      <FormSection title="Écriture">
        <div className="ds-form-grid" style={{ gridTemplateColumns: '180px minmax(0, 1fr)' }}>
          <FormField label="Date" htmlFor="use-tpl-date" required>
            <input id="use-tpl-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" />
          </FormField>
          <FormField label="Libellé" htmlFor="use-tpl-label">
            <input id="use-tpl-label" type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder={template.name} className="ds-input" />
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Montants">
        <DataPanel label="Lignes de l'écriture">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Compte</th><th>Sens</th><th className="ds-num">Montant ({currencySymbol()})</th></tr></thead>
            <tbody>{lines.map(l => (
              <tr key={l.id}>
                <td><span className="ds-ref">{l.account_code}</span> — {l.account_name}</td>
                <td>{l.side === 'debit' ? 'Débit' : 'Crédit'}</td>
                <td className="ds-num">
                  <input type="number" step="0.01" min="0" value={amt(l)} onChange={e => l.id && setAmounts(a => ({ ...a, [l.id!]: Number(e.target.value) || 0 }))} className="ds-input sm" style={{ width: 120, textAlign: 'right' }} aria-label={`Montant ${l.account_code}`} />
                </td>
              </tr>
            ))}</tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ color: balanced ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{balanced ? 'Équilibré' : 'Déséquilibré'}</td>
                <td className="ds-num">D {money(totalDebit)} · C {money(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
        {!balanced && lines.length > 0 && (
          <div className="ds-field error"><span className="ds-field-hint" role="alert">
            {totalDebit === 0 ? 'Saisissez les montants des lignes.' : `Écart de ${money(Math.abs(diff))} ${currencySymbol()} entre le débit et le crédit : ajustez les montants.`}
          </span></div>
        )}
      </FormSection>
    </Modal>
  );
}
