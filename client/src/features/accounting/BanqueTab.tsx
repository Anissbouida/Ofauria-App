import BankRulesPanel, { RuleFormModal, type RuleDraft } from './BankRulesPanel';
import { StatusTag } from '../../components/ui/StatusTag';
import { apiErrorMessage } from '../../api/errors';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Lock, Plus, Trash2, Landmark, Wand2, Link2, Unlink, ArrowLeft, ListChecks, CheckCheck,
} from 'lucide-react';
import { bankReconciliationApi } from '../../api/bank-reconciliation.api';
import type { BankStatement, BankLine, LedgerLine } from '../../api/bank-reconciliation.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import BankImportModal from './BankImportModal';
import { DataPanel, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, SectionHeader, TableFooter, Toolbar, HeaderActions } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { currencySymbol } from '../../utils/money';

function n(v: string | number): string {
  const num = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(num)) return '0,00';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(raw: string): string {
  const s = String(raw).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export default function BanqueTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const queryClient = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: statements = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => bankReconciliationApi.listStatements(),
    enabled: isAdmin,
  });

  const removeStmt = useMutation({
    mutationFn: (id: string) => bankReconciliationApi.deleteStatement(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bank-statements'] }); notify.success('Relevé supprimé'); },
  });

  if (!isAdmin) {
    return (
      <EmptyState icon={Lock} title="Le rapprochement bancaire est réservé à l'administrateur ou au gérant." />
    );
  }

  if (selectedId) {
    return <ReconciliationView statementId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <>
      <HeaderActions>
        <button type="button" onClick={() => setShowImport(true)} className="odoo-btn-primary">
          <Plus size={13} aria-hidden="true" /> Importer un relevé
        </button>
      </HeaderActions>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : statements.length === 0 ? (
        <EmptyState icon={Landmark} title="Aucun relevé bancaire" text="Importez un relevé pour le rapprocher avec le grand livre."
          action={<button type="button" className="odoo-btn-primary" onClick={() => setShowImport(true)}><Plus size={13} aria-hidden="true" /> Importer un relevé</button>} />
      ) : (
        <DataPanel label="Relevés bancaires" footer={<TableFooter note={`${statements.length} relevé${statements.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Relevé</th>
                <th style={{ width: 70 }}>Compte</th>
                <th style={{ width: 100 }}>Date</th>
                <th className="ds-num" style={{ width: 160 }}>Solde de clôture ({currencySymbol()})</th>
                <th style={{ width: 160 }}>Rapprochement</th>
                <th className="ds-actions" style={{ width: 130 }}><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(statements as BankStatement[]).map(s => {
                const pct = s.line_count ? Math.round((s.reconciled_count / s.line_count) * 100) : 0;
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(s.id)}>
                    <td className="ds-strong">
                      {s.label}
                      {s.source_format && <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: 'var(--ds-muted)' }}>{s.source_format}</span>}
                    </td>
                    <td className="ds-ref">{s.account_code}</td>
                    <td>{fmtDate(s.statement_date)}</td>
                    <td className="ds-num">{n(s.closing_balance)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--ds-hair)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--ds-success)' : 'var(--ds-info)' }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--ds-muted)' }}>{s.reconciled_count}/{s.line_count}</span>
                      </div>
                    </td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setSelectedId(s.id)} className="odoo-btn-secondary ds-btn-sm">Rapprocher</button>
                      <RowMenu items={[{ label: 'Supprimer le relevé', icon: Trash2, danger: true, onSelect: async () => {
                        if (await confirm(`Supprimer le relevé « ${s.label} » ? Ses rapprochements seront défaits.`, { title: 'Supprimer le relevé', danger: true, confirmLabel: 'Supprimer' })) removeStmt.mutate(s.id);
                      } }]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {/* G4-02 : règles du rapprochement automatique. */}
      <BankRulesPanel />

      {showImport && <BankImportModal onClose={() => setShowImport(false)} onSaved={() => { setShowImport(false); queryClient.invalidateQueries({ queryKey: ['bank-statements'] }); }} />}
    </>
  );
}

function ReconciliationView({ statementId, onBack }: { statementId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  // G4-02 : propositions du moteur à règles, sélection pour validation en masse, règle depuis une ligne.
  const [showProposals, setShowProposals] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const { data: prop, isFetching: loadingProposals } = useQuery({
    queryKey: ['bank-proposals', statementId], queryFn: () => bankReconciliationApi.proposals(statementId), enabled: showProposals,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['bank-reconciliation', statementId],
    queryFn: () => bankReconciliationApi.getReconciliation(statementId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', statementId] });
    queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    queryClient.invalidateQueries({ queryKey: ['bank-proposals', statementId] });
  };
  const applyPicked = useMutation({
    mutationFn: () => bankReconciliationApi.apply(statementId, [...picked]),
    onSuccess: r => {
      invalidate(); setPicked(new Set());
      notify.success(`${r.applied} rapprochement${r.applied > 1 ? 's' : ''} validé${r.applied > 1 ? 's' : ''}`);
      if (r.errors.length) notify.error(r.errors.join(' — '));
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const autoMatch = useMutation({
    mutationFn: () => bankReconciliationApi.autoMatch(statementId),
    onSuccess: (r) => {
      invalidate();
      notify.success(`${r.matched} ligne(s) rapprochée(s) automatiquement${r.proposed && r.proposed > r.matched ? ` — ${r.proposed - r.matched} proposition(s) à valider` : ''}`);
      if (r.errors?.length) notify.error(r.errors.join(' — '));
    },
  });
  const matchLine = useMutation({
    mutationFn: ({ b, e }: { b: string; e: string }) => bankReconciliationApi.matchLine(b, e),
    onSuccess: () => { invalidate(); setSelectedBank(null); notify.success('Ligne rapprochée'); },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message : null;
      notify.error(msg || 'Erreur rapprochement');
    },
  });
  const unmatchLine = useMutation({
    mutationFn: (b: string) => bankReconciliationApi.unmatchLine(b),
    onSuccess: () => { invalidate(); notify.success('Rapprochement annulé'); },
  });

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return <LoadingState />;
  }

  const ledgerBalance = data.unmatchedLedgerLines.reduce((s, l) => s + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0), 0);

  return (
    <>
      <HeaderActions>
        <button type="button" onClick={() => autoMatch.mutate()} disabled={autoMatch.isPending} aria-busy={autoMatch.isPending || undefined} className="odoo-btn-primary">
          {autoMatch.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Wand2 size={13} aria-hidden="true" />} Rapprochement automatique
        </button>
      </HeaderActions>

      <KpiGrid>
        <KpiCard label="Rapprochées" value={<>{data.summary.reconciled}/{data.summary.total_lines}</>} sub="lignes du relevé" />
        <KpiCard label="Relevé non rapprochées" value={data.summary.unmatched_bank} sub="au relevé, pas en compta" tone={data.summary.unmatched_bank > 0 ? 'red' : undefined} />
        <KpiCard label="Écritures non pointées" value={data.summary.unmatched_ledger} sub="en compta, pas au relevé" tone={data.summary.unmatched_ledger > 0 ? 'orange' : undefined} />
      </KpiGrid>

      <Toolbar>
        <button type="button" onClick={onBack} className="ds-btn-ghost ds-btn-sm">
          <ArrowLeft size={13} aria-hidden="true" /> Relevés
        </button>
        <strong className="ds-strong">{data.statement.label}</strong>
        <span className="ds-grow" />
        <button type="button" onClick={() => setShowProposals(v => !v)} className="odoo-btn-secondary ds-btn-sm" aria-pressed={showProposals}>
          <ListChecks size={13} aria-hidden="true" /> {showProposals ? 'Masquer les propositions' : 'Propositions'}
        </button>
      </Toolbar>

      {showProposals && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader title="Propositions du rapprochement" note="référence 100 · règle 90-95 · montant 80 · regroupement 70">
            <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!prop?.proposals.length} onClick={() => setPicked(new Set(prop?.proposals.map(x => x.bankLineId)))}>Tout cocher</button>
            <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={!picked.size || applyPicked.isPending} aria-busy={applyPicked.isPending || undefined} onClick={() => applyPicked.mutate()}>
              {applyPicked.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <CheckCheck size={13} aria-hidden="true" />} Valider la sélection ({picked.size})
            </button>
          </SectionHeader>
          <DataPanel label="Propositions du rapprochement">
            {loadingProposals ? <LoadingState bare /> : !prop?.proposals.length ? (
              <EmptyState bare icon={ListChecks} title="Aucune proposition" text="Les lignes restantes n'ont pas de correspondance sûre." />
            ) : (
              <table className="odoo-table ds-dense">
                <thead><tr>
                  <th style={{ width: 32 }}><span className="ds-sr-only">Sélection</span></th><th style={{ width: 90 }}>Date</th><th>Libellé</th>
                  <th className="ds-num">Montant ({currencySymbol()})</th><th>Correspondance</th><th>Méthode</th>
                </tr></thead>
                <tbody>
                  {prop.proposals.map(x => {
                    const bl = (data.bankLines as BankLine[]).find(b => b.id === x.bankLineId);
                    const on = picked.has(x.bankLineId);
                    return (
                      <tr key={x.bankLineId} className={on ? 'ds-selected' : undefined}>
                        <td><input type="checkbox" checked={on} aria-label="Retenir la proposition"
                          onChange={() => setPicked(s => { const n2 = new Set(s); if (on) n2.delete(x.bankLineId); else n2.add(x.bankLineId); return n2; })} /></td>
                        <td>{bl ? fmtDate(bl.operation_date) : ''}</td>
                        <td className="ds-strong">{bl?.label ?? '—'}</td>
                        <td className="ds-num">{bl ? `${bl.direction === 'in' ? '+' : '−'}${n(bl.amount)}` : ''}</td>
                        <td>
                          {x.generate?.amount != null
                            ? `${x.entryNumbers.join(' + ')} (brut ${n(x.gross ?? 0)}) − ${x.generate.label} ${n(x.generate.amount)} (${x.feePct ?? 0} %) à générer`
                            : x.generate ? `Écriture à générer : ${x.generate.label}` : x.entryNumbers.join(' + ')}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <StatusTag tone={x.confidence >= 90 ? 'done' : x.confidence >= 80 ? 'todo' : 'progress'}
                            label={`${METHOD_LABEL[x.method]}${x.ruleLabel ? ` · ${x.ruleLabel}` : ''} · ${x.confidence}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </DataPanel>
        </div>
      )}

      {selectedBank && (
        <div style={{ padding: '8px 12px', background: 'var(--ds-info-bg)', borderRadius: 6, marginBottom: 8, fontSize: 13, color: 'var(--ds-info)' }}>
          Ligne de relevé sélectionnée — cliquez sur une écriture à droite pour la rapprocher, <button type="button" onClick={() => { const bl = (data.bankLines as BankLine[]).find(b => b.id === selectedBank); if (bl) setRuleDraft(draftFromLine(bl)); }} style={{ background: 'none', border: 'none', color: 'var(--ds-info)', textDecoration: 'underline', cursor: 'pointer' }}>créer une règle pour ce libellé</button>, ou <button type="button" onClick={() => setSelectedBank(null)} style={{ background: 'none', border: 'none', color: 'var(--ds-info)', textDecoration: 'underline', cursor: 'pointer' }}>annuler</button>.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12 }}>
        {/* Lignes du relevé */}
        <div>
          <SectionHeader title="Lignes du relevé" />
          <DataPanel label="Lignes du relevé">
            <table className="odoo-table ds-dense">
              <thead><tr>
                <th style={{ width: 90 }}>Date</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th>
                <th className="ds-actions" style={{ width: 44 }}><span className="ds-sr-only">Rapprochement</span></th>
              </tr></thead>
              <tbody>
                {(data.bankLines as BankLine[]).map(l => (
                  <tr key={l.id}
                    onClick={() => !l.reconciled && setSelectedBank(selectedBank === l.id ? null : l.id)}
                    className={selectedBank === l.id ? 'ds-selected' : undefined}
                    style={{
                      cursor: l.reconciled ? 'default' : 'pointer',
                      background: selectedBank === l.id ? undefined : l.reconciled ? 'var(--ds-success-bg)' : undefined,
                    }}>
                    <td>{fmtDate(l.operation_date)}</td>
                    <td>{l.label || '—'}</td>
                    <td className="ds-num" style={{ color: l.direction === 'in' ? 'var(--ds-success)' : 'var(--ds-danger)' }}>
                      {l.direction === 'in' ? '+' : '−'}{n(l.amount)}
                    </td>
                    <td className="ds-actions" style={{ textAlign: 'center' }}>
                      {l.reconciled ? (
                        <button type="button" onClick={(e) => { e.stopPropagation(); unmatchLine.mutate(l.id); }} title={`Rapprochée à ${l.matched_entry_number ?? '—'}${l.match_method ? ` (${METHOD_LABEL[l.match_method] ?? l.match_method}${l.match_rule_label ? ` · ${l.match_rule_label}` : ''})` : ''}`} className="ds-icon-btn" aria-label={`Rapprochée à ${l.matched_entry_number ?? '—'}${l.match_method ? ` (${METHOD_LABEL[l.match_method] ?? l.match_method}${l.match_rule_label ? ` · ${l.match_rule_label}` : ''})` : ''}`}><Unlink size={11} /></button>
                      ) : <span style={{ color: 'var(--ds-muted)' }} aria-label="Non rapprochée">○</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </div>

        {/* Écritures 5141 non pointées */}
        <div>
          <SectionHeader title={`Écritures ${data.statement.account_code} non pointées`} note={`solde ${n(ledgerBalance)} ${currencySymbol()}`} />
          <DataPanel label="Écritures non pointées">
            {data.unmatchedLedgerLines.length === 0 ? (
              <EmptyState bare icon={CheckCheck} title="Toutes les écritures sont pointées" />
            ) : (
              <table className="odoo-table ds-dense">
                <thead><tr>
                  <th style={{ width: 90 }}>Date</th><th style={{ width: 110 }}>Pièce</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th>
                  <th style={{ width: 30 }}><span className="ds-sr-only">Rapprocher</span></th>
                </tr></thead>
                <tbody>
                  {(data.unmatchedLedgerLines as LedgerLine[]).map(l => {
                    const isDebit = parseFloat(l.debit) > 0;
                    return (
                      <tr key={l.id}
                        onClick={() => selectedBank && matchLine.mutate({ b: selectedBank, e: l.id })}
                        className={selectedBank ? 'ds-clickable' : undefined}
                        style={{ cursor: selectedBank ? 'pointer' : 'default' }}>
                        <td>{fmtDate(l.entry_date)}</td>
                        <td className="ds-ref">{l.entry_number}</td>
                        <td>{l.label || '—'}</td>
                        <td className="ds-num" style={{ color: isDebit ? 'var(--ds-success)' : 'var(--ds-danger)' }}>
                          {isDebit ? '+' : '−'}{n(isDebit ? l.debit : l.credit)}
                        </td>
                        <td style={{ textAlign: 'center' }}>{selectedBank ? <Link2 size={12} style={{ color: 'var(--ds-info)' }} aria-hidden="true" /> : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </DataPanel>
        </div>
      </div>

      {ruleDraft && <RuleFormModal draft={ruleDraft} onClose={() => setRuleDraft(null)}
        onSaved={() => { setRuleDraft(null); queryClient.invalidateQueries({ queryKey: ['bank-rules'] }); queryClient.invalidateQueries({ queryKey: ['bank-proposals', statementId] }); }} />}
    </>
  );
}

const METHOD_LABEL: Record<string, string> = { reference: 'Référence', rule: 'Règle', amount: 'Montant', group: 'Regroupement', manual: 'Manuel' };

/** Règle proposée à partir d'une ligne de relevé : les deux premiers mots du libellé, sans chiffres. */
function draftFromLine(l: BankLine): RuleDraft {
  const words = (l.label ?? '').toUpperCase().replace(/[0-9/.-]+/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 2);
  return { label: words.join(' ') || 'Nouvelle règle', labelContains: words.join(' ') || null, direction: l.direction, action: 'post_entry' };
}
