import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileCheck2, Banknote, Lock, AlertTriangle, Upload } from 'lucide-react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { payrollConfigApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { MONTH_NAMES, apiErrorMessage, downloadCsv } from '../shared';

type Kind = 'cnss' | 'ir' | 'cimr';
const KIND_LABEL: Record<Kind, string> = { cnss: 'CNSS / AMO', ir: 'IR sur salaires', cimr: 'CIMR' };
const KIND_ACCOUNT: Record<Kind, string> = { cnss: '4441', ir: '44525', cimr: '4443' };
const KIND_HELP: Record<Kind, string> = {
  cnss: 'Bordereau de déclaration des salaires (Damancom), avant le 10 du mois suivant.',
  ir: 'Versement de l\'IR retenu (SIMPL-IR), avant la fin du mois suivant.',
  cimr: 'Cotisations de retraite complémentaire, selon le calendrier CIMR.',
};

const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Déclarations sociales et fiscales du mois : états CNSS (BDS), IR et CIMR
 * calculés depuis les bulletins, déclaration (montant figé, mois clôturé) et
 * règlement (paiement qui solde la dette 4441 / 44525 / 4443). Plus le
 * récapitulatif annuel IR par salarié (état 9421).
 */
export default function DeclarationsView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const now = new Date();
  // Par defaut : le mois precedent (celui qu'on declare).
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [detail, setDetail] = useState<Kind>('cnss');
  const [settleKind, setSettleKind] = useState<Kind | null>(null);
  const [settleForm, setSettleForm] = useState({ paymentMethod: 'bank', paymentDate: new Date().toISOString().slice(0, 10) });

  const { data, isLoading } = useQuery<Record<string, any>>({
    queryKey: ['payroll-declarations', month, year],
    queryFn: () => payrollConfigApi.declarations(month, year),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['payroll-declarations'] });

  const declare = useMutation({
    mutationFn: ({ kind, reference }: { kind: Kind; reference: string | null }) => payrollConfigApi.declare({ kind, month, year, reference }),
    onSuccess: () => { invalidate(); notify.success('Déclaration enregistrée'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const settle = useMutation({
    mutationFn: (kind: Kind) => payrollConfigApi.settle({ kind, month, year, ...settleForm }),
    onSuccess: () => { invalidate(); setSettleKind(null); notify.success('Règlement enregistré : dette soldée en comptabilité'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  const period = `${String(month).padStart(2, '0')}-${year}`;
  const closed = data?.period?.status === 'closed';
  const declared = (k: Kind) => (data?.declared as Record<string, any>[] | undefined)?.find(d => d.kind === k);
  const due: Record<Kind, number> = {
    cnss: data?.cnss?.totals?.total ?? 0,
    ir: data?.ir?.totals?.ir ?? 0,
    cimr: data?.cimr ?? 0,
  };

  // e-BDS Damancom : le fichier se construit SUR le preetabli du mois (les
  // zones A00-A03 sont recopiees a l'identique), d'ou l'import prealable.
  const preetabliInput = useRef<HTMLInputElement>(null);
  const [ebdsResult, setEbdsResult] = useState<{ fileName: string; warnings: string[]; totals: Record<string, number> } | null>(null);
  const ebds = useMutation({
    mutationFn: (file: File) => payrollConfigApi.ebds(month, year, file),
    onSuccess: (r: { fileName: string; content: string; warnings: string[]; totals: Record<string, number> }) => {
      const bytes = Uint8Array.from(atob(r.content), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url; a.download = r.fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setEbdsResult(r);
      notify.success(`Fichier ${r.fileName} généré`);
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Préétabli illisible')),
  });

  const exportCnss = () => downloadCsv(`bds_cnss_${period}.csv`,
    ['N° CNSS', 'Nom et prénom', 'CIN', 'Jours', 'Salaire réel', 'Salaire plafonné', 'Prestations sal.', 'Prestations pat.', 'AMO sal.', 'AMO pat.', 'Alloc. familiales', 'TFP', 'Total'],
    (data?.cnss?.rows ?? []).map((r: Record<string, any>) => [r.cnssNumber, r.name, r.cin, String(r.days), r.salaireReel, r.salairePlafonne,
      r.prestationsSalarie, r.prestationsPatronal, r.amoSalarie, r.amoPatronal, r.allocFamiliales, r.taxeFp, r.total]));
  const exportIr = () => downloadCsv(`etat_ir_${period}.csv`,
    ['Nom et prénom', 'CIN', 'Pers. à charge', 'Brut imposable', 'Frais pro', 'Cotisations', 'Net imposable', 'IR brut', 'Charges famille', 'IR retenu'],
    (data?.ir?.rows ?? []).map((r: Record<string, any>) => [r.name, r.cin, String(r.dependents), r.brutImposable, r.fraisPro, r.cotisations,
      r.netImposable, r.irBrut, r.deductionFamille, r.ir]));
  const exportAnnual = async () => {
    try {
      const rows = await payrollConfigApi.annualIr(year);
      downloadCsv(`recap_ir_9421_${year}.csv`,
        ['Nom et prénom', 'CIN', 'N° CNSS', 'Adresse', 'Pers. à charge', 'Mois', 'Jours', 'Brut', 'Exonéré', 'Brut imposable', 'Frais pro', 'Cotisations', 'Net imposable', 'IR retenu'],
        rows.map((r: Record<string, any>) => [r.name, r.cin, r.cnssNumber, r.address, String(r.dependents), String(r.months), String(r.days),
          r.brut, r.exonere, r.brutImposable, r.fraisPro, r.cotisations, r.netImposable, r.ir]));
    } catch (err) { notify.error(apiErrorMessage(err, 'Erreur')); }
  };

  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <SearchSelect options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))} value={String(month)}
            onChange={id => id && setMonth(parseInt(id))} placeholder="Mois" width={140} />
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input" style={{ width: 96 }} />
        </div>
        <button className="odoo-btn-secondary" onClick={exportAnnual} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="Cumuls annuels par salarié : contenu de l'état 9421 (traitements et salaires)">
          <Download size={13} /> Récap annuel IR {year} (9421)
        </button>
      </div>

      {!closed && (
        <div className="odoo-alert warning" style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem' }}>
          <Lock size={12} style={{ display: 'inline', marginRight: 4 }} />
          Paie de {MONTH_NAMES[month - 1]} {year} non clôturée : les montants sont provisoires. Clôturez le mois (Paie mensuelle) pour comptabiliser et déclarer.
        </div>
      )}
      {(data?.cnss?.missingCnssNumber?.length ?? 0) > 0 && (
        <div className="odoo-alert warning" style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem' }}>
          <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
          N° CNSS manquant : {data!.cnss.missingCnssNumber.join(', ')}. Renseignez-le dans la fiche employé avant la déclaration.
        </div>
      )}

      {isLoading || !data ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : (
        <>
          <div className="odoo-stat-grid">
            {(['cnss', 'ir', 'cimr'] as Kind[]).map(k => {
              const d = declared(k);
              return (
                <div key={k} className="odoo-stat-card" style={{ cursor: k !== 'cimr' ? 'pointer' : undefined, outline: detail === k ? '2px solid var(--theme-accent)' : undefined }}
                  onClick={() => k !== 'cimr' && setDetail(k)}>
                  <div className="odoo-stat-card-label">{KIND_LABEL[k]} <span style={{ color: 'var(--odoo-text-light)' }}>· {KIND_ACCOUNT[k]}</span></div>
                  <div className="odoo-stat-card-value">{fmt(d ? parseFloat(d.amount) : due[k])} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
                  <div className="odoo-stat-card-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {d?.status === 'paid' ? <span className="odoo-tag odoo-tag-green">Réglée le {new Date(d.paid_at).toLocaleDateString('fr-FR')}</span>
                      : d ? <span className="odoo-tag odoo-tag-orange">Déclarée{d.reference ? ` · ${d.reference}` : ''}</span>
                      : <span className="odoo-tag odoo-tag-grey">À déclarer</span>}
                    {isAdmin && closed && !d && due[k] > 0 && (
                      <button className="odoo-btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.6875rem', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        disabled={declare.isPending}
                        onClick={e => { e.stopPropagation(); const ref = prompt(`Référence de la déclaration ${KIND_LABEL[k]} (n° de bordereau, quittance…) — facultatif`); if (ref !== null) declare.mutate({ kind: k, reference: ref || null }); }}>
                        <FileCheck2 size={11} /> Déclarer
                      </button>
                    )}
                    {isAdmin && d && d.status !== 'paid' && (
                      <button className="odoo-btn-primary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.6875rem', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        onClick={e => { e.stopPropagation(); setSettleKind(k); }}>
                        <Banknote size={11} /> Régler
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '0.625rem', color: 'var(--odoo-text-muted)', marginTop: 4 }}>{KIND_HELP[k]}</div>
                </div>
              );
            })}
          </div>

          {detail === 'cnss' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>Bordereau CNSS — {MONTH_NAMES[month - 1]} {year}</h3>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <input ref={preetabliInput} type="file" accept=".txt,text/plain" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) ebds.mutate(f); e.target.value = ''; }} />
                  <button className="odoo-btn-primary" onClick={() => preetabliInput.current?.click()} disabled={ebds.isPending || !data.cnss.rows.length}
                    title="Importez le préétabli AFFEBDS_… téléchargé sur Damancom : le fichier DS_… à déposer est généré à partir de lui et des bulletins du mois."
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Upload size={13} /> Fichier e-BDS (Damancom)</button>
                  <button className="odoo-btn-secondary" onClick={exportCnss} disabled={!data.cnss.rows.length}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Download size={13} /> CSV</button>
                </div>
              </div>
              {ebdsResult && (
                <div className={`odoo-alert ${ebdsResult.warnings.length ? 'warning' : 'info'}`} style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem' }}>
                  <strong>{ebdsResult.fileName}</strong> : {ebdsResult.totals.salaries} salarié(s) dont {ebdsResult.totals.entrants} entrant(s) et {ebdsResult.totals.sortants} sortant(s),
                  {' '}{ebdsResult.totals.jours} jours, salaire réel {fmt(ebdsResult.totals.salaireReel)} DH, plafonné {fmt(ebdsResult.totals.salairePlafonne)} DH.
                  {ebdsResult.warnings.length > 0 && (
                    <ul style={{ margin: '4px 0 0 16px', listStyle: 'disc' }}>{ebdsResult.warnings.map(w => <li key={w}>{w}</li>)}</ul>
                  )}
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead><tr>
                    <th>N° CNSS</th><th>Salarié</th><th style={{ textAlign: 'center' }}>Jours</th>
                    <th style={{ textAlign: 'right' }}>Salaire réel</th><th style={{ textAlign: 'right' }}>Plafonné</th>
                    <th style={{ textAlign: 'right' }}>Prest. sal.</th><th style={{ textAlign: 'right' }}>Prest. pat.</th>
                    <th style={{ textAlign: 'right' }}>AMO sal.</th><th style={{ textAlign: 'right' }}>AMO pat.</th>
                    <th style={{ textAlign: 'right' }}>AF</th><th style={{ textAlign: 'right' }}>TFP</th><th style={{ textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>
                    {data.cnss.rows.map((r: Record<string, any>) => (
                      <tr key={r.payrollId}>
                        <td style={{ color: r.cnssNumber ? undefined : '#dc3545' }}>{r.cnssNumber || 'manquant'}</td>
                        <td>{r.name}</td><td style={{ textAlign: 'center' }}>{r.days}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.salaireReel)}</td><td style={{ textAlign: 'right' }}>{fmt(r.salairePlafonne)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.prestationsSalarie)}</td><td style={{ textAlign: 'right' }}>{fmt(r.prestationsPatronal)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.amoSalarie)}</td><td style={{ textAlign: 'right' }}>{fmt(r.amoPatronal)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.allocFamiliales)}</td><td style={{ textAlign: 'right' }}>{fmt(r.taxeFp)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.total)}</td>
                      </tr>
                    ))}
                    {!data.cnss.rows.length && <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}>Aucun bulletin déclaré ce mois.</td></tr>}
                  </tbody>
                  {data.cnss.rows.length > 0 && (
                    <tfoot><tr style={{ fontWeight: 700 }}>
                      <td colSpan={3}>Total</td>
                      <td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.salaireReel)}</td><td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.salairePlafonne)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.prestationsSalarie)}</td><td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.prestationsPatronal)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.amoSalarie)}</td><td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.amoPatronal)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.allocFamiliales)}</td><td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.taxeFp)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(data.cnss.totals.total)}</td>
                    </tr></tfoot>
                  )}
                </table>
              </div>
            </section>
          ) : (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>État IR — {MONTH_NAMES[month - 1]} {year}</h3>
                <button className="odoo-btn-secondary" onClick={exportIr} disabled={!data.ir.rows.length}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Download size={13} /> CSV</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead><tr>
                    <th>Salarié</th><th>CIN</th><th style={{ textAlign: 'center' }}>Pers.</th>
                    <th style={{ textAlign: 'right' }}>Brut imposable</th><th style={{ textAlign: 'right' }}>Frais pro</th>
                    <th style={{ textAlign: 'right' }}>Cotisations</th><th style={{ textAlign: 'right' }}>Net imposable</th>
                    <th style={{ textAlign: 'right' }}>IR brut</th><th style={{ textAlign: 'right' }}>Famille</th><th style={{ textAlign: 'right' }}>IR retenu</th>
                  </tr></thead>
                  <tbody>
                    {data.ir.rows.map((r: Record<string, any>) => (
                      <tr key={r.payrollId}>
                        <td>{r.name}</td><td>{r.cin || '—'}</td><td style={{ textAlign: 'center' }}>{r.dependents}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.brutImposable)}</td><td style={{ textAlign: 'right' }}>{fmt(r.fraisPro)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.cotisations)}</td><td style={{ textAlign: 'right' }}>{fmt(r.netImposable)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.irBrut)}</td><td style={{ textAlign: 'right' }}>{fmt(r.deductionFamille)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.ir)}</td>
                      </tr>
                    ))}
                    {!data.ir.rows.length && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}>Aucun bulletin déclaré ce mois.</td></tr>}
                  </tbody>
                  {data.ir.rows.length > 0 && (
                    <tfoot><tr style={{ fontWeight: 700 }}>
                      <td colSpan={3}>Total</td><td style={{ textAlign: 'right' }}>{fmt(data.ir.totals.brutImposable)}</td>
                      <td colSpan={2}></td><td style={{ textAlign: 'right' }}>{fmt(data.ir.totals.netImposable)}</td>
                      <td colSpan={2}></td><td style={{ textAlign: 'right' }}>{fmt(data.ir.totals.ir)}</td>
                    </tr></tfoot>
                  )}
                </table>
              </div>
            </section>
          )}

          <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
            Le fichier e-BDS (format CNSS à largeur fixe, cahier des charges e-BDS) se dépose sur Damancom ; le CSV reprend les mêmes données pour contrôle, et l'état IR ce qu'il faut saisir sur SIMPL-IR.
            À la clôture du mois, la paie est comptabilisée (OD) : 6171 / 6174 au débit, 4441, 4443, 44525 et 4432 au crédit. Régler une déclaration solde le compte de dette correspondant.
          </div>
        </>
      )}

      {settleKind && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSettleKind(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="text-lg font-bold">Régler {KIND_LABEL[settleKind]} — {MONTH_NAMES[month - 1]} {year}</h2>
            <p className="text-sm">Montant : <strong>{fmt(parseFloat(declared(settleKind)?.amount ?? '0'))} DH</strong> (compte {KIND_ACCOUNT[settleKind]})</p>
            <label className="text-sm">Mode
              <select className="input" value={settleForm.paymentMethod} onChange={e => setSettleForm({ ...settleForm, paymentMethod: e.target.value })}>
                <option value="bank">Virement / prélèvement</option>
                <option value="check">Chèque</option>
                <option value="cash">Espèces</option>
              </select>
            </label>
            <label className="text-sm">Date
              <input className="input" type="date" value={settleForm.paymentDate} onChange={e => setSettleForm({ ...settleForm, paymentDate: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button className="odoo-btn-secondary" onClick={() => setSettleKind(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={settle.isPending} onClick={() => settle.mutate(settleKind)}>Enregistrer le règlement</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
