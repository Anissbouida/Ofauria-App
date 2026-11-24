/**
 * Production › Paramétrage › Coût de revient (2026-11-24) — un seul écran pour tout ce qui entre
 * dans le calcul du coût : mode de calcul, centres de coûts, charges, clés de répartition, personnel,
 * équipements et outils. Ces réglages étaient répartis entre Paramètres › Production (mode de calcul,
 * composantes, écritures), Production › Paramétrage › Réglages (taux de charges fixes) et
 * Production › Rapports › Analyse des coûts, qui ne garde plus que la lecture (période, rentabilité).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, RefreshCw, Save, Loader2, BarChart3 } from 'lucide-react';
import SalesPageShell from '../sales/SalesPageShell';
import { EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, Segmented, Tabs, Toolbar } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { money, currencySymbol } from '../../utils/money';
import { useActionPermissions } from '../../hooks/useActionPermissions';
import { analyticCostApi } from '../../api/analytic-cost.api';
import { productionApi } from '../../api/production.api';
import { settingsApi } from '../../api/settings.api';
import ParametersPanel from '../settings/ParametersPanel';
import { DirtyFormsProvider, SaveBar } from '../settings/DirtyForms';
import { CentresTab, ChargesTab, EquipmentTab, KeysTab, PersonnelTab } from './AnalyticCostPage';
import './production.css';

type Section = 'methode' | 'centres' | 'charges' | 'cles' | 'personnel' | 'equipements';
const SECTIONS: Section[] = ['methode', 'centres', 'charges', 'cles', 'personnel', 'equipements'];
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const rateTxt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 4 });

export default function CostSettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Section | null;
  const section: Section = raw && SECTIONS.includes(raw) ? raw : 'centres';
  const go = (s: Section) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', s); return n; }, { replace: true });
  const [month, setMonth] = useState(thisMonth());
  const { can, isLoading: permLoading } = useActionPermissions();
  const allowed = can('production.production_cout.analytique');
  const qc = useQueryClient();

  const meta = useQuery({ queryKey: ['analytic', 'meta'], queryFn: analyticCostApi.meta, enabled: allowed });
  const centres = useQuery({ queryKey: ['analytic', 'centres'], queryFn: analyticCostApi.centres, enabled: allowed });
  const charges = useQuery({ queryKey: ['analytic', 'charges', month], queryFn: () => analyticCostApi.charges(month), enabled: allowed });
  const keys = useQuery({ queryKey: ['analytic', 'keys'], queryFn: analyticCostApi.keys, enabled: allowed });
  const personnel = useQuery({ queryKey: ['analytic', 'personnel', month], queryFn: () => analyticCostApi.personnel(month), enabled: allowed });
  const equipment = useQuery({ queryKey: ['analytic', 'equipment', month], queryFn: () => analyticCostApi.equipment(month), enabled: allowed });
  const period = useQuery({ queryKey: ['analytic', 'period', month], queryFn: () => analyticCostApi.period(month), enabled: allowed });

  const recalc = useMutation({
    mutationFn: () => analyticCostApi.recalc(month),
    onSuccess: r => {
      notify.success(`${r.calculated} plan(s) recalculé(s) sur ${r.total}${r.failed ? ` — ${r.failed} en erreur` : ''}`);
      qc.invalidateQueries({ queryKey: ['analytic'] });
      qc.invalidateQueries({ queryKey: ['production-cout'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (permLoading) return <LoadingState />;
  if (!allowed) {
    return (
      <SalesPageShell icon={Calculator} parent="Production › Paramétrage" title="Coût de revient">
        <EmptyState icon={Calculator} title="Accès réservé au gérant"
          text="Le paramétrage du coût de revient montre les coûts salariaux : il demande le droit « comptabilité analytique »." />
      </SalesPageShell>
    );
  }
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;

  const method = meta.data?.method;
  const analytic = method === 'analytic';
  const closed = !!period.data?.closed;
  const centresList = (centres.data ?? []).filter(c => c.is_active);
  const principals = centresList.filter(c => c.kind === 'principal');
  const noCapacity = principals.filter(c => c.normal_capacity == null);
  const activeCharges = (charges.data ?? []).filter(c => c.is_active);
  const chargesTotal = activeCharges.reduce((s, c) => s + Number(c.monthly_amount || 0), 0);
  const people = personnel.data ?? [];
  const unallocated = people.filter(e => e.unallocated).length;
  const equipCount = (equipment.data?.assets.length ?? 0) + (equipment.data?.tools.filter(t => t.is_active).length ?? 0);
  const loaded = !!(meta.data && centres.data && charges.data && personnel.data && equipment.data);

  const status: Record<Section, boolean> = {
    methode: analytic,
    centres: noCapacity.length === 0,
    charges: activeCharges.length > 0,
    cles: true,
    personnel: unallocated === 0,
    equipements: equipCount > 0,
  };
  const todos: { key: Section; title: string; text: string; action: string }[] = loaded ? [
    ...(!analytic ? [{ key: 'methode' as const, title: 'Moteur analytique désactivé', text: 'Le coût utilise un taux forfaitaire sur les matières : les centres de coûts ne servent pas.', action: 'Changer le mode' }] : []),
    ...(noCapacity.length > 0 ? [{ key: 'centres' as const, title: 'Capacité normale non saisie', text: `${noCapacity.length} centre(s) principal(aux) en moyenne des 3 derniers mois, qui varie d'un mois à l'autre.`, action: 'Saisir' }] : []),
    ...(activeCharges.length === 0 ? [{ key: 'charges' as const, title: 'Aucune charge', text: 'Loyer, énergie, assurances… : sans charge, seuls les salaires entrent dans les frais généraux.', action: 'Ajouter' }] : []),
    ...(unallocated > 0 ? [{ key: 'personnel' as const, title: 'Salariés sans centre', text: `${unallocated} salarié(s) non affecté(s) : leur coût n'entre dans aucun produit.`, action: 'Affecter' }] : []),
    ...(equipCount === 0 ? [{ key: 'equipements' as const, title: 'Registre des équipements vide', text: 'Amortissement et outillage à 0 dans tous les coûts de revient.', action: 'Compléter' }] : []),
  ] : [];

  const tabLabel = (s: Section, label: string): ReactNode => (
    <>
      <span className="pd-costset-dot" style={{ background: status[s] ? 'var(--ds-success)' : 'var(--ds-warning)' }} aria-hidden="true" />
      {label}
      {!status[s] && <span className="ds-sr-only"> (à compléter)</span>}
    </>
  );
  const sym = currencySymbol();
  const drv = (d: string) => meta.data?.drivers.find(x => x.value === d);
  const rates = (period.data?.centres ?? []).filter(c => c.kind === 'principal');

  return (
    <SalesPageShell icon={Calculator} parent="Production › Paramétrage" title="Coût de revient"
      summary="Tout ce qui entre dans le calcul du coût, dans l'ordre où le système l'utilise."
      actions={<>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Mois
          <input type="month" className="ds-input sm" aria-label="Mois paramétré" value={month}
            onChange={e => e.target.value && setMonth(e.target.value)} style={{ width: 150 }} />
        </label>
        <Link to="/production/analyse-couts" className="odoo-btn-secondary"><BarChart3 size={14} aria-hidden="true" /> Analyse des coûts</Link>
        {!closed && (
          <button type="button" className="odoo-btn-primary" disabled={recalc.isPending || !analytic} onClick={() => recalc.mutate()}
            title="Recalcule le coût de revient de tous les plans en cours ou terminés du mois avec le paramétrage actuel.">
            <RefreshCw size={14} className={recalc.isPending ? 'animate-spin' : ''} aria-hidden="true" /> Recalculer les plans du mois
          </button>
        )}
      </>}>
      <KpiGrid label="État du paramétrage">
        <KpiCard label="Réglages complets" value={loaded ? `${SECTIONS.filter(s => status[s]).length} / ${SECTIONS.length}` : '…'}
          sub={todos.length ? `${todos.length} point(s) à compléter` : 'Paramétrage complet'} tone={todos.length ? 'orange' : 'green'} />
        <KpiCard label="Charges à répartir" value={money(chargesTotal)} sub={`par mois, hors personnel · ${activeCharges.length} charge(s)`} />
        <KpiCard label="Personnel affecté" value={`${people.length - unallocated} / ${people.length}`} sub="salariés rattachés à un centre" />
        <KpiCard label="Centres de coûts" value={String(centresList.length)} sub={`${principals.length} principaux · ${centresList.length - principals.length} auxiliaires`} />
      </KpiGrid>

      <Toolbar>
        <Tabs label="Paramétrage du coût de revient" value={section} onChange={go} tabs={[
          { key: 'methode', label: tabLabel('methode', 'Mode de calcul') },
          { key: 'centres', label: tabLabel('centres', 'Centres de coûts'), count: centresList.length },
          { key: 'charges', label: tabLabel('charges', 'Charges'), count: activeCharges.length },
          { key: 'cles', label: tabLabel('cles', 'Clés de répartition'), count: keys.data?.length },
          { key: 'personnel', label: tabLabel('personnel', 'Personnel'), count: people.length },
          { key: 'equipements', label: tabLabel('equipements', 'Équipements et outils'), count: equipCount },
        ]} />
      </Toolbar>

      <div className="pd-costset">
        <div className="pd-costset-main">
          {!meta.data ? <LoadingState /> : (
            <>
              {section === 'methode' && <MethodSection analytic={analytic} method={method} />}
              {section === 'centres' && <CentresTab meta={meta.data} />}
              {section === 'charges' && <ChargesTab month={month} meta={meta.data} closed={closed} />}
              {section === 'cles' && <KeysTab />}
              {section === 'personnel' && <PersonnelTab month={month} />}
              {section === 'equipements' && <EquipmentTab month={month} />}
            </>
          )}
        </div>

        <aside className="pd-costset-aside" aria-label="Résultat du paramétrage">
          <section className="ds-panel">
            <div className="pd-section-head">Taux du mois <span className="pd-cost-note">{month}</span></div>
            {!analytic ? (
              <p className="pd-cost-foot" style={{ borderTop: 0 }}>Les taux par centre ne servent qu'avec le moteur analytique.</p>
            ) : period.isLoading ? <LoadingState bare /> : (
              <>
                <ul className="pd-costset-list">
                  {rates.map(c => {
                    const d = drv(c.driver);
                    return (
                      <li key={c.id}>
                        <span>{c.name} <span className="ds-muted">par {(d?.unit ?? '').replace(/¤/g, sym).replace(/s\b/g, '')}</span></span>
                        <span className="pd-costset-v">{rateTxt(c.rateFixed + c.rateVariable)} {sym}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="pd-cost-foot">Taux = charges du centre ÷ capacité normale. Ils s'appliquent à tous les plans du mois.</p>
              </>
            )}
          </section>
          {todos.length > 0 && (
            <section className="ds-panel">
              <div className="pd-section-head">Points à compléter</div>
              <ul className="pd-costset-list">
                {todos.map(t => (
                  <li key={t.key} className="pd-costset-todo">
                    <span className="pd-costset-dot" style={{ background: 'var(--ds-warning)', marginTop: 5 }} aria-hidden="true" />
                    <span>
                      <strong className="ds-strong">{t.title}</strong><br />{t.text}{' '}
                      <button type="button" className="pd-costset-link" onClick={() => go(t.key)}>{t.action}</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </SalesPageShell>
  );
}

/**
 * Mode de calcul. Le mode passe par l'API du coût (même droit que le reste de la page) ; les composantes
 * et les écritures restent des paramètres de la société (droit Paramètres › Production) : ils ne
 * s'affichent qu'à qui peut les voir.
 */
