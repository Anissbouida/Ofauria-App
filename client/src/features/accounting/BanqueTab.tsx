import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Lock, Plus, Trash2, X, Landmark, Wand2, Link2, Unlink, ArrowLeft, ChevronRight,
} from 'lucide-react';
import { bankReconciliationApi } from '../../api/bank-reconciliation.api';
import type { BankStatement, BankLine, LedgerLine, ImportLine } from '../../api/bank-reconciliation.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: statements = [], isLoading } = useQuery({
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
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>Le rapprochement bancaire est réservé à l'administrateur ou au gérant.</p>
      </div>
    );
  }

  if (selectedId) {
    return <ReconciliationView statementId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button onClick={() => setShowImport(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> Importer un relevé
        </button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : statements.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Landmark size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun relevé. Importez un relevé bancaire pour le rapprocher avec le grand livre.</p>
        </div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Relevé</th>
                <th style={{ width: 70 }}>Compte</th>
                <th style={{ width: 100 }}>Date</th>
                <th style={{ width: 120, textAlign: 'right' }}>Solde clôture</th>
                <th style={{ width: 140 }}>Rapprochement</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {(statements as BankStatement[]).map(s => {
                const pct = s.line_count ? Math.round((s.reconciled_count / s.line_count) * 100) : 0;
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(s.id)}>
                    <td style={{ fontWeight: 500 }}>{s.label}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{s.account_code}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{fmtDate(s.statement_date)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(s.closing_balance)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--theme-bg-separator)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#0e7c3a' : '#185fa5' }} />
                        </div>
                        <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{s.reconciled_count}/{s.line_count}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <button onClick={() => setSelectedId(s.id)} className="odoo-btn-secondary" style={{ padding: '4px 6px' }}><ChevronRight size={12} /></button>
                        <button onClick={() => { if (window.confirm('Supprimer ce relevé ?')) removeStmt.mutate(s.id); }} className="odoo-btn-secondary" style={{ padding: '4px 6px', color: '#c62828' }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onSaved={() => { setShowImport(false); queryClient.invalidateQueries({ queryKey: ['bank-statements'] }); }} />}
    </>
  );
}

// Parse CSV : date;libellé;débit;crédit  (séparateur ; ou ,)
function parseCsv(text: string): ImportLine[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const result: ImportLine[] = [];
  for (const raw of lines) {
    const sep = raw.includes(';') ? ';' : ',';
    const cols = raw.split(sep).map(c => c.trim());
    if (cols.length < 3) continue;
    // Skip header
    if (/date/i.test(cols[0]) && /lib|d.bit|cr.dit/i.test(raw)) continue;
    const [dateRaw, label, debitRaw, creditRaw] = cols;
    // Normalise date jj/mm/aaaa -> aaaa-mm-jj
    let date = dateRaw;
    if (/\d{2}\/\d{2}\/\d{4}/.test(dateRaw)) {
      const [d, m, y] = dateRaw.split('/');
      date = `${y}-${m}-${d}`;
    }
    const debit = parseFloat((debitRaw || '').replace(/\s/g, '').replace(',', '.')) || 0;
    const credit = parseFloat((creditRaw || '').replace(/\s/g, '').replace(',', '.')) || 0;
    if (debit > 0) result.push({ operationDate: date, label, amount: debit, direction: 'out' });
    else if (credit > 0) result.push({ operationDate: date, label, amount: credit, direction: 'in' });
  }
  return result;
}

function ImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [accountCode, setAccountCode] = useState('5141');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [closingBalance, setClosingBalance] = useState('');
  const [csv, setCsv] = useState('');

  const parsed = useMemo(() => parseCsv(csv), [csv]);

  const save = useMutation({
    mutationFn: () => bankReconciliationApi.createStatement({
      label, accountCode, statementDate,
      openingBalance: 0, closingBalance: parseFloat(closingBalance) || 0,
      lines: parsed,
    }),
    onSuccess: () => { notify.success('Relevé importé'); onSaved(); },
    onError: () => notify.error('Erreur import'),
  });

  const inputStyle = { width: '100%', padding: '7px 10px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };
  const labelStyle = { fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ background: 'var(--theme-bg-card)', borderRadius: 8, maxWidth: 600, width: '95vw', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Landmark size={16} /><strong style={{ fontSize: '0.9375rem' }}>Importer un relevé bancaire</strong>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Libellé *</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="Relevé BMCE juin 2026" style={inputStyle} /></div>
            <div><label style={labelStyle}>Compte</label>
              <select value={accountCode} onChange={e => setAccountCode(e.target.value)} style={inputStyle}>
                <option value="5141">5141 Banque</option>
                <option value="5161">5161 Caisse</option>
              </select>
            </div>
            <div><label style={labelStyle}>Date relevé *</label><input type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)} style={inputStyle} /></div>
          </div>
          <div><label style={labelStyle}>Solde de clôture (DH)</label><input type="number" step="0.01" value={closingBalance} onChange={e => setClosingBalance(e.target.value)} style={{ ...inputStyle, width: 200 }} /></div>
          <div>
            <label style={labelStyle}>Lignes CSV — format : <code>date;libellé;débit;crédit</code> (débit = sortie, crédit = entrée)</label>
            <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={8}
              placeholder={'06/06/2026;Virement fournisseur;3500;\n30/06/2026;Agios bancaires;50;\n10/06/2026;Encaissement client;;1200'}
              style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', resize: 'vertical' }} />
            {parsed.length > 0 && (
              <p style={{ fontSize: '0.6875rem', color: '#0e7c3a', marginTop: 4 }}>
                {parsed.length} ligne(s) détectée(s) : {parsed.filter(p => p.direction === 'in').length} entrée(s), {parsed.filter(p => p.direction === 'out').length} sortie(s)
              </p>
            )}
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => save.mutate()} disabled={!label || parsed.length === 0 || save.isPending} className="odoo-btn-primary"
            style={{ opacity: (!label || parsed.length === 0 || save.isPending) ? 0.5 : 1 }}>
            {save.isPending ? 'Import...' : `Importer ${parsed.length} ligne(s)`}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function ReconciliationView({ statementId, onBack }: { statementId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [selectedBank, setSelectedBank] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['bank-reconciliation', statementId],
    queryFn: () => bankReconciliationApi.getReconciliation(statementId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', statementId] });
    queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
  };

  const autoMatch = useMutation({
    mutationFn: () => bankReconciliationApi.autoMatch(statementId),
    onSuccess: (r) => { invalidate(); notify.success(`${r.matched} ligne(s) rapprochée(s) automatiquement`); },
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

  if (isLoading || !data) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}><Loader2 size={20} className="animate-spin" /></div>;
  }

  const ledgerBalance = data.unmatchedLedgerLines.reduce((s, l) => s + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0), 0);

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button onClick={onBack} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={13} /> Retour
        </button>
        <strong style={{ fontSize: '0.875rem', alignSelf: 'center' }}>{data.statement.label}</strong>
        <div style={{ flex: 1 }} />
        <button onClick={() => autoMatch.mutate()} disabled={autoMatch.isPending} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {autoMatch.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Rapprochement auto
        </button>
      </div>

      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Rapprochées</div>
          <div className="odoo-stat-card-value" style={{ color: '#0e7c3a' }}>{data.summary.reconciled}/{data.summary.total_lines}</div>
          <div className="odoo-stat-card-sub">lignes relevé</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Relevé non rapprochées</div>
          <div className="odoo-stat-card-value" style={{ color: data.summary.unmatched_bank > 0 ? '#b71c1c' : 'var(--theme-text-muted)' }}>{data.summary.unmatched_bank}</div>
          <div className="odoo-stat-card-sub">au relevé, pas en compta</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Écritures non pointées</div>
          <div className="odoo-stat-card-value" style={{ color: data.summary.unmatched_ledger > 0 ? '#856404' : 'var(--theme-text-muted)' }}>{data.summary.unmatched_ledger}</div>
          <div className="odoo-stat-card-sub">en compta, pas au relevé</div>
        </div>
      </div>

      {selectedBank && (
        <div style={{ padding: '8px 12px', background: '#e8f0fe', borderRadius: 6, marginBottom: 8, fontSize: '0.8125rem', color: '#185fa5' }}>
          Ligne de relevé sélectionnée — cliquez sur une écriture à droite pour la rapprocher, ou <button onClick={() => setSelectedBank(null)} style={{ background: 'none', border: 'none', color: '#185fa5', textDecoration: 'underline', cursor: 'pointer' }}>annuler</button>.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Lignes du relevé */}
        <div className="odoo-section" style={{ padding: 0 }}>
          <div style={{ padding: '10px 14px', background: 'var(--theme-bg-secondary)', borderBottom: '1px solid var(--theme-bg-separator)', fontWeight: 600, fontSize: '0.8125rem' }}>
            Lignes du relevé
          </div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <tbody>
              {(data.bankLines as BankLine[]).map(l => (
                <tr key={l.id}
                  onClick={() => !l.reconciled && setSelectedBank(selectedBank === l.id ? null : l.id)}
                  style={{
                    cursor: l.reconciled ? 'default' : 'pointer',
                    background: selectedBank === l.id ? '#e8f0fe' : l.reconciled ? '#f0f9f4' : undefined,
                  }}>
                  <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', width: 70 }}>{fmtDate(l.operation_date)}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{l.label || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: l.direction === 'in' ? '#0e7c3a' : '#c62828' }}>
                    {l.direction === 'in' ? '+' : '−'}{n(l.amount)}
                  </td>
                  <td style={{ width: 36, textAlign: 'center' }}>
                    {l.reconciled ? (
                      <button onClick={(e) => { e.stopPropagation(); unmatchLine.mutate(l.id); }} title={`Rapprochée à ${l.matched_entry_number}`} className="odoo-btn-secondary" style={{ padding: '2px 4px' }}><Unlink size={11} /></button>
                    ) : <span style={{ color: 'var(--theme-text-tertiary)' }}>○</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Écritures 5141 non pointées */}
        <div className="odoo-section" style={{ padding: 0 }}>
          <div style={{ padding: '10px 14px', background: 'var(--theme-bg-secondary)', borderBottom: '1px solid var(--theme-bg-separator)', fontWeight: 600, fontSize: '0.8125rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Écritures {data.statement.account_code} non pointées</span>
            <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)' }}>solde {n(ledgerBalance)}</span>
          </div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <tbody>
              {(data.unmatchedLedgerLines as LedgerLine[]).map(l => {
                const isDebit = parseFloat(l.debit) > 0;
                return (
                  <tr key={l.id}
                    onClick={() => selectedBank && matchLine.mutate({ b: selectedBank, e: l.id })}
                    style={{ cursor: selectedBank ? 'pointer' : 'default', background: selectedBank ? '#fff' : undefined }}>
                    <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', width: 70 }}>{fmtDate(l.entry_date)}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem', color: '#185fa5', width: 110 }}>{l.entry_number}</td>
                    <td style={{ fontSize: '0.8125rem' }}>{l.label || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: isDebit ? '#0e7c3a' : '#c62828' }}>
                      {isDebit ? '+' : '−'}{n(isDebit ? l.debit : l.credit)}
                    </td>
                    <td style={{ width: 30, textAlign: 'center' }}>{selectedBank ? <Link2 size={12} style={{ color: '#185fa5' }} /> : ''}</td>
                  </tr>
                );
              })}
              {data.unmatchedLedgerLines.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontStyle: 'italic', padding: '1rem' }}>Toutes les écritures sont pointées</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
