import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Scale, Save, CheckCircle2, Loader2 } from 'lucide-react';
import SearchSelect from '../../components/ui/SearchSelect';
import { Modal, FormSection, FormField, FormFooter, DataPanel } from '../../components/ds';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import {
  planComptableApi, accountAuxiliariesApi, journalsApi, manualEntriesApi,
  type ManualEntryInput, type JournalEntryDetailEx,
} from '../../api/ledger.api';
import { currencySymbol } from '../../utils/money';

type Line = { key: number; accountId: string; auxiliaryId: string; label: string; debit: string; credit: string };

const today = () => new Date().toISOString().slice(0, 10);
/** « 1 234,56 » ou « 1234.56 » → centimes (0 si vide ou illisible). */
const toCents = (v: string) => {
  const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const fmt = (cents: number) => (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let seq = 0;
const blank = (): Line => ({ key: ++seq, accountId: '', auxiliaryId: '', label: '', debit: '', credit: '' });

/**
 * Saisie libre d'une écriture (mig 418) : en-tête, pièce justificative et
 * lignes au débit ou au crédit. Brouillon modifiable ou comptabilisation
 * directe ; les contrôles du serveur (équilibre, tiers, période) font foi.
 */
export default function ManualEntryEditor({ draft, onClose }: { draft?: JournalEntryDetailEx | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['plan-comptable'], queryFn: () => planComptableApi.list() });
  const { data: auxiliaries = [] } = useQuery({ queryKey: ['ledger-auxiliaries'], queryFn: () => accountAuxiliariesApi.list() });
  const { data: journals = [] } = useQuery({ queryKey: ['ledger-journals'], queryFn: () => journalsApi.list() });

  const [journalCode, setJournalCode] = useState(draft?.journal_code ?? 'OD');
  const [date, setDate] = useState(draft ? String(draft.entry_date).slice(0, 10) : today());
  const [description, setDescription] = useState(draft?.description ?? '');
  const [pieceRef, setPieceRef] = useState(draft?.piece_ref ?? '');
  const [pieceDate, setPieceDate] = useState(draft?.piece_date ?? '');
  const [lines, setLines] = useState<Line[]>(() => draft?.lines.length
    ? draft.lines.map(l => ({
        key: ++seq, accountId: l.account_id, auxiliaryId: l.auxiliary_id ?? '', label: l.label ?? '',
        debit: Number(l.debit) ? String(l.debit).replace('.', ',') : '', credit: Number(l.credit) ? String(l.credit).replace('.', ',') : '',
      }))
    : [blank(), blank()]);

  const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const accountOptions = useMemo(() => accounts.filter(a => a.is_active !== false)
    .map(a => ({ id: a.id, label: `${a.code} — ${a.label}` })), [accounts]);
  const journalOptions = journals.filter(j => j.kind !== 'opening').map(j => ({ id: j.code, label: `${j.code} — ${j.label}` }));

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) { d += toCents(l.debit); c += toCents(l.credit); }
    return { d, c, diff: d - c };
  }, [lines]);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines(prev => prev.map(l => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      // Un montant au débit OU au crédit : saisir l'un efface l'autre.
      if (patch.debit !== undefined && patch.debit !== '') next.credit = '';
      if (patch.credit !== undefined && patch.credit !== '') next.debit = '';
      if (patch.accountId !== undefined && !accountById.get(patch.accountId)?.is_collective) next.auxiliaryId = '';
      return next;
    }));
  const addLine = () => setLines(prev => [...prev, blank()]);
  const removeLine = (key: number) => setLines(prev => (prev.length > 2 ? prev.filter(l => l.key !== key) : prev));
  /** Ajoute une ligne du montant manquant, du côté qui équilibre. */
  const balance = () => {
    if (totals.diff === 0) return;
    const amount = fmt(Math.abs(totals.diff)).replace(/\s/g, '').replace(/ /g, '');
    setLines(prev => [...prev, { ...blank(), label: description, ...(totals.diff > 0 ? { credit: amount } : { debit: amount }) }]);
  };

  // Problèmes visibles avant envoi (le serveur rejoue tous les contrôles).
  const problems: string[] = [];
  const filled = lines.filter(l => l.accountId || toCents(l.debit) || toCents(l.credit));
  if (!description.trim()) problems.push('Libellé de l\'écriture manquant');
  if (filled.length < 2) problems.push('Au moins deux lignes');
  filled.forEach((l, i) => {
    if (!l.accountId) problems.push(`Ligne ${i + 1} : compte manquant`);
    else if (accountById.get(l.accountId)?.is_collective && !l.auxiliaryId) problems.push(`Ligne ${i + 1} : tiers manquant`);
    if (!toCents(l.debit) && !toCents(l.credit)) problems.push(`Ligne ${i + 1} : montant manquant`);
  });
  if (totals.diff !== 0) problems.push(`Écart de ${fmt(Math.abs(totals.diff))} ${currencySymbol()}`);

  const payload = (): ManualEntryInput => ({
    journalCode, date, description: description.trim(),
    pieceRef: pieceRef.trim() || null, pieceDate: pieceDate || null,
    lines: filled.map(l => ({
      accountId: l.accountId, auxiliaryId: l.auxiliaryId || null,
      debit: toCents(l.debit) / 100, credit: toCents(l.credit) / 100, label: l.label.trim() || null,
    })),
  });
  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-entry'] });
    notify.success(message);
    onClose();
  };
  const save = useMutation({
    mutationFn: () => (draft ? manualEntriesApi.updateDraft(draft.id, payload()) : manualEntriesApi.createDraft(payload())),
    onSuccess: () => done('Brouillon enregistré'),
    onError: (e) => notify.error(apiErrorMessage(e, 'Enregistrement impossible')),
  });
  const post = useMutation({
    mutationFn: async () => {
      if (!draft) return manualEntriesApi.createAndPost(payload());
      await manualEntriesApi.updateDraft(draft.id, payload());
      return manualEntriesApi.post(draft.id);
    },
    onSuccess: (r) => done(r.pending_approval
      ? 'Écriture envoyée pour approbation : elle sera comptabilisée par l\'approbateur'
      : `Écriture ${r.entry_number} comptabilisée`),
    onError: (e) => notify.error(apiErrorMessage(e, 'Comptabilisation impossible')),
  });
  const busy = save.isPending || post.isPending;

  const auxOptions = (accountId: string) => auxiliaries.filter(x => x.account_id === accountId)
    .map(x => ({ id: x.id, label: `${x.code} — ${x.label}` }));
  return (
    <Modal title={draft ? 'Modifier le brouillon' : 'Nouvelle écriture'} subtitle="Écritures · saisie libre" onClose={onClose} width={1100} locked={busy}
      label="Saisie d'écriture"
      footer={
        <FormFooter onCancel={onClose} onSubmit={() => post.mutate()} busy={busy} disabled={problems.length > 0} submitLabel="Comptabiliser">
          <button type="button" className="odoo-btn-secondary" onClick={() => save.mutate()} disabled={busy || filled.length < 2 || !description.trim()}>
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Enregistrer le brouillon
          </button>
        </FormFooter>
      }>
      <FormSection title="En-tête">
        <div className="ds-form-grid" style={{ gridTemplateColumns: '220px 160px minmax(0, 1fr)' }}>
          <FormField label="Journal" required>
            <SearchSelect ariaLabel="Journal" options={journalOptions} value={journalCode} onChange={v => setJournalCode(v || 'OD')} placeholder="Journal" width="100%" size="md" />
          </FormField>
          <FormField label="Date" htmlFor="me-date" required>
            <input id="me-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" />
          </FormField>
          <FormField label="Libellé" htmlFor="me-desc" required>
            <input id="me-desc" value={description} onChange={e => setDescription(e.target.value)} className="ds-input"
              placeholder="Ex. Dotation provision pour créances douteuses" maxLength={2000} autoFocus={!draft} />
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Pièce justificative">
        <div className="ds-form-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 180px' }}>
          <FormField label="Référence de la pièce" htmlFor="me-piece">
            <input id="me-piece" value={pieceRef} onChange={e => setPieceRef(e.target.value)} className="ds-input"
              placeholder="Ex. PV AGO 2026, relevé n° 12…" maxLength={60} />
          </FormField>
          <FormField label="Date de la pièce" htmlFor="me-piece-date">
            <input id="me-piece-date" type="date" value={pieceDate} onChange={e => setPieceDate(e.target.value)} className="ds-input" />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Lignes">
        <DataPanel label="Lignes de l'écriture">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th style={{ width: 280 }}>Compte</th>
                <th style={{ width: 230 }}>Tiers</th>
                <th>Libellé</th>
                <th className="ds-num" style={{ width: 120 }}>Débit ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 120 }}>Crédit ({currencySymbol()})</th>
                <th className="ds-actions" style={{ width: 40 }}><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const collective = !!accountById.get(l.accountId)?.is_collective;
                const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && i === lines.length - 1) { e.preventDefault(); addLine(); } };
                return (
                  <tr key={l.key}>
                    <td style={{ color: 'var(--ds-muted)', fontSize: 12 }}>{i + 1}</td>
                    <td><SearchSelect options={accountOptions} value={l.accountId} onChange={v => setLine(l.key, { accountId: v })} placeholder="Compte…" width="100%" ariaLabel={`Compte ligne ${i + 1}`} /></td>
                    <td>{collective
                      ? <SearchSelect options={auxOptions(l.accountId)} value={l.auxiliaryId} onChange={v => setLine(l.key, { auxiliaryId: v })} placeholder="Tiers…" width="100%" ariaLabel={`Tiers ligne ${i + 1}`} />
                      : <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}>—</span>}</td>
                    <td><input value={l.label} onChange={e => setLine(l.key, { label: e.target.value })} onKeyDown={onKey}
                      className="ds-input sm" placeholder={description || 'Libellé de la ligne'} maxLength={200} aria-label={`Libellé ligne ${i + 1}`} /></td>
                    <td><input value={l.debit} onChange={e => setLine(l.key, { debit: e.target.value })} onKeyDown={onKey} inputMode="decimal"
                      className="ds-input sm ds-num" style={{ textAlign: 'right' }} aria-label={`Débit ligne ${i + 1}`} /></td>
                    <td><input value={l.credit} onChange={e => setLine(l.key, { credit: e.target.value })} onKeyDown={onKey} inputMode="decimal"
                      className="ds-input sm ds-num" style={{ textAlign: 'right' }} aria-label={`Crédit ligne ${i + 1}`} /></td>
                    <td className="ds-actions">
                      <button type="button" className="ds-icon-btn" onClick={() => removeLine(l.key)} disabled={lines.length <= 2}
                        title="Retirer la ligne" aria-label={`Retirer la ligne ${i + 1}`}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={addLine}>
                      <Plus size={12} /> Ligne
                    </button>
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={balance} disabled={totals.diff === 0}
                      title="Ajoute une ligne du montant manquant">
                      <Scale size={12} /> Équilibrer
                    </button>
                  </div>
                </td>
                <td className="ds-num ds-strong">{fmt(totals.d)}</td>
                <td className="ds-num ds-strong">{fmt(totals.c)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </DataPanel>
        {totals.diff !== 0 && (
          <div className="ds-field error"><span className="ds-field-hint" role="alert">
            Écriture déséquilibrée : écart de {fmt(Math.abs(totals.diff))} {currencySymbol()} {totals.diff > 0 ? 'au débit' : 'au crédit'} — ajoutez une ligne ou utilisez « Équilibrer ».
          </span></div>
        )}
      </FormSection>

      {problems.length > 0
        ? <StatusBanner tone="warning" icon={Scale} title={problems.length === 1 ? problems[0] : `${problems.length} points à compléter`}>
            {problems.length > 1 ? problems.join(' · ') : 'Le brouillon peut être enregistré en l\'état ; la comptabilisation exige une écriture complète et équilibrée.'}
          </StatusBanner>
        : <StatusBanner tone="success" icon={CheckCircle2} title={`Écriture équilibrée : ${fmt(totals.d)} ${currencySymbol()}`}>
            À la comptabilisation, elle reçoit son numéro de journal et ne se modifie plus (correction par extourne).
          </StatusBanner>}
    </Modal>
  );
}
