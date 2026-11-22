import { currencySymbol } from '../../../utils/money';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Info, Building2, Scale, ListChecks, CalendarDays, Clock } from 'lucide-react';
import { payrollConfigApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage, amount } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StatusTag } from '../../../components/ui/StatusTag';
import { HrModal, SubmitButton, Field, SectionTitle, LoadingPanel, inputCls } from '../ui';
import { DataPanel, FormSection } from '../../../components/ds';

type Bracket = { upTo: number | null; rate: number; deduction: number };

const pctIn = (v: unknown) => (v === null || v === undefined ? '' : String(Math.round(parseFloat(String(v)) * 100000) / 1000));
const pctOut = (v: string) => parseFloat(v.replace(',', '.')) / 100;

/**
 * Paramètres de paie : employeur (n° CNSS, base journalière), barème légal
 * versionné (CNSS, AMO, IR, frais pro, charges de famille) et catalogue des
 * rubriques. Lecture pour le droit Personnel, modification admin.
 */
export default function PayrollSettingsView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const confirm = useConfirm();
  const { data, isLoading } = useQuery<{ settings: Record<string, any>; taxScales: Record<string, any>[] }>({
    queryKey: ['payroll-settings'],
    queryFn: payrollConfigApi.settings,
  });
  const { data: rubriques = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['payroll-rubriques', 'all'],
    queryFn: () => payrollConfigApi.rubriques(true),
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['payroll-settings'] });
    queryClient.invalidateQueries({ queryKey: ['payroll-rubriques'] });
  };

  // ─── Employeur ───
  const [cnss, setCnss] = useState('');
  // Virement groupe des salaires (mig 325).
  const [bank, setBank] = useState({ employerRib: '', employerBankName: '' });
  const [baseDays, setBaseDays] = useState('26');
  // Conges (lot 2) et temps de travail (lot 3) : taux saisis en %.
  const [rules, setRules] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    const st = data.settings;
    setCnss(st.employer_cnss_number ?? '');
    setBank({ employerRib: st.employer_rib ?? '', employerBankName: st.employer_bank_name ?? '' });
    setBaseDays(String(st.monthly_base_days ?? 26));
    setRules({
      leaveRestWeekday: String(st.leave_rest_weekday ?? 0),
      leaveDaysPerMonth: String(parseFloat(st.leave_days_per_month ?? 1.5)),
      leaveCarryoverYears: String(st.leave_carryover_years ?? 1),
      otRateDay: pctIn(st.ot_rate_day ?? 0.25), otRateNight: pctIn(st.ot_rate_night ?? 0.5),
      otRateRestDay: pctIn(st.ot_rate_rest_day ?? 0.5), otRateRestNight: pctIn(st.ot_rate_rest_night ?? 1),
      nightStart: String(st.night_start ?? '21:00').slice(0, 5), nightEnd: String(st.night_end ?? '06:00').slice(0, 5),
      monthlyLegalHours: String(parseFloat(st.monthly_legal_hours ?? 191)),
      weeklyLegalHours: String(parseFloat(st.weekly_legal_hours ?? 44)),
      holidayWorkedRate: pctIn(st.holiday_worked_rate ?? 1),
      otAnnualQuotaHours: String(parseFloat(st.ot_annual_quota_hours ?? 100)),
      smigPolicy: String(st.smig_policy ?? 'warn'),
    });
  }, [data]);
  const saveSettings = useMutation({
    mutationFn: () => payrollConfigApi.updateSettings({
      employerCnssNumber: cnss || null, monthlyBaseDays: parseInt(baseDays, 10),
      employerRib: bank.employerRib.replace(/\s/g, '') || null, employerBankName: bank.employerBankName || null,
      leaveRestWeekday: parseInt(rules.leaveRestWeekday, 10), leaveDaysPerMonth: parseFloat(rules.leaveDaysPerMonth),
      leaveCarryoverYears: parseInt(rules.leaveCarryoverYears, 10),
      otRateDay: pctOut(rules.otRateDay), otRateNight: pctOut(rules.otRateNight),
      otRateRestDay: pctOut(rules.otRateRestDay), otRateRestNight: pctOut(rules.otRateRestNight),
      nightStart: rules.nightStart, nightEnd: rules.nightEnd,
      monthlyLegalHours: parseFloat(rules.monthlyLegalHours), weeklyLegalHours: parseFloat(rules.weeklyLegalHours),
      holidayWorkedRate: pctOut(rules.holidayWorkedRate), otAnnualQuotaHours: parseFloat(rules.otAnnualQuotaHours),
      smigPolicy: rules.smigPolicy === 'block' ? 'block' : 'warn',
    }),
    onSuccess: () => { invalidate(); notify.success('Paramètres employeur enregistrés'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  // ─── Barème (version en vigueur = la plus récente) ───
  const scale = data?.taxScales?.[0];
  const [form, setForm] = useState<Record<string, string>>({});
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [newScaleDate, setNewScaleDate] = useState('');
  useEffect(() => {
    if (!scale) return;
    setForm({
      cnssPlafond: String(parseFloat(scale.cnss_plafond)),
      cnssRateEmployee: pctIn(scale.cnss_rate_employee), cnssRateEmployer: pctIn(scale.cnss_rate_employer),
      amoRateEmployee: pctIn(scale.amo_rate_employee), amoRateEmployer: pctIn(scale.amo_rate_employer),
      allocFamilialesRate: pctIn(scale.alloc_familiales_rate), taxeFpRate: pctIn(scale.taxe_fp_rate),
      fraisProRateBas: pctIn(scale.frais_pro_rate), fraisProRateHaut: pctIn(scale.frais_pro_rate_haut),
      fraisProSeuilAnnuel: String(parseFloat(scale.frais_pro_seuil_annuel ?? 0)),
      fraisProPlafondAnnuel: String(parseFloat(scale.frais_pro_plafond_annuel ?? 0)),
      deductionFamilleAnnuelle: String(parseFloat(scale.deduction_famille_annuelle ?? 0)),
      maxPersonnesCharge: String(scale.max_personnes_charge ?? 6),
      // G0-11 : SMIG du barème ; vide = contrôle non fait.
      smigMonthly: scale.smig_monthly != null ? String(parseFloat(scale.smig_monthly)) : '',
      smigHourly: scale.smig_hourly != null ? String(parseFloat(scale.smig_hourly)) : '',
    });
    setBrackets((typeof scale.ir_brackets === 'string' ? JSON.parse(scale.ir_brackets) : scale.ir_brackets) as Bracket[]);
  }, [scale]);
  const saveScale = useMutation({
    mutationFn: () => payrollConfigApi.updateTaxScale(scale!.id, {
      cnssPlafond: parseFloat(form.cnssPlafond),
      cnssRateEmployee: pctOut(form.cnssRateEmployee), cnssRateEmployer: pctOut(form.cnssRateEmployer),
      amoRateEmployee: pctOut(form.amoRateEmployee), amoRateEmployer: pctOut(form.amoRateEmployer),
      allocFamilialesRate: pctOut(form.allocFamilialesRate), taxeFpRate: pctOut(form.taxeFpRate),
      fraisProRateBas: pctOut(form.fraisProRateBas), fraisProRateHaut: pctOut(form.fraisProRateHaut),
      fraisProSeuilAnnuel: parseFloat(form.fraisProSeuilAnnuel), fraisProPlafondAnnuel: parseFloat(form.fraisProPlafondAnnuel),
      deductionFamilleAnnuelle: parseFloat(form.deductionFamilleAnnuelle), maxPersonnesCharge: parseInt(form.maxPersonnesCharge, 10),
      smigMonthly: form.smigMonthly?.trim() ? parseFloat(form.smigMonthly.replace(',', '.')) : null,
      smigHourly: form.smigHourly?.trim() ? parseFloat(form.smigHourly.replace(',', '.')) : null,
      irBrackets: brackets,
    }),
    onSuccess: () => { invalidate(); notify.success('Barème enregistré : régénérez les bulletins non payés pour l\'appliquer'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  // ─── Rubriques ───
  const [editRub, setEditRub] = useState<Record<string, any> | null>(null);
  const saveRub = useMutation({
    mutationFn: (r: Record<string, any>) => {
      const payload = {
        label: r.label, soumisCnss: !!r.soumis_cnss, soumisIr: !!r.soumis_ir,
        plafondExonerationMensuel: r.plafond_exoneration_mensuel === '' || r.plafond_exoneration_mensuel == null ? null : parseFloat(r.plafond_exoneration_mensuel),
        notes: r.notes || null,
      };
      return r.id
        ? payrollConfigApi.updateRubrique(r.id, { ...payload, isActive: r.is_active !== false })
        : payrollConfigApi.createRubrique({ ...payload, code: r.code, kind: r.kind });
    },
    onSuccess: () => { invalidate(); setEditRub(null); notify.success('Rubrique enregistrée'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  if (isLoading || !data) return <LoadingPanel />;

  const suffixed = (input: ReactNode, suffix?: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {input}
      {suffix && <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{suffix}</span>}
    </span>
  );
  const field = (key: string, label: string, suffix?: string) => (
    <Field label={label}>
      {suffixed(<input className={inputCls} value={form[key] ?? ''} disabled={!isAdmin} style={{ width: 110 }}
        onChange={e => setForm({ ...form, [key]: e.target.value })} />, suffix)}
    </Field>
  );
  const ruleField = (key: string, label: string, suffix?: string) => (
    <Field label={label}>
      {suffixed(<input className={inputCls} value={rules[key] ?? ''} disabled={!isAdmin} style={{ width: 90 }}
        onChange={e => setRules({ ...rules, [key]: e.target.value })} />, suffix)}
    </Field>
  );
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 } as const;
  // Carte du design Ventes (prj-panel) : fond, coins et ombre viennent de la classe.
  const card = { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 } as const;
  const checkLabel = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!isAdmin && (
        <StatusBanner tone="info" icon={Info} title="Lecture seule">
          Seul un administrateur peut modifier les paramètres de paie.
        </StatusBanner>
      )}

      <section className="prj-panel" style={card}>
        <SectionTitle icon={Building2}>Employeur et temps de travail</SectionTitle>
        <div style={grid}>
          <Field label="N° d'affiliation CNSS">
            <input className={inputCls} value={cnss} disabled={!isAdmin} onChange={e => setCnss(e.target.value)} />
          </Field>
          <Field label="Base journalière (jours / mois)">
            <input className={inputCls} type="number" min={20} max={31} value={baseDays} disabled={!isAdmin} onChange={e => setBaseDays(e.target.value)} />
          </Field>
          <Field label="RIB de l'entreprise (virement des salaires)">
            <input className={inputCls} value={bank.employerRib} disabled={!isAdmin} placeholder="24 chiffres" onChange={e => setBank({ ...bank, employerRib: e.target.value })} />
          </Field>
          <Field label="Banque (agence)">
            <input className={inputCls} value={bank.employerBankName} disabled={!isAdmin} maxLength={80} onChange={e => setBank({ ...bank, employerBankName: e.target.value })} />
          </Field>
        </div>
        <SectionTitle icon={CalendarDays}>Congés</SectionTitle>
        <div style={grid}>
          <Field label="Jour de repos hebdomadaire">
            <select className={inputCls} value={rules.leaveRestWeekday ?? '0'} disabled={!isAdmin} onChange={e => setRules({ ...rules, leaveRestWeekday: e.target.value })}>
              {['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'].map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </Field>
          {ruleField('leaveDaysPerMonth', 'Acquisition par mois', 'j')}
          {ruleField('leaveCarryoverYears', 'Report du reliquat', 'an(s)')}
        </div>
        <SectionTitle icon={Clock}>Heures supplémentaires et jours fériés</SectionTitle>
        <div style={grid}>
          {ruleField('otRateDay', 'Majoration jour', '%')}
          {ruleField('otRateNight', 'Majoration nuit', '%')}
          {ruleField('otRateRestDay', 'Repos hebdo, jour', '%')}
          {ruleField('otRateRestNight', 'Repos hebdo, nuit', '%')}
          {ruleField('nightStart', 'Début de nuit')}
          {ruleField('nightEnd', 'Fin de nuit')}
          {ruleField('monthlyLegalHours', 'Durée légale mensuelle', 'h')}
          {ruleField('weeklyLegalHours', 'Durée légale hebdo', 'h')}
          {ruleField('holidayWorkedRate', 'Férié travaillé (indemnité)', '%')}
          {ruleField('otAnnualQuotaHours', 'Contingent annuel', 'h')}
          {/* G0-11 : que faire d'un bulletin sous le SMIG saisi dans le barème. */}
          <Field label="Salaire sous le SMIG">
            <select className={inputCls} value={rules.smigPolicy ?? 'warn'} disabled={!isAdmin} style={{ width: 150 }}
              onChange={e => setRules({ ...rules, smigPolicy: e.target.value })}>
              <option value="warn">Avertir</option>
              <option value="block">Bloquer la paie</option>
            </select>
          </Field>
        </div>
        {isAdmin && (
          <div><SubmitButton pending={saveSettings.isPending} onClick={() => saveSettings.mutate()}>Enregistrer</SubmitButton></div>
        )}
      </section>

      {scale && (
        <section className="prj-panel" style={card}>
          <SectionTitle icon={Scale}>
            Barème légal — {scale.label}
            <span style={{ fontWeight: 400, color: 'var(--ds-muted)', marginLeft: 8 }}>
              en vigueur depuis le {new Date(scale.effective_from).toLocaleDateString('fr-FR')}
            </span>
          </SectionTitle>
          <div style={grid}>
            {field('cnssPlafond', 'Plafond CNSS mensuel', currencySymbol())}
            {field('cnssRateEmployee', 'CNSS salarié', '%')}
            {field('cnssRateEmployer', 'CNSS patronal', '%')}
            {field('amoRateEmployee', 'AMO salarié', '%')}
            {field('amoRateEmployer', 'AMO patronal (avec participation)', '%')}
            {field('allocFamilialesRate', 'Allocations familiales', '%')}
            {field('taxeFpRate', 'Taxe formation professionnelle', '%')}
            {field('fraisProRateBas', 'Frais pro (sous le seuil)', '%')}
            {field('fraisProRateHaut', 'Frais pro (au-dessus)', '%')}
            {field('fraisProSeuilAnnuel', 'Seuil frais pro (brut annuel)', currencySymbol())}
            {field('fraisProPlafondAnnuel', 'Plafond frais pro annuel', currencySymbol())}
            {field('deductionFamilleAnnuelle', 'Charges de famille / personne / an', currencySymbol())}
            {field('maxPersonnesCharge', 'Personnes à charge max')}
            {field('smigMonthly', 'SMIG mensuel (vide = non contrôlé)', currencySymbol())}
            {field('smigHourly', 'SMIG horaire (vide = non contrôlé)', currencySymbol())}
          </div>
          <FormSection title="Barème IR annuel (IR = revenu net imposable × taux − somme à déduire)">
            <DataPanel label="Barème IR annuel" style={{ maxWidth: 560 }}>
            <table className="odoo-table ds-dense">
              <thead><tr><th>Jusqu'à ({currencySymbol()}/an)</th><th className="ds-num">Taux (%)</th><th className="ds-num">Somme à déduire ({currencySymbol()})</th></tr></thead>
              <tbody>
                {brackets.map((b, i) => (
                  <tr key={i}>
                    <td>{b.upTo === null ? 'Au-delà' : (
                      <input className={`${inputCls} sm`} aria-label={`Plafond de la tranche ${i + 1}`} disabled={!isAdmin} value={b.upTo} style={{ width: 110 }}
                        onChange={e => { const n = [...brackets]; n[i] = { ...b, upTo: parseFloat(e.target.value) || 0 }; setBrackets(n); }} />
                    )}</td>
                    <td className="ds-num">
                      <input className={`${inputCls} sm`} aria-label={`Taux de la tranche ${i + 1}`} disabled={!isAdmin} value={pctIn(b.rate)} style={{ width: 70 }}
                        onChange={e => { const n = [...brackets]; n[i] = { ...b, rate: pctOut(e.target.value) || 0 }; setBrackets(n); }} />
                    </td>
                    <td className="ds-num">
                      <input className={`${inputCls} sm`} aria-label={`Somme à déduire de la tranche ${i + 1}`} disabled={!isAdmin} value={b.deduction} style={{ width: 100 }}
                        onChange={e => { const n = [...brackets]; n[i] = { ...b, deduction: parseFloat(e.target.value) || 0 }; setBrackets(n); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </DataPanel>
          </FormSection>
          {scale.notes && <p style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{scale.notes}</p>}
          {isAdmin && (
            <div><SubmitButton pending={saveScale.isPending} onClick={async () => {
              if (!(await confirm('Modifier le barème légal ?\n\nLes bulletins payés gardent leurs montants. Les autres seront recalculés à la prochaine génération.',
                { title: 'Modifier le barème', confirmLabel: 'Enregistrer' }))) return;
              saveScale.mutate();
            }}>Enregistrer le barème</SubmitButton></div>
          )}
          {/* G0-13 : une nouvelle loi de finances = une nouvelle version datée. Un
              barème déjà utilisé par des bulletins ne se modifie plus. */}
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>
                {Number(scale.payslip_count) > 0
                  ? `${scale.payslip_count} bulletin(s) calculé(s) avec ce barème : ses taux ne sont plus modifiables.`
                  : 'Aucun bulletin calculé avec ce barème : il reste modifiable.'}
              </span>
              <input type="date" className={inputCls} value={newScaleDate} onChange={e => setNewScaleDate(e.target.value)}
                style={{ width: 150 }} aria-label="Date d'effet de la nouvelle version" />
              <button type="button" className="odoo-btn-secondary" disabled={!newScaleDate}
                onClick={async () => {
                  if (!(await confirm(`Créer une nouvelle version du barème, applicable à partir du ${newScaleDate.split('-').reverse().join('/')} ?\n\nElle reprend les valeurs actuelles, à modifier ensuite. Le barème actuel reste appliqué aux mois antérieurs.`,
                    { title: 'Nouvelle version du barème', confirmLabel: 'Créer' }))) return;
                  try {
                    await payrollConfigApi.createTaxScale(newScaleDate);
                    setNewScaleDate(''); invalidate();
                    notify.success('Nouvelle version créée : modifiez ses valeurs puis enregistrez');
                  } catch (err) { notify.error(apiErrorMessage(err, 'Erreur')); }
                }}>
                Nouvelle version
              </button>
            </div>
          )}
        </section>
      )}

      <section className="prj-panel" style={card}>
        <SectionTitle icon={ListChecks} actions={isAdmin ? (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditRub({ kind: 'gain', soumis_cnss: true, soumis_ir: true, is_active: true })}><Plus size={13} aria-hidden="true" /> Nouvelle rubrique</button>
        ) : undefined}>Rubriques de paie</SectionTitle>
        <DataPanel label="Rubriques de paie">
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Code</th><th>Libellé</th><th>Type</th>
              <th>CNSS</th><th>IR</th>
              <th className="ds-num">Exonéré jusqu'à ({currencySymbol()}/mois)</th><th>Statut</th>{isAdmin && <th className="ds-actions"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rubriques.map(r => (
              <tr key={r.id}>
                <td className="ds-ref">{r.code}</td>
                <td className="ds-strong" title={r.notes ?? undefined}>{r.label}</td>
                <td><span className={`odoo-tag ${r.kind === 'gain' ? 'odoo-tag-green' : 'odoo-tag-orange'}`}>{r.kind === 'gain' ? 'Gain' : 'Retenue'}</span></td>
                <td>{r.kind === 'gain' ? (r.soumis_cnss ? 'Soumis' : 'Exonéré') : '—'}</td>
                <td>{r.kind === 'gain' ? (r.soumis_ir ? 'Soumis' : 'Exonéré') : '—'}</td>
                <td className="ds-num">{r.plafond_exoneration_mensuel != null ? amount(parseFloat(r.plafond_exoneration_mensuel)) : '—'}</td>
                <td><StatusTag tone={r.is_active ? 'done' : 'cancelled'} label={r.is_active ? 'Active' : 'Inactive'} /></td>
                {isAdmin && <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditRub({ ...r })}><Pencil size={13} aria-hidden="true" /> Modifier</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        </DataPanel>
      </section>

      {editRub && (
        <HrModal icon={ListChecks} crumb="Rubrique" title={editRub.id ? 'Modifier la rubrique' : 'Nouvelle rubrique'}
          tag={editRub.id ? <span className="odoo-tag odoo-tag-grey" style={{ fontFamily: 'monospace' }}>{editRub.code}</span> : undefined}
          width={520} onClose={() => setEditRub(null)}
          footer={<>
            <button type="button" className="odoo-btn-secondary" onClick={() => setEditRub(null)}>Annuler</button>
            <SubmitButton pending={saveRub.isPending} disabled={!editRub.label || (!editRub.id && !editRub.code)}
              onClick={() => saveRub.mutate(editRub)}>Enregistrer</SubmitButton>
          </>}>
          {!editRub.id && (
            <div className="ds-form-grid">
              <Field label="Code" required>
                <input className={inputCls} value={editRub.code ?? ''} onChange={e => setEditRub({ ...editRub, code: e.target.value.toUpperCase() })} placeholder="PRIME_XXX" />
              </Field>
              <Field label="Type" required>
                <select className={inputCls} value={editRub.kind} onChange={e => setEditRub({ ...editRub, kind: e.target.value })}>
                  <option value="gain">Gain (entre dans le brut)</option>
                  <option value="retenue">Retenue (déduite du net)</option>
                </select>
              </Field>
            </div>
          )}
          <Field label="Libellé" required>
            <input className={inputCls} value={editRub.label ?? ''} onChange={e => setEditRub({ ...editRub, label: e.target.value })} />
          </Field>
          {editRub.kind === 'gain' && (
            <>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={checkLabel}><input type="checkbox" checked={!!editRub.soumis_cnss} onChange={e => setEditRub({ ...editRub, soumis_cnss: e.target.checked })} /> Soumis CNSS/AMO</label>
                <label style={checkLabel}><input type="checkbox" checked={!!editRub.soumis_ir} onChange={e => setEditRub({ ...editRub, soumis_ir: e.target.checked })} /> Soumis IR</label>
              </div>
              <Field label={`Exonéré jusqu'à (${currencySymbol()}/mois, vide = pas de plafond)`}>
                <input className={inputCls} type="number" min="0" step="0.01" value={editRub.plafond_exoneration_mensuel ?? ''}
                  onChange={e => setEditRub({ ...editRub, plafond_exoneration_mensuel: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Notes">
            <textarea className={inputCls} rows={2} value={editRub.notes ?? ''} onChange={e => setEditRub({ ...editRub, notes: e.target.value })} />
          </Field>
          {editRub.id && (
            <label style={checkLabel}><input type="checkbox" checked={editRub.is_active !== false} onChange={e => setEditRub({ ...editRub, is_active: e.target.checked })} /> Active</label>
          )}
        </HrModal>
      )}
    </div>
  );
}
