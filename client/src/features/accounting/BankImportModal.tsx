import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark, X, Upload, Loader2, AlertTriangle, CheckCircle2, Save, Columns3 } from 'lucide-react';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { paymentsApi } from '../../api/accounting.api';
import { bankImportApi } from '../../api/bank-reconciliation.api';
import type { BankCsvProfile, BankDateFormat, BankFormat, BankImportProfile } from '../../api/bank-reconciliation.api';

/**
 * Import d'un relevé bancaire (mig 426) : fichier de la banque (CSV, Excel,
 * OFX, MT940, CFONB 120), aperçu lu par le serveur, doublons écartés, soldes
 * contrôlés. Pour un CSV/Excel, les colonnes se choisissent sur l'aperçu brut
 * et s'enregistrent en profil réutilisable.
 */

const FORMAT_LABELS: Record<BankFormat, string> = { csv: 'CSV', xlsx: 'Excel', ofx: 'OFX', mt940: 'MT940 (SWIFT)', cfonb: 'CFONB 120' };
const DATE_FORMATS: BankDateFormat[] = ['DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YY', 'YYYY-MM-DD', 'MM/DD/YYYY'];
type Role = 'ignore' | 'date' | 'valueDate' | 'label' | 'label2' | 'reference' | 'debit' | 'credit' | 'amount';
const ROLES: { key: Role; label: string; field?: keyof BankCsvProfile }[] = [
  { key: 'ignore', label: '—' },
  { key: 'date', label: 'Date', field: 'colDate' },
  { key: 'valueDate', label: 'Date de valeur', field: 'colValueDate' },
  { key: 'label', label: 'Libellé', field: 'colLabel' },
  { key: 'label2', label: 'Libellé (suite)', field: 'colLabel2' },
  { key: 'reference', label: 'Référence', field: 'colReference' },
  { key: 'debit', label: 'Débit (sortie)', field: 'colDebit' },
  { key: 'credit', label: 'Crédit (entrée)', field: 'colCredit' },
  { key: 'amount', label: 'Montant signé', field: 'colAmount' },
];
const MAX_BYTES = 6 * 1024 * 1024;

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')));

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromProfile = (p: BankImportProfile): BankCsvProfile => ({
  delimiter: p.delimiter, decimalSep: p.decimal_sep, dateFormat: p.date_format, skipRows: p.skip_rows, hasHeader: p.has_header,
  colDate: p.col_date, colValueDate: p.col_value_date, colLabel: p.col_label, colLabel2: p.col_label2, colReference: p.col_reference,
  colDebit: p.col_debit, colCredit: p.col_credit, colAmount: p.col_amount, negativeIsOut: p.negative_is_out,
});

/** Première correspondance devinée d'après les en-têtes (« Date valeur », « Débit »…). */
function guessMapping(rows: string[][]): BankCsvProfile {
  const header = (rows.find(r => r.filter(Boolean).length >= 3) ?? rows[0] ?? []).map(h => h.toLowerCase());
  const skipRows = Math.max(0, rows.indexOf(rows.find(r => r.filter(Boolean).length >= 3) ?? rows[0]));
  const find = (re: RegExp, not?: RegExp) => { const i = header.findIndex(h => re.test(h) && !(not && not.test(h))); return i >= 0 ? i : null; };
  const debit = find(/d[ée]bit|retrait|sortie/), credit = find(/cr[ée]dit|versement|entr[ée]e/);
  const amount = debit == null && credit == null ? find(/montant|amount|somme/) : null;
  return {
    delimiter: null, decimalSep: ',', dateFormat: 'DD/MM/YYYY', skipRows, hasHeader: true,
    colDate: find(/date/, /valeur|val\b/) ?? 0, colValueDate: find(/valeur|val\b/),
    // Par ordre de préférence, jamais une colonne de date (« Date opération »).
    colLabel: [/lib/, /d[ée]signation|description/, /motif|nature/, /op[ée]ration/]
      .map(re => find(re, /date/)).find(i => i != null) ?? 1,
    colLabel2: null,
    colReference: find(/r[ée]f/), colDebit: debit, colCredit: credit,
    colAmount: amount ?? (debit == null && credit == null ? 2 : null), negativeIsOut: true,
  };
}

