import { money, currencySymbol } from '../../../utils/money';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileCheck2, Banknote, Lock, AlertTriangle, Landmark, Upload } from 'lucide-react';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StatusTag } from '../../../components/ui/StatusTag';
import { HrModal, SubmitButton, PromptDialog, Field, LoadingPanel, Segmented, HrHeaderActions, inputCls } from '../ui';
import { KpiGrid, KpiCard, Toolbar, DataPanel, TableFooter, SectionHeader, Alert, ErrorState } from '../../../components/ds';
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
  const [declareKind, setDeclareKind] = useState<Kind | null>(null);
  const [settleForm, setSettleForm] = useState({ paymentMethod: 'bank', paymentDate: new Date().toISOString().slice(0, 10) });

  const { data, isLoading, isError, refetch } = useQuery<Record<string, any>>({
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

  const cur = currencySymbol();

  return (
    <>
      {/* En-tête de page : export annuel en secondaire, puis le fichier e-BDS (action principale du bordereau CNSS). */}
      <HrHeaderActions>
        <button type="button" className="odoo-btn-secondary" onClick={exportAnnual} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="Cumuls annuels par salarié : contenu de l'état 9421 (traitements et salaires)">
          <Download size={13} aria-hidden="true" /> Récapitulatif annuel IR {year} (9421)
        </button>
        {detail === 'cnss' && (
          <button type="button" className="odoo-btn-primary" onClick={() => preetabliInput.current?.click()} disabled={ebds.isPending || !data?.cnss.rows.length}
            title="Importez le préétabli AFFEBDS_… téléchargé sur Damancom : le fichier DS_… à déposer est généré à partir de lui et des bulletins du mois."
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Upload size={13} aria-hidden="true" /> Fichier e-BDS (Damancom)</button>
        )}
      </HrHeaderActions>
      <input ref={preetabliInput} type="file" accept=".txt,text/plain" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1}
        onChange={e => { const f = e.target.files?.[0]; if (f) ebds.mutate(f); e.target.value = ''; }} />

      {!closed && (
        <StatusBanner tone="warning" icon={Lock} title={`Paie de ${MONTH_NAMES[month - 1]} ${year} non clôturée`}>
          Les montants sont provisoires. Clôturez le mois (Paie mensuelle) pour comptabiliser et déclarer.
        </StatusBanner>
      )}
      {(data?.cnss?.missingCnssNumber?.length ?? 0) > 0 && (
        <StatusBanner tone="danger" icon={AlertTriangle} title="N° CNSS manquant">
          {data!.cnss.missingCnssNumber.join(', ')}. Renseignez-le dans la fiche employé avant la déclaration.
        </StatusBanner>
      )}

      {data && (
        <KpiGrid label="Déclarations du mois">
          {(['cnss', 'ir', 'cimr'] as Kind[]).map(k => {
            const d = declared(k);
            return (
              <KpiCard key={k} label={`${KIND_LABEL[k]} (${cur})`} aside={`compte ${KIND_ACCOUNT[k]}`} value={fmt(d ? parseFloat(d.amount) : due[k])}
                sub={<span style={{ display: 'grid', gap: 6 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {d?.status === 'paid' ? <StatusTag tone="done" label={`Réglée le ${new Date(d.paid_at).toLocaleDateString('fr-FR')}`} />
                      : d ? <StatusTag tone="progress" icon={FileCheck2} label={`Déclarée${d.reference ? ` · ${d.reference}` : ''}`} />
                      : <StatusTag tone="todo" label="À déclarer" />}
                    {isAdmin && closed && !d && due[k] > 0 && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={declare.isPending} onClick={() => setDeclareKind(k)}>
                        <FileCheck2 size={13} aria-hidden="true" /> Déclarer
                      </button>
                    )}
                    {isAdmin && d && d.status !== 'paid' && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setSettleKind(k)}>
                        <Banknote size={13} aria-hidden="true" /> Régler
                      </button>
                    )}
                  </span>
                  <span style={{ fontSize: 12 }}>{KIND_HELP[k]}</span>
                </span>} />
            );
          })}
        </KpiGrid>
      )}

      {/* Barre d'outils : période, puis bascule entre le bordereau CNSS et l'état IR. */}
      <Toolbar>
        <div className="hr-tools">
          <SearchSelect options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))} value={String(month)}
            onChange={id => id && setMonth(parseInt(id))} placeholder="Mois" width={140} />
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="odoo-filter-dropdown" style={{ width: 96 }} aria-label="Année" />
        </div>
        <Segmented label="État affiché" value={detail === 'cnss' ? 'cnss' : 'ir'} onChange={k => setDetail(k)}
          options={[{ key: 'cnss', label: 'Bordereau CNSS' }, { key: 'ir', label: 'État IR' }]} />
      </Toolbar>

      {isLoading ? (
        <LoadingPanel />
      ) : isError || !data ? (
        <ErrorState title="Les déclarations n'ont pas pu être chargées" onRetry={() => void refetch()} />
      ) : (
        <>
          {detail === 'cnss' ? (
            <>
              <SectionHeader title={`Bordereau CNSS — ${MONTH_NAMES[month - 1]} ${year}`}>
                <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={exportCnss} disabled={!data.cnss.rows.length}><Download size={13} aria-hidden="true" /> Exporter</button>
              </SectionHeader>
              {ebdsResult && (
                <Alert tone={ebdsResult.warnings.length ? 'warning' : 'info'}>
                  <strong>{ebdsResult.fileName}</strong> : {ebdsResult.totals.salaries} salarié(s) dont {ebdsResult.totals.entrants} entrant(s) et {ebdsResult.totals.sortants} sortant(s),
                  {' '}{ebdsResult.totals.jours} jours, salaire réel {money(ebdsResult.totals.salaireReel)}, plafonné {money(ebdsResult.totals.salairePlafonne)}.
                  {ebdsResult.warnings.length > 0 && (
                    <ul style={{ margin: '4px 0 0 16px', listStyle: 'disc', fontWeight: 400 }}>{ebdsResult.warnings.map(w => <li key={w}>{w}</li>)}</ul>
                  )}
                </Alert>
              )}
              <DataPanel label="Bordereau CNSS" footer={<TableFooter note={`${data.cnss.rows.length} salarié${data.cnss.rows.length > 1 ? 's' : ''} déclaré${data.cnss.rows.length > 1 ? 's' : ''} · montants en ${cur}`} />}>
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>N° CNSS</th><th>Salarié</th><th className="ds-num">Jours</th>
                    <th className="ds-num">Salaire réel</th><th className="ds-num">Salaire plafonné</th>
                    <th className="ds-num">Prestations salariales</th><th className="ds-num">Prestations patronales</th>
                    <th className="ds-num">AMO salariale</th><th className="ds-num">AMO patronale</th>
                    <th className="ds-num" title="Allocations familiales">Allocations familiales</th><th className="ds-num" title="Taxe de formation professionnelle">Taxe de formation</th><th className="ds-num">Total</th>
                  </tr></thead>
                  <tbody>
                    {data.cnss.rows.map((r: Record<string, any>) => (
                      <tr key={r.payrollId}>
                        <td className="ds-ref">{r.cnssNumber || <StatusTag tone="blocked" label="Manquant" />}</td>
                        <td className="ds-strong">{r.name}</td><td className="ds-num">{r.days}</td>
                        <td className="ds-num">{fmt(r.salaireReel)}</td><td className="ds-num">{fmt(r.salairePlafonne)}</td>
                        <td className="ds-num">{fmt(r.prestationsSalarie)}</td><td className="ds-num">{fmt(r.prestationsPatronal)}</td>
                        <td className="ds-num">{fmt(r.amoSalarie)}</td><td className="ds-num">{fmt(r.amoPatronal)}</td>
                        <td className="ds-num">{fmt(r.allocFamiliales)}</td><td className="ds-num">{fmt(r.taxeFp)}</td>
                        <td className="ds-num ds-strong">{fmt(r.total)}</td>
                      </tr>
                    ))}
                    {!data.cnss.rows.length && <tr><td colSpan={12} style={{ color: 'var(--ds-muted)' }}>Aucun bulletin déclaré ce mois.</td></tr>}
                  </tbody>
                  {data.cnss.rows.length > 0 && (
                    <tfoot><tr>
                      <td colSpan={3}>Total</td>
                      <td className="ds-num">{fmt(data.cnss.totals.salaireReel)}</td><td className="ds-num">{fmt(data.cnss.totals.salairePlafonne)}</td>
                      <td className="ds-num">{fmt(data.cnss.totals.prestationsSalarie)}</td><td className="ds-num">{fmt(data.cnss.totals.prestationsPatronal)}</td>
                      <td className="ds-num">{fmt(data.cnss.totals.amoSalarie)}</td><td className="ds-num">{fmt(data.cnss.totals.amoPatronal)}</td>
                      <td className="ds-num">{fmt(data.cnss.totals.allocFamiliales)}</td><td className="ds-num">{fmt(data.cnss.totals.taxeFp)}</td>
                      <td className="ds-num">{fmt(data.cnss.totals.total)}</td>
                    </tr></tfoot>
                  )}
                </table>
              </DataPanel>
            </>
          ) : (
            <>
              <SectionHeader title={`État IR — ${MONTH_NAMES[month - 1]} ${year}`}>
                <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={exportIr} disabled={!data.ir.rows.length}><Download size={13} aria-hidden="true" /> Exporter</button>
              </SectionHeader>
              <DataPanel label="État IR" footer={<TableFooter note={`${data.ir.rows.length} salarié${data.ir.rows.length > 1 ? 's' : ''} · montants en ${cur}`} />}>
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Salarié</th><th>CIN</th><th className="ds-num">Personnes à charge</th>
                    <th className="ds-num">Brut imposable</th><th className="ds-num">Frais professionnels</th>
                    <th className="ds-num">Cotisations</th><th className="ds-num">Net imposable</th>
                    <th className="ds-num">IR brut</th><th className="ds-num">Déduction famille</th><th className="ds-num">IR retenu</th>
                  </tr></thead>
                  <tbody>
                    {data.ir.rows.map((r: Record<string, any>) => (
                      <tr key={r.payrollId}>
                        <td className="ds-strong">{r.name}</td><td className="ds-ref">{r.cin || '—'}</td><td className="ds-num">{r.dependents}</td>
                        <td className="ds-num">{fmt(r.brutImposable)}</td><td className="ds-num">{fmt(r.fraisPro)}</td>
                        <td className="ds-num">{fmt(r.cotisations)}</td><td className="ds-num">{fmt(r.netImposable)}</td>
                        <td className="ds-num">{fmt(r.irBrut)}</td><td className="ds-num">{fmt(r.deductionFamille)}</td>
                        <td className="ds-num ds-strong">{fmt(r.ir)}</td>
                      </tr>
                    ))}
                    {!data.ir.rows.length && <tr><td colSpan={10} style={{ color: 'var(--ds-muted)' }}>Aucun bulletin déclaré ce mois.</td></tr>}
                  </tbody>
                  {data.ir.rows.length > 0 && (
                    <tfoot><tr>
                      <td colSpan={3}>Total</td><td className="ds-num">{fmt(data.ir.totals.brutImposable)}</td>
                      <td colSpan={2}></td><td className="ds-num">{fmt(data.ir.totals.netImposable)}</td>
                      <td colSpan={2}></td><td className="ds-num">{fmt(data.ir.totals.ir)}</td>
                    </tr></tfoot>
                  )}
                </table>
              </DataPanel>
            </>
          )}

          <div className="prj-note" style={{ fontSize: 12, color: 'var(--ds-muted)', margin: '0 4px' }}>
            Le fichier e-BDS (format CNSS à largeur fixe, cahier des charges e-BDS) se dépose sur Damancom ; l'export reprend les mêmes données pour contrôle, et l'état IR ce qu'il faut saisir sur SIMPL-IR.
            À la clôture du mois, la paie est comptabilisée (OD) : 6171 / 6174 au débit, 4441, 4443, 44525 et 4432 au crédit. Régler une déclaration solde le compte de dette correspondant.
          </div>
        </>
      )}

      {declareKind && (
        <PromptDialog icon={FileCheck2} crumb="Déclaration" title={`${KIND_LABEL[declareKind]} — ${MONTH_NAMES[month - 1]} ${year}`}
          label="Référence (n° de bordereau, quittance…) — facultatif" confirmLabel="Déclarer"
          onCancel={() => setDeclareKind(null)}
          onConfirm={ref => { const k = declareKind; setDeclareKind(null); declare.mutate({ kind: k, reference: ref || null }); }} />
      )}

      {settleKind && (
        <HrModal icon={Landmark} crumb="Règlement" title={`${KIND_LABEL[settleKind]} — ${MONTH_NAMES[month - 1]} ${year}`}
          tag={<span className="odoo-tag odoo-tag-grey">compte {KIND_ACCOUNT[settleKind]}</span>}
          width={440} onClose={() => setSettleKind(null)}
          footer={<>
            <button type="button" className="odoo-btn-secondary" onClick={() => setSettleKind(null)}>Annuler</button>
            <SubmitButton pending={settle.isPending} onClick={() => settle.mutate(settleKind)}>Enregistrer le règlement</SubmitButton>
          </>}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14 }}>
            <span style={{ color: 'var(--ds-muted)' }}>Montant</span>
            <strong style={{ fontSize: 16, color: 'var(--ds-ink)' }}>{money(parseFloat(declared(settleKind)?.amount ?? '0'))}</strong>
          </div>
          <Field label="Mode">
            <select className={inputCls} value={settleForm.paymentMethod} onChange={e => setSettleForm({ ...settleForm, paymentMethod: e.target.value })}>
              <option value="bank">Virement / prélèvement</option>
              <option value="check">Chèque</option>
              <option value="cash">Espèces</option>
            </select>
          </Field>
          <Field label="Date">
            <input className={inputCls} type="date" value={settleForm.paymentDate} onChange={e => setSettleForm({ ...settleForm, paymentDate: e.target.value })} />
          </Field>
        </HrModal>
      )}
    </>
  );
}
