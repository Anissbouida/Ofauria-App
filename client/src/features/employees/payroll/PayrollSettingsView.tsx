import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil, X } from 'lucide-react';
import { payrollConfigApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage } from '../shared';

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
  const [baseDays, setBaseDays] = useState('26');
  useEffect(() => {
    if (!data) return;
    setCnss(data.settings.employer_cnss_number ?? '');
    setBaseDays(String(data.settings.monthly_base_days ?? 26));
  }, [data]);
  const saveSettings = useMutation({
    mutationFn: () => payrollConfigApi.updateSettings({ employerCnssNumber: cnss || null, monthlyBaseDays: parseInt(baseDays, 10) }),
    onSuccess: () => { invalidate(); notify.success('Paramètres employeur enregistrés'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  // ─── Barème (version en vigueur = la plus récente) ───
  const scale = data?.taxScales?.[0];
  const [form, setForm] = useState<Record<string, string>>({});
  const [brackets, setBrackets] = useState<Bracket[]>([]);
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

  if (isLoading || !data) return <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>;

  const field = (key: string, label: string, suffix?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem' }}>
      <span style={{ color: 'var(--odoo-text-muted)' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input className="input" value={form[key] ?? ''} disabled={!isAdmin} style={{ width: 110 }}
          onChange={e => setForm({ ...form, [key]: e.target.value })} />
        {suffix && <span style={{ color: 'var(--odoo-text-muted)' }}>{suffix}</span>}
      </span>
    </label>
  );
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 } as const;
  const card = { border: '1px solid var(--odoo-border)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!isAdmin && (
        <div className="odoo-alert info" style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem' }}>
          Lecture seule : seul un administrateur peut modifier les paramètres de paie.
        </div>
      )}

      <section style={card}>
        <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>Employeur</h3>
        <div style={grid}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--odoo-text-muted)' }}>N° d'affiliation CNSS</span>
            <input className="input" value={cnss} disabled={!isAdmin} onChange={e => setCnss(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--odoo-text-muted)' }}>Base journalière (jours / mois)</span>
            <input className="input" type="number" min={20} max={31} value={baseDays} disabled={!isAdmin} onChange={e => setBaseDays(e.target.value)} />
          </label>
        </div>
        {isAdmin && (
          <div><button className="odoo-btn-primary" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Save size={13} /> Enregistrer</button></div>
        )}
      </section>

      {scale && (
        <section style={card}>
          <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>
            Barème légal — {scale.label}
            <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
              en vigueur depuis le {new Date(scale.effective_from).toLocaleDateString('fr-FR')}
            </span>
          </h3>
          <div style={grid}>
            {field('cnssPlafond', 'Plafond CNSS mensuel', 'DH')}
            {field('cnssRateEmployee', 'CNSS salarié', '%')}
            {field('cnssRateEmployer', 'CNSS patronal', '%')}
            {field('amoRateEmployee', 'AMO salarié', '%')}
            {field('amoRateEmployer', 'AMO patronal (avec participation)', '%')}
            {field('allocFamilialesRate', 'Allocations familiales', '%')}
            {field('taxeFpRate', 'Taxe formation professionnelle', '%')}
            {field('fraisProRateBas', 'Frais pro (sous le seuil)', '%')}
            {field('fraisProRateHaut', 'Frais pro (au-dessus)', '%')}
            {field('fraisProSeuilAnnuel', 'Seuil frais pro (brut annuel)', 'DH')}
            {field('fraisProPlafondAnnuel', 'Plafond frais pro annuel', 'DH')}
            {field('deductionFamilleAnnuelle', 'Charges de famille / personne / an', 'DH')}
            {field('maxPersonnesCharge', 'Personnes à charge max')}
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', marginBottom: 4 }}>Barème IR annuel (IR = revenu net imposable × taux − somme à déduire)</p>
            <table className="odoo-table" style={{ maxWidth: 520 }}>
              <thead><tr><th>Jusqu'à (DH/an)</th><th style={{ textAlign: 'right' }}>Taux</th><th style={{ textAlign: 'right' }}>Somme à déduire</th></tr></thead>
              <tbody>
                {brackets.map((b, i) => (
                  <tr key={i}>
                    <td>{b.upTo === null ? 'Au-delà' : (
                      <input className="input" disabled={!isAdmin} value={b.upTo} style={{ width: 110 }}
                        onChange={e => { const n = [...brackets]; n[i] = { ...b, upTo: parseFloat(e.target.value) || 0 }; setBrackets(n); }} />
                    )}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="input" disabled={!isAdmin} value={pctIn(b.rate)} style={{ width: 70 }}
                        onChange={e => { const n = [...brackets]; n[i] = { ...b, rate: pctOut(e.target.value) || 0 }; setBrackets(n); }} /> %
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="input" disabled={!isAdmin} value={b.deduction} style={{ width: 100 }}
                        onChange={e => { const n = [...brackets]; n[i] = { ...b, deduction: parseFloat(e.target.value) || 0 }; setBrackets(n); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scale.notes && <p style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{scale.notes}</p>}
          {isAdmin && (
            <div><button className="odoo-btn-primary" disabled={saveScale.isPending} onClick={() => {
              if (confirm('Modifier le barème légal ?\n\nLes bulletins payés gardent leurs montants. Les autres seront recalculés à la prochaine génération.')) saveScale.mutate();
            }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Save size={13} /> Enregistrer le barème</button></div>
          )}
        </section>
      )}

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>Rubriques de paie</h3>
          {isAdmin && (
            <button className="odoo-btn-secondary" onClick={() => setEditRub({ kind: 'gain', soumis_cnss: true, soumis_ir: true, is_active: true })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Nouvelle rubrique</button>
          )}
        </div>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Code</th><th>Libellé</th><th>Type</th>
              <th style={{ textAlign: 'center' }}>CNSS</th><th style={{ textAlign: 'center' }}>IR</th>
              <th style={{ textAlign: 'right' }}>Exonéré jusqu'à</th><th>Statut</th>{isAdmin && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {rubriques.map(r => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.code}</td>
                <td title={r.notes ?? undefined}>{r.label}</td>
                <td><span className={`odoo-tag ${r.kind === 'gain' ? 'odoo-tag-green' : 'odoo-tag-orange'}`}>{r.kind === 'gain' ? 'Gain' : 'Retenue'}</span></td>
                <td style={{ textAlign: 'center' }}>{r.kind === 'gain' ? (r.soumis_cnss ? 'Soumis' : 'Exonéré') : '—'}</td>
                <td style={{ textAlign: 'center' }}>{r.kind === 'gain' ? (r.soumis_ir ? 'Soumis' : 'Exonéré') : '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.plafond_exoneration_mensuel != null ? `${parseFloat(r.plafond_exoneration_mensuel).toFixed(2)} DH/mois` : '—'}</td>
                <td>{r.is_active ? 'Active' : 'Inactive'}</td>
                {isAdmin && <td><button className="odoo-pager-btn" title="Modifier" onClick={() => setEditRub({ ...r })}><Pencil size={13} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editRub && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditRub(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h2 className="text-lg font-bold">{editRub.id ? 'Modifier la rubrique' : 'Nouvelle rubrique'}</h2>
              <button onClick={() => setEditRub(null)} className="odoo-pager-btn"><X size={16} /></button>
            </div>
            {!editRub.id && (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">Code<input className="input" value={editRub.code ?? ''} onChange={e => setEditRub({ ...editRub, code: e.target.value.toUpperCase() })} placeholder="PRIME_XXX" /></label>
                <label className="text-sm">Type
                  <select className="input" value={editRub.kind} onChange={e => setEditRub({ ...editRub, kind: e.target.value })}>
                    <option value="gain">Gain (entre dans le brut)</option>
                    <option value="retenue">Retenue (déduite du net)</option>
                  </select>
                </label>
              </div>
            )}
            <label className="text-sm">Libellé<input className="input" value={editRub.label ?? ''} onChange={e => setEditRub({ ...editRub, label: e.target.value })} /></label>
            {editRub.kind === 'gain' && (
              <>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!editRub.soumis_cnss} onChange={e => setEditRub({ ...editRub, soumis_cnss: e.target.checked })} /> Soumis CNSS/AMO</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!editRub.soumis_ir} onChange={e => setEditRub({ ...editRub, soumis_ir: e.target.checked })} /> Soumis IR</label>
                </div>
                <label className="text-sm">Exonéré jusqu'à (DH/mois, vide = pas de plafond)
                  <input className="input" type="number" min="0" step="0.01" value={editRub.plafond_exoneration_mensuel ?? ''}
                    onChange={e => setEditRub({ ...editRub, plafond_exoneration_mensuel: e.target.value })} />
                </label>
              </>
            )}
            <label className="text-sm">Notes<textarea className="input" rows={2} value={editRub.notes ?? ''} onChange={e => setEditRub({ ...editRub, notes: e.target.value })} /></label>
            {editRub.id && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editRub.is_active !== false} onChange={e => setEditRub({ ...editRub, is_active: e.target.checked })} /> Active</label>
            )}
            <div className="flex justify-end gap-2">
              <button className="odoo-btn-secondary" onClick={() => setEditRub(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={saveRub.isPending || !editRub.label || (!editRub.id && !editRub.code)}
                onClick={() => saveRub.mutate(editRub)}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
