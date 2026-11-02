import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Link2, Unlink, Lock, Calendar, CheckCircle2, Info, Wand2 } from 'lucide-react';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { lettrageApi } from '../../api/ledger.api';
import type { LettrageLine, LettrageStatus } from '../../api/ledger.api';

/**
 * Lettrage manuel (mig 420) : sur un compte de tiers (et un tiers pour un
 * collectif), on coche des factures et des règlements qui se soldent et on
 * les lettre ensemble ; ce qui reste non lettré est ce qui reste dû.
 */

const cents = (v: string | number) => Math.round((Number(v) || 0) * 100);
function n(v: string | number): string {
  const num = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(num) || num === 0) return '';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function sign(c: number): string {
  const abs = n(Math.abs(c) / 100);
  return abs ? `${abs} ${c >= 0 ? 'D' : 'C'}` : '0,00';
}
function fmtDate(raw: string | null): string {
  if (!raw) return '';
  const [y, m, d] = String(raw).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
const STATUS_LABELS: Record<LettrageStatus, string> = { open: 'À lettrer', lettered: 'Lettrées', all: 'Toutes' };
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' } as const;

export default function LettrageTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [accountId, setAccountId] = useState('');
  const [auxiliaryId, setAuxiliaryId] = useState('');
  const [status, setStatus] = useState<LettrageStatus>('open');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const accountsQ = useQuery({ queryKey: ['lettrage-accounts'], queryFn: lettrageApi.accounts });
  const account = accountsQ.data?.find(a => a.id === accountId);

  // Premier affichage : le compte fournisseurs, sinon le premier compte à lettrer.
  useEffect(() => {
    if (accountId || !accountsQ.data?.length) return;
    const first = accountsQ.data.find(a => a.code === '4411') ?? accountsQ.data.find(a => a.open_lines > 0) ?? accountsQ.data[0];
    setAccountId(first.id);
  }, [accountsQ.data, accountId]);

  const tiersQ = useQuery({
    queryKey: ['lettrage-tiers', accountId],
    queryFn: () => lettrageApi.tiers(accountId),
    enabled: !!account?.is_collective,
  });

  const ready = !!account && (!account.is_collective || !!auxiliaryId);
  const linesQ = useQuery({
    queryKey: ['lettrage-lines', accountId, auxiliaryId, status, from, to],
    queryFn: () => lettrageApi.lines({ accountId, auxiliaryId: auxiliaryId || undefined, status, from: from || undefined, to: to || undefined }),
    enabled: ready,
  });
  useEffect(() => setSelected(new Set()), [accountId, auxiliaryId, status, from, to]);

  const lines = useMemo(() => {
    const all = linesQ.data?.lines ?? [];
    // Vue « Lettrées » : groupes regroupés (A, B…), puis par date.
    return status === 'lettered' ? [...all].sort((a, b) => (a.code ?? '').length - (b.code ?? '').length || (a.code ?? '').localeCompare(b.code ?? '') || a.entry_date.localeCompare(b.entry_date)) : all;
  }, [linesQ.data, status]);
  const groupSize = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linesQ.data?.lines ?? []) if (l.lettrage_id) m.set(l.lettrage_id, (m.get(l.lettrage_id) ?? 0) + 1);
    return m;
  }, [linesQ.data]);

  const selectable = (l: LettrageLine) => !l.lettrage_id && !l.frozen;
  const selectableLines = lines.filter(selectable);
  const sel = lines.filter(l => selected.has(l.id));
  const selDebit = sel.reduce((s, l) => s + cents(l.debit), 0);
  const selCredit = sel.reduce((s, l) => s + cents(l.credit), 0);
  const ecart = selDebit - selCredit;
  const canLetter = sel.length >= 2 && ecart === 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lettrage-lines'] });
    qc.invalidateQueries({ queryKey: ['lettrage-accounts'] });
    qc.invalidateQueries({ queryKey: ['lettrage-tiers'] });
    qc.invalidateQueries({ queryKey: ['lettrage-auto'] });
  };
  const letterMut = useMutation({
    mutationFn: () => lettrageApi.letter([...selected]),
    onSuccess: (r) => { notify.success(`${r.lines} lignes lettrées`); setSelected(new Set()); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Lettrage impossible')),
  });
  const unletterMut = useMutation({
    mutationFn: (id: string) => lettrageApi.unletter(id),
    onSuccess: (r) => { notify.success(`Groupe délettré : ${r.lines} lignes redeviennent à lettrer`); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Délettrage impossible')),
  });
  // Lettrage automatique facture ↔ règlements (compte collectif ; un tiers ou tout le compte).
  const autoScope = { accountId, auxiliaryId: auxiliaryId || undefined };
  const autoQ = useQuery({
    queryKey: ['lettrage-auto', accountId, auxiliaryId],
    queryFn: () => lettrageApi.autoPreview(autoScope),
    enabled: !!account?.is_collective,
  });
  const autoMut = useMutation({
    mutationFn: () => lettrageApi.auto(autoScope),
    onSuccess: (r) => { notify.success(`${r.invoices} facture(s) lettrée(s) avec leurs règlements (${r.lines} lignes)`); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Lettrage automatique impossible')),
  });
  const askAuto = async () => {
    const scope = auxiliaryId ? (tiersQ.data?.find(x => x.id === auxiliaryId)?.label ?? 'ce tiers') : `tout le compte ${account?.code}`;
    if (await confirm(`Lettrer ${autoQ.data?.invoices} facture(s) avec leurs règlements sur ${scope} ?\nChaque groupe pourra être délettré ensuite.`,
      { title: 'Lettrage automatique', confirmLabel: 'Lettrer' })) autoMut.mutate();
  };
  const askUnletter = async (l: LettrageLine) => {
    const size = groupSize.get(l.lettrage_id!) ?? 0;
    if (await confirm(`Délettrer le groupe ${l.code} ? Ses ${size} lignes redeviendront à lettrer.`, { title: 'Délettrage', confirmLabel: 'Délettrer' })) {
      unletterMut.mutate(l.lettrage_id!);
    }
  };

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = selectableLines.length > 0 && selectableLines.every(l => selected.has(l.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectableLines.map(l => l.id)));

  const t = linesQ.data?.totals;
  const openBalance = t ? cents(t.open_debit) - cents(t.open_credit) : 0;

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <SearchSelect
          options={(accountsQ.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.label}`, sublabel: a.open_lines ? `${a.open_lines} ligne(s) à lettrer` : 'Tout est lettré' }))}
          value={accountId}
          onChange={id => { setAccountId(id); setAuxiliaryId(''); }}
          placeholder="Compte à lettrer"
          width={280}
        />
        {account?.is_collective && (
          <SearchSelect
            options={(tiersQ.data ?? []).map(x => ({ id: x.id, label: x.label, sublabel: `${x.code} · ${x.open_lines ? `${x.open_lines} à lettrer · reste ${sign(cents(x.open_balance))}` : 'soldé'}` }))}
            value={auxiliaryId}
            onChange={setAuxiliaryId}
            placeholder={account.auxiliary_kind === 'customer' ? 'Choisir le client' : 'Choisir le fournisseur'}
            width={260}
          />
        )}
        <div style={{ display: 'inline-flex', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, overflow: 'hidden' }}>
          {(Object.keys(STATUS_LABELS) as LettrageStatus[]).map(s => (
            <button key={s} type="button" onClick={() => setStatus(s)}
              className={status === s ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
              style={{ borderRadius: 0, border: 'none', fontSize: '0.75rem' }}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="odoo-search-input" style={{ width: 140 }} aria-label="Du" />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="odoo-search-input" style={{ width: 140 }} aria-label="Au" />
        </div>
      </div>

      {!!autoQ.data?.invoices && (
        <StatusBanner tone="orange" icon={Wand2}
          title={`${autoQ.data.invoices} facture(s) soldée(s) par leurs règlements, non lettrée(s)`}
          actions={<button type="button" className="odoo-btn-primary" disabled={autoMut.isPending} onClick={askAuto}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {autoMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Lettrer automatiquement
          </button>}>
          {auxiliaryId ? 'Sur ce tiers' : 'Sur tout le compte'}, chaque facture et ses règlements se compensent exactement d'après le lien des pièces : ils peuvent être lettrés d'un coup.
        </StatusBanner>
      )}

      {!ready ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Link2 size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>
            {accountsQ.isLoading ? 'Chargement…' : account?.is_collective ? 'Choisissez le tiers dont vous voulez lettrer le compte.' : 'Choisissez un compte de tiers.'}
          </p>
        </div>
      ) : linesQ.isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : linesQ.data && (
        <>
          <div className="odoo-stat-grid">
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Reste à lettrer</div>
              <div className="odoo-stat-card-value" style={{ color: openBalance === 0 ? '#2e7d32' : openBalance > 0 ? '#1565c0' : '#c62828' }}>{sign(openBalance)}</div>
              <div className="odoo-stat-card-sub">{t!.open_lines} ligne(s) non lettrée(s)</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Non lettré débit</div>
              <div className="odoo-stat-card-value" style={{ color: '#1565c0' }}>{n(t!.open_debit) || '0,00'}</div>
              <div className="odoo-stat-card-sub">DH</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Non lettré crédit</div>
              <div className="odoo-stat-card-value" style={{ color: '#c62828' }}>{n(t!.open_credit) || '0,00'}</div>
              <div className="odoo-stat-card-sub">DH</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Groupes lettrés</div>
              <div className="odoo-stat-card-value">{t!.groups}</div>
              <div className="odoo-stat-card-sub">factures ↔ règlements</div>
            </div>
          </div>

          {t!.open_lines > 1 && openBalance === 0 && status !== 'lettered' && (
            <StatusBanner tone="info" icon={CheckCircle2} title="Le compte est soldé"
              actions={<button type="button" className="odoo-btn-secondary" onClick={() => setSelected(new Set(selectableLines.map(l => l.id)))}>Tout sélectionner</button>}>
              Les lignes non lettrées se compensent exactement : sélectionnez-les toutes et lettrez-les ensemble.
            </StatusBanner>
          )}
          {linesQ.data.closed_until && (
            <StatusBanner tone="neutral" icon={Lock} title={`Lettrage figé jusqu'au ${fmtDate(linesQ.data.closed_until)}`}>
              Ces lignes appartiennent à un exercice clôturé : leur solde non lettré a été repris en à-nouveaux. Lettrez la ligne d'à-nouveaux avec les règlements de l'exercice en cours.
            </StatusBanner>
          )}

          <div className="odoo-section" style={{ padding: 0, position: 'relative' }}>
            {status !== 'lettered' && (
              <div style={{
                position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '8px 14px', background: 'var(--theme-bg-secondary)', borderBottom: '1px solid var(--theme-bg-separator)', fontSize: '0.8125rem',
              }}>
                <span style={{ fontWeight: 600 }}>{sel.length} sélectionnée(s)</span>
                <span style={{ ...mono, color: 'var(--theme-text-muted)' }}>D {n(selDebit / 100) || '0,00'} · C {n(selCredit / 100) || '0,00'}</span>
                {sel.length > 0 && (
                  <span style={{ ...mono, fontWeight: 600, color: ecart === 0 ? '#2e7d32' : '#c62828' }}>
                    {ecart === 0 ? 'Soldé' : `Écart ${sign(ecart)}`}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {sel.length > 0 && <button type="button" className="odoo-btn-secondary" onClick={() => setSelected(new Set())}>Effacer</button>}
                <button type="button" className="odoo-btn-primary" disabled={!canLetter || letterMut.isPending}
                  onClick={() => letterMut.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: canLetter ? 1 : 0.5 }}
                  title={canLetter ? undefined : 'Sélectionnez au moins deux lignes dont le débit égale le crédit'}>
                  <Link2 size={13} /> Lettrer
                </button>
              </div>
            )}
            {lines.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
                {status === 'open' ? 'Rien à lettrer : toutes les lignes de ce compte sont lettrées.' : 'Aucune ligne.'}
              </div>
            ) : (
              <table className="odoo-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      {status !== 'lettered' && <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={selectableLines.length === 0} aria-label="Tout sélectionner" />}
                    </th>
                    <th style={{ width: 56 }}>Lettre</th>
                    <th style={{ width: 86 }}>Date</th>
                    <th style={{ width: 130 }}>N° écriture</th>
                    <th style={{ width: 40 }}>Jr</th>
                    <th style={{ width: 110 }}>Pièce</th>
                    <th>Libellé</th>
                    <th style={{ width: 105, textAlign: 'right' }}>Débit</th>
                    <th style={{ width: 105, textAlign: 'right' }}>Crédit</th>
                    <th style={{ width: 100 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} onClick={() => selectable(l) && toggle(l.id)}
                      style={{ cursor: selectable(l) ? 'pointer' : 'default', background: selected.has(l.id) ? 'var(--odoo-bg-alt)' : undefined }}>
                      <td onClick={e => e.stopPropagation()}>
                        {l.frozen ? <Lock size={12} style={{ color: 'var(--theme-text-muted)' }} aria-label="Exercice clôturé" />
                          : !l.lettrage_id && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Sélectionner ${l.entry_number}`} />}
                      </td>
                      <td>{l.code && <span className="odoo-tag odoo-tag-green" style={{ ...mono, fontWeight: 600 }} title={l.lettered_at ? `Lettré le ${new Date(l.lettered_at).toLocaleString('fr-FR')}` : undefined}>{l.code}</span>}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{fmtDate(l.entry_date)}</td>
                      <td style={{ ...mono, fontSize: '0.75rem', color: '#185fa5' }}>{l.entry_number}</td>
                      <td style={{ ...mono, fontSize: '0.6875rem' }}>{l.journal_code}</td>
                      <td style={{ fontSize: '0.75rem' }}>{l.piece_ref ?? ''}</td>
                      <td style={{ fontSize: '0.8125rem' }}>
                        {l.source_kind === 'opening' && <span className="odoo-tag odoo-tag-blue" style={{ marginRight: 6 }}>À-nouveau</span>}
                        {l.label || l.description}
                      </td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(l.debit)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(l.credit)}</td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        {l.lettrage_id && !l.frozen && (
                          <button type="button" className="odoo-btn-secondary" disabled={unletterMut.isPending} onClick={() => askUnletter(l)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.6875rem', padding: '2px 8px' }}>
                            <Unlink size={11} /> Délettrer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {linesQ.data.truncated && (
              <div style={{ padding: '8px 14px', fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <Info size={12} /> Affichage limité aux 3 000 premières lignes : resserrez la période.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
