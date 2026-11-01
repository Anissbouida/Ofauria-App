import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, Scale, Save, CheckCircle2, Loader2, PenLine } from 'lucide-react';
import SearchSelect from '../../components/ui/SearchSelect';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import {
  planComptableApi, accountAuxiliariesApi, journalsApi, manualEntriesApi,
  type ManualEntryInput, type JournalEntryDetailEx,
} from '../../api/ledger.api';

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
  if (totals.diff !== 0) problems.push(`Écart de ${fmt(Math.abs(totals.diff))} DH`);

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
    onSuccess: (r) => done(`Écriture ${r.entry_number} comptabilisée`),
    onError: (e) => notify.error(apiErrorMessage(e, 'Comptabilisation impossible')),
  });
  const busy = save.isPending || post.isPending;

  const auxOptions = (accountId: string) => auxiliaries.filter(x => x.account_id === accountId)
    .map(x => ({ id: x.id, label: `${x.code} — ${x.label}` }));
  const numCell = { textAlign: 'right' as const, fontFamily: 'ui-monospace, monospace' };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" aria-label="Saisie d'écriture" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1100, maxHeight: '92vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <PenLine size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Écritures</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{draft ? 'Modifier le brouillon' : 'Nouvelle écriture'}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>

        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '220px 150px 1fr', gap: 10, alignItems: 'end' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Journal
            <SearchSelect options={journalOptions} value={journalCode} onChange={v => setJournalCode(v || 'OD')} placeholder="Journal" width="100%" />
          </label>
          <label style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="odoo-search-input" style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Libellé *
            <input value={description} onChange={e => setDescription(e.target.value)} className="odoo-search-input" style={{ width: '100%' }}
              placeholder="Ex. Dotation provision pour créances douteuses" maxLength={2000} autoFocus={!draft} />
          </label>
          <label style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', gridColumn: '1 / 3' }}>Pièce justificative
            <input value={pieceRef} onChange={e => setPieceRef(e.target.value)} className="odoo-search-input" style={{ width: '100%' }}
              placeholder="Ex. PV AGO 2026, relevé n° 12…" maxLength={60} />
          </label>
          <label style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', maxWidth: 180 }}>Date de la pièce
            <input type="date" value={pieceDate} onChange={e => setPieceDate(e.target.value)} className="odoo-search-input" style={{ width: '100%' }} />
          </label>
        </div>

        <table className="odoo-table" style={{ margin: 0, borderTop: '1px solid var(--theme-bg-separator)' }}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th style={{ width: 280 }}>Compte</th>
              <th style={{ width: 230 }}>Tiers</th>
              <th>Libellé</th>
              <th style={{ width: 120, textAlign: 'right' }}>Débit</th>
              <th style={{ width: 120, textAlign: 'right' }}>Crédit</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const collective = !!accountById.get(l.accountId)?.is_collective;
              const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && i === lines.length - 1) { e.preventDefault(); addLine(); } };
              return (
                <tr key={l.key}>
                  <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{i + 1}</td>
                  <td><SearchSelect options={accountOptions} value={l.accountId} onChange={v => setLine(l.key, { accountId: v })} placeholder="Compte…" width="100%" /></td>
                  <td>{collective
                    ? <SearchSelect options={auxOptions(l.accountId)} value={l.auxiliaryId} onChange={v => setLine(l.key, { auxiliaryId: v })} placeholder="Tiers…" width="100%" />
                    : <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>—</span>}</td>
                  <td><input value={l.label} onChange={e => setLine(l.key, { label: e.target.value })} onKeyDown={onKey}
                    className="odoo-search-input" style={{ width: '100%' }} placeholder={description || 'Libellé de la ligne'} maxLength={200} /></td>
                  <td><input value={l.debit} onChange={e => setLine(l.key, { debit: e.target.value })} onKeyDown={onKey} inputMode="decimal"
                    className="odoo-search-input" style={{ width: '100%', ...numCell }} aria-label={`Débit ligne ${i + 1}`} /></td>
                  <td><input value={l.credit} onChange={e => setLine(l.key, { credit: e.target.value })} onKeyDown={onKey} inputMode="decimal"
                    className="odoo-search-input" style={{ width: '100%', ...numCell }} aria-label={`Crédit ligne ${i + 1}`} /></td>
                  <td>
                    <button type="button" className="odoo-pager-btn" onClick={() => removeLine(l.key)} disabled={lines.length <= 2}
                      title="Retirer la ligne" aria-label={`Retirer la ligne ${i + 1}`}><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--theme-bg-secondary)', fontWeight: 600 }}>
              <td colSpan={4}>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button type="button" className="odoo-btn-secondary" onClick={addLine} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Plus size={12} /> Ligne
                  </button>
                  <button type="button" className="odoo-btn-secondary" onClick={balance} disabled={totals.diff === 0}
                    title="Ajoute une ligne du montant manquant" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Scale size={12} /> Équilibrer
                  </button>
                </div>
              </td>
              <td style={numCell}>{fmt(totals.d)}</td>
              <td style={numCell}>{fmt(totals.c)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {problems.length > 0
            ? <StatusBanner tone="warning" icon={Scale} title={problems.length === 1 ? problems[0] : `${problems.length} points à compléter`}>
                {problems.length > 1 ? problems.join(' · ') : 'Le brouillon peut être enregistré en l\'état ; la comptabilisation exige une écriture complète et équilibrée.'}
              </StatusBanner>
            : <StatusBanner tone="success" icon={CheckCircle2} title={`Écriture équilibrée : ${fmt(totals.d)} DH`}>
                À la comptabilisation, elle reçoit son numéro de journal et ne se modifie plus (correction par extourne).
              </StatusBanner>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
            <button type="button" className="odoo-btn-secondary" onClick={() => save.mutate()} disabled={busy || filled.length < 2 || !description.trim()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Enregistrer le brouillon
            </button>
            <button type="button" className="odoo-btn-primary" onClick={() => post.mutate()} disabled={busy || problems.length > 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {post.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Comptabiliser
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}