export default function BankImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; base64: string; token: number } | null>(null);
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [format, setFormat] = useState<BankFormat | 'auto'>('auto');
  const [encoding, setEncoding] = useState<'auto' | 'utf-8' | 'windows-1252'>('auto');
  const [profileId, setProfileId] = useState('');               // '' = aucun, 'custom' = colonnes choisies ici
  const [mapping, setMapping] = useState<BankCsvProfile | null>(null);
  const [profileName, setProfileName] = useState('');
  const [label, setLabel] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');

  const modesQ = useQuery({ queryKey: ['payment-modes'], queryFn: paymentsApi.modes });
  const banks = (modesQ.data?.treasuryAccounts ?? []).filter(t => t.kind === 'bank');
  const profilesQ = useQuery({ queryKey: ['bank-import-profiles'], queryFn: bankImportApi.profiles });

  const payload = file && {
    fileName: file.name, contentBase64: file.base64, format, encoding,
    treasuryAccountId: treasuryAccountId || null,
    profileId: profileId && profileId !== 'custom' ? profileId : null,
    profile: profileId === 'custom' ? mapping : null,
  };
  const previewQ = useQuery({
    queryKey: ['bank-import-preview', file?.token, treasuryAccountId, format, encoding, profileId, JSON.stringify(mapping)],
    queryFn: () => bankImportApi.preview(payload!),
    enabled: !!payload,
    retry: false,
  });
  const pv = previewQ.data;
  const tabular = pv?.format === 'csv' || pv?.format === 'xlsx';

  // CSV/Excel lu sans profil : colonnes devinées d'après les en-têtes.
  useEffect(() => {
    if (pv && tabular && !profileId && pv.rawRows?.length) {
      setMapping(guessMapping(pv.rawRows));
      setProfileId('custom');
    }
  }, [pv, tabular, profileId]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { notify.error('Fichier trop volumineux (6 Mo au plus)'); return; }
    setFile({ name: f.name, base64: toBase64(await f.arrayBuffer()), token: Date.now() });
  };

  const roleOf = (i: number): Role => {
    if (!mapping) return 'ignore';
    return ROLES.find(r => r.field && mapping[r.field] === i)?.key ?? 'ignore';
  };
  const setRole = (i: number, role: Role) => setMapping(m => {
    if (!m) return m;
    const next: BankCsvProfile = { ...m };
    const cols = next as unknown as Record<string, number | null>;   // champs col* : rang de colonne
    for (const r of ROLES) if (r.field && cols[r.field] === i) cols[r.field] = null;
    const f = ROLES.find(r => r.key === role)?.field;
    if (f) cols[f] = i;
    if (role === 'amount') { next.colDebit = null; next.colCredit = null; }
    if (role === 'debit' || role === 'credit') next.colAmount = null;
    next.colDate ??= 0; next.colLabel ??= 0;
    return next;
  });
  const patchMapping = (p: Partial<BankCsvProfile>) => setMapping(m => (m ? { ...m, ...p } : m));

  const saveProfile = useMutation({
    mutationFn: () => bankImportApi.saveProfile({ ...mapping!, name: profileName.trim(), treasuryAccountId: treasuryAccountId || null }),
    onSuccess: (p) => { notify.success(`Profil « ${p.name} » enregistré`); qc.invalidateQueries({ queryKey: ['bank-import-profiles'] }); setProfileId(p.id); setProfileName(''); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Profil non enregistré')),
  });
  const doImport = useMutation({
    mutationFn: () => bankImportApi.import({
      ...payload!, label: label || null, statementDate: statementDate || null,
      openingBalance: num(opening), closingBalance: num(closing),
    }),
    onSuccess: (r) => {
      notify.success(`Relevé importé : ${r.imported} opération(s)${r.skipped ? `, ${r.skipped} déjà connue(s) écartée(s)` : ''}`);
      onSaved();
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Import impossible')),
  });

  // Contrôle des soldes : ouverture + mouvements du fichier = clôture.
  const check = useMemo(() => {
    if (!pv) return null;
    const o = num(opening) ?? pv.openingBalance;
    const c = num(closing) ?? pv.closingBalance;
    if (o == null || c == null) return null;
    const net = pv.lines.reduce((s, l) => s + (l.direction === 'in' ? l.amount : -l.amount), 0);
    return Math.round((o + net - c) * 100) / 100;
  }, [pv, opening, closing]);
  const fresh = pv ? pv.stats.count - pv.stats.duplicates : 0;

  const inputStyle = { width: '100%', padding: '6px 9px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };
  const labelStyle = { fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 960, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Landmark size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="odoo-breadcrumb-current">Importer un relevé bancaire</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          {/* 1. Fichier et compte */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Fichier de la banque *</label>
              <label className="odoo-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', justifyContent: 'center' }}>
                <Upload size={13} /> {file ? file.name : 'Choisir un fichier (CSV, Excel, OFX, MT940, CFONB)'}
                <input type="file" accept=".csv,.txt,.xlsx,.xls,.ofx,.qfx,.sta,.mt940,.940,.cfo,.dat" style={{ display: 'none' }}
                  onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
            <div>
              <label style={labelStyle}>Compte bancaire</label>
              <select value={treasuryAccountId} onChange={e => setTreasuryAccountId(e.target.value)} style={inputStyle}>
                <option value="">{pv ? `${pv.treasuryAccount.label} (${pv.treasuryAccount.account_code})` : 'Par défaut'}</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.label} ({b.account_code})</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Format</label>
              <select value={format} onChange={e => setFormat(e.target.value as BankFormat | 'auto')} style={inputStyle}>
                <option value="auto">{pv ? `Détecté : ${FORMAT_LABELS[pv.format]}` : 'Détection automatique'}</option>
                {(Object.keys(FORMAT_LABELS) as BankFormat[]).map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Encodage</label>
              <select value={encoding} onChange={e => setEncoding(e.target.value as typeof encoding)} style={inputStyle}>
                <option value="auto">Automatique</option>
                <option value="utf-8">UTF-8</option>
                <option value="windows-1252">Windows (ANSI)</option>
              </select>
            </div>
          </div>

          {previewQ.isFetching && !pv && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}><Loader2 size={18} className="animate-spin" /></div>
          )}
          {previewQ.isError && (
            <StatusBanner tone="danger" icon={AlertTriangle} title="Fichier illisible">{apiErrorMessage(previewQ.error, 'Lecture impossible')}</StatusBanner>
          )}

          {/* 2. Colonnes d'un CSV / Excel */}
          {pv && tabular && (
            <div className="odoo-section" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Columns3 size={14} />
                <strong style={{ fontSize: '0.8125rem' }}>Colonnes du fichier</strong>
                <select value={profileId} onChange={e => {
                  const id = e.target.value;
                  const p = profilesQ.data?.find(x => x.id === id);
                  if (p) { setMapping(fromProfile(p)); if (p.treasury_account_id) setTreasuryAccountId(p.treasury_account_id); }
                  setProfileId(id);
                }} style={{ ...inputStyle, width: 'auto', minWidth: 220 }}>
                  <option value="custom">Choisies ci-dessous</option>
                  {(profilesQ.data ?? []).map(p => <option key={p.id} value={p.id}>Profil : {p.name}</option>)}
                </select>
                {profileId && profileId !== 'custom' && (
                  <button type="button" className="odoo-btn-secondary" onClick={() => setProfileId('custom')}>Modifier les colonnes</button>
                )}
              </div>
              {profileId === 'custom' && mapping && pv.rawRows && (
                <>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.75rem', alignItems: 'center' }}>
                    <label>Lignes à sauter <input type="number" min={0} max={50} value={mapping.skipRows} onChange={e => patchMapping({ skipRows: Math.max(0, Number(e.target.value) || 0) })} style={{ ...inputStyle, width: 60, display: 'inline-block' }} /></label>
                    <label><input type="checkbox" checked={mapping.hasHeader} onChange={e => patchMapping({ hasHeader: e.target.checked })} /> 1re ligne = en-têtes</label>
                    <label>Dates <select value={mapping.dateFormat} onChange={e => patchMapping({ dateFormat: e.target.value as BankDateFormat })} style={{ ...inputStyle, width: 'auto', display: 'inline-block' }}>{DATE_FORMATS.map(f => <option key={f}>{f}</option>)}</select></label>
                    <label>Décimale <select value={mapping.decimalSep} onChange={e => patchMapping({ decimalSep: e.target.value as ',' | '.' })} style={{ ...inputStyle, width: 'auto', display: 'inline-block' }}><option value=",">virgule (1 234,56)</option><option value=".">point (1,234.56)</option></select></label>
                    {pv.format === 'csv' && (
                      <label>Séparateur <select value={mapping.delimiter ?? ''} onChange={e => patchMapping({ delimiter: e.target.value || null })} style={{ ...inputStyle, width: 'auto', display: 'inline-block' }}><option value="">auto</option><option value=";">;</option><option value=",">,</option><option value={'\t'}>tabulation</option><option value="|">|</option></select></label>
                    )}
                    {mapping.colAmount != null && (
                      <label><input type="checkbox" checked={mapping.negativeIsOut !== false} onChange={e => patchMapping({ negativeIsOut: e.target.checked })} /> négatif = sortie</label>
                    )}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="odoo-table" style={{ margin: 0, fontSize: '0.75rem' }}>
                      <thead>
                        <tr>
                          {Array.from({ length: Math.max(...pv.rawRows.map(r => r.length)) }, (_, i) => (
                            <th key={i} style={{ minWidth: 110 }}>
                              <select value={roleOf(i)} onChange={e => setRole(i, e.target.value as Role)} style={{ ...inputStyle, padding: '3px 4px', fontSize: '0.75rem' }} aria-label={`Rôle de la colonne ${i + 1}`}>
                                {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                              </select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pv.rawRows.slice(0, 8).map((r, ri) => (
                          <tr key={ri} style={{ opacity: ri < mapping.skipRows + (mapping.hasHeader ? 1 : 0) ? 0.45 : 1 }}>
                            {r.map((c, ci) => <td key={ci} style={{ whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Nom du profil (ex. BMCE — export CSV)" style={{ ...inputStyle, maxWidth: 300 }} />
                    <button type="button" className="odoo-btn-secondary" disabled={!profileName.trim() || saveProfile.isPending} onClick={() => saveProfile.mutate()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Save size={13} /> Enregistrer le profil</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 3. Aperçu des opérations et soldes */}
          {pv && (
            <>
              {pv.warnings.map((w, i) => <StatusBanner key={i} tone="warning" icon={AlertTriangle} title={w} />)}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <div><label style={labelStyle}>Libellé du relevé</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder={`Relevé ${pv.treasuryAccount.label}`} style={inputStyle} /></div>
                <div><label style={labelStyle}>Date du relevé</label><input type="date" value={statementDate || pv.statementDate || ''} onChange={e => setStatementDate(e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Solde d'ouverture</label><input value={opening} onChange={e => setOpening(e.target.value)} placeholder={pv.openingBalance != null ? n(pv.openingBalance) : '0,00'} style={inputStyle} inputMode="decimal" /></div>
                <div><label style={labelStyle}>Solde de clôture</label><input value={closing} onChange={e => setClosing(e.target.value)} placeholder={pv.closingBalance != null ? n(pv.closingBalance) : 'calculé'} style={inputStyle} inputMode="decimal" /></div>
              </div>
              {check != null && (check === 0
                ? <StatusBanner tone="success" icon={CheckCircle2} title="Soldes cohérents">Ouverture + opérations du fichier = solde de clôture.</StatusBanner>
                : <StatusBanner tone="danger" icon={AlertTriangle} title={`Écart de ${n(check)} DH entre les soldes et les opérations`}>Vérifiez les soldes saisis ou les colonnes débit/crédit.</StatusBanner>)}

              <div style={{ fontSize: '0.8125rem', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span><strong>{pv.stats.count}</strong> opération(s) lue(s){pv.accountNumber ? ` · compte ${pv.accountNumber}` : ''}</span>
                {pv.stats.duplicates > 0 && <span style={{ color: '#856404' }}>{pv.stats.duplicates} déjà importée(s), écartée(s)</span>}
                <span style={{ color: '#0e7c3a' }}>+ {n(pv.stats.in)}</span>
                <span style={{ color: '#c62828' }}>− {n(pv.stats.out)}</span>
              </div>
              {pv.lines.length > 0 && (
                <div className="odoo-section" style={{ padding: 0, maxHeight: 280, overflowY: 'auto' }}>
                  <table className="odoo-table" style={{ margin: 0 }}>
                    <thead><tr><th style={{ width: 86 }}>Date</th><th>Libellé</th><th style={{ width: 120 }}>Référence</th><th style={{ width: 110, textAlign: 'right' }}>Montant</th><th style={{ width: 110 }} /></tr></thead>
                    <tbody>
                      {pv.lines.map((l, i) => (
                        <tr key={i} style={{ opacity: l.duplicate ? 0.5 : 1 }}>
                          <td style={{ fontSize: '0.75rem' }}>{fmtDate(l.operationDate)}</td>
                          <td style={{ fontSize: '0.8125rem' }}>{l.label || '—'}</td>
                          <td style={{ fontSize: '0.75rem', fontFamily: 'ui-monospace, monospace' }}>{l.reference ?? ''}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: l.direction === 'in' ? '#0e7c3a' : '#c62828' }}>{l.direction === 'in' ? '+' : '−'}{n(l.amount)}</td>
                          <td>{l.duplicate && <span className="odoo-tag odoo-tag-grey">Déjà importée</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button type="button" onClick={() => doImport.mutate()} disabled={!pv || fresh === 0 || doImport.isPending} className="odoo-btn-primary"
            style={{ opacity: !pv || fresh === 0 || doImport.isPending ? 0.5 : 1 }}>
            {doImport.isPending ? 'Import…' : fresh ? `Importer ${fresh} opération(s)` : 'Rien de nouveau à importer'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