function MethodSection({ analytic, method }: { analytic: boolean; method: string | undefined }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['production-settings'], queryFn: productionApi.getSettings });
  const params = useQuery({ queryKey: ['business-parameters'], queryFn: settingsApi.parameters });
  const paramKeys = ['production.cost_components', 'production.ledger_entries', ...(method === 'monthly' ? ['production.fixed_charges'] : [])];
  const visibleParams = (params.data ?? []).filter(p => paramKeys.includes(p.key));
  const setMethod = useMutation({
    mutationFn: (m: 'rate' | 'analytic') => analyticCostApi.setMethod(m),
    onSuccess: () => { notify.success('Mode de calcul enregistré'); qc.invalidateQueries({ queryKey: ['analytic'] }); qc.invalidateQueries({ queryKey: ['business-parameters'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const [ratePct, setRatePct] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && ratePct === null) setRatePct(String(Math.round(Number(settings.data.production_charges_fixes_pct) * 1000) / 10));
  }, [settings.data, ratePct]);
  const saveRate = useMutation({
    mutationFn: () => productionApi.updateSettings({ chargesFixesPct: (Number(ratePct) || 0) / 100 }),
    onSuccess: d => { notify.success('Taux enregistré'); qc.setQueryData(['production-settings'], d); qc.invalidateQueries({ queryKey: ['production-cout'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <DirtyFormsProvider>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="ds-panel" aria-label="Mode de calcul">
          <div className="pd-section-head">Mode de calcul des frais généraux</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 20px' }}>
            <span style={{ flex: '1 1 280px', fontSize: 13, color: 'var(--ds-muted)' }}>
              Moteur analytique : charges et personnel répartis par centre de coûts, imputés sur la capacité normale.
              Taux sur les matières : un pourcentage du coût matière.
              {method === 'monthly' && ' Mode actuel : charges mensuelles au prorata des matières (ancien).'}
            </span>
            <Segmented label="Mode de calcul" value={analytic ? 'analytic' : method === 'rate' ? 'rate' : ('' as 'analytic')}
              onChange={m => { if (!setMethod.isPending) setMethod.mutate(m); }}
              options={[{ key: 'analytic', label: 'Moteur analytique' }, { key: 'rate', label: 'Taux sur les matières' }]} />
          </div>
        </section>
        {visibleParams.length > 0
          ? <ParametersPanel keys={paramKeys} />
          : params.isSuccess && (
            <p className="ds-muted" style={{ margin: 0, fontSize: 13 }}>
              Composantes du coût et écritures comptables de production : réservées aux utilisateurs qui ont accès à Paramètres › Production.
            </p>
          )}
        <section className="ds-panel" aria-label="Taux de charges fixes">
          <div className="pd-section-head">Taux de charges fixes
            <span className="pd-cost-note">{analytic ? 'Non utilisé : le moteur analytique est actif' : 'Mode « Taux sur les matières »'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 20px' }}>
            <span style={{ flex: '1 1 280px', fontSize: 13, color: 'var(--ds-muted)' }}>
              Part de frais généraux ajoutée au coût matière d'un plan. Un établissement, un atelier ou un type d'ordre peut avoir
              le sien (Production › Paramétrage › Réglages › Politiques).
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="number" step="0.1" min="0" className="ds-input sm" aria-label="Taux de charges fixes (%)" style={{ width: 96, textAlign: 'right' }}
                value={ratePct ?? ''} onChange={e => setRatePct(e.target.value)} disabled={!settings.data} /> %
            </span>
            <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={saveRate.isPending || !settings.data} onClick={() => saveRate.mutate()}>
              {saveRate.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />} Enregistrer
            </button>
          </div>
        </section>
        <SaveBar />
      </div>
    </DirtyFormsProvider>
  );
}
