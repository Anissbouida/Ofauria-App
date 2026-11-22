import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal, Loader2, Save, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { productionApi, type ProductionSettings } from '../../api/production.api';
import SalesPageShell from '../sales/SalesPageShell';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { ErrorState, LoadingState } from '../../components/ds';
import { SettingsTabs } from '../settings/SettingsPrimitives';
import ProductionPoliciesPanel from './ProductionPoliciesPanel';
import ProductionOrderTypesPanel from './ProductionOrderTypesPanel';
import ProductionPrintTemplatesPanel from './ProductionPrintTemplatesPanel';
import ProductionScreensPanel from './ProductionScreensPanel';

const inp: React.CSSProperties = { width: 120, textAlign: 'right' };

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--ds-hair)' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ds-ink)' }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" onClick={() => onChange(!value)} aria-checked={value} aria-label={label}
      style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .15s', background: value ? 'var(--ds-accent)' : 'var(--ds-line)' }}>
      <span style={{ position: 'absolute', top: 2, left: value ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

export default function ProductionSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['production-settings'], queryFn: productionApi.getSettings });

  const [form, setForm] = useState<{ chargesFixesPct: string; overproductionPct: string; markupPercent: string; stepsEnabled: boolean; stepsBlocking: boolean; yieldEnabled: boolean; costEnabled: boolean } | null>(null);
  useEffect(() => {
    if (data && !form) setForm({
      chargesFixesPct: String(Math.round(Number(data.production_charges_fixes_pct) * 1000) / 10),
      overproductionPct: String(Number(data.production_overproduction_pct)),
      markupPercent: String(Number(data.production_markup_percent)),
      stepsEnabled: !!data.production_steps_enabled,
      stepsBlocking: !!data.production_steps_blocking,
      yieldEnabled: !!data.production_yield_enabled,
      costEnabled: !!data.production_cost_enabled,
    });
  }, [data, form]);

  const save = useMutation({
    mutationFn: () => productionApi.updateSettings({
      chargesFixesPct: (Number(form!.chargesFixesPct) || 0) / 100,
      overproductionPct: Number(form!.overproductionPct) || 0,
      // G1-05 : la majoration et les étapes bloquantes ne s'éditent plus ici (un seul écran
      // d'édition : Paramètres › Production). Elles ne sont donc plus envoyées.
      stepsEnabled: form!.stepsEnabled,
      yieldEnabled: form!.yieldEnabled,
      costEnabled: form!.costEnabled,
    }),
    onSuccess: (d: ProductionSettings) => {
      notify.success('Réglages enregistrés');
      qc.setQueryData(['production-settings'], d);
      qc.invalidateQueries({ queryKey: ['production-cout'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const set = <K extends keyof NonNullable<typeof form>>(k: K, v: NonNullable<typeof form>[K]) => setForm(f => f ? { ...f, [k]: v } : f);

  const general = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isError ? <ErrorState title="Les réglages n'ont pas pu être chargés" onRetry={() => refetch()} /> : (isLoading || !form) && <LoadingState />}

      {form && (
        <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="ds-panel" aria-label="Coût de revient">
            <h2 className="ds-subhead" style={{ padding: '14px 20px 0' }}>Coût de revient</h2>
            <div style={{ padding: '2px 20px 6px' }}>
            <Row label="Taux de charges fixes" hint="Appliqué au coût matière dans le coût de revient (ex. 40 %).">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="0.1" min="0" className="ds-input" aria-label="Taux de charges fixes (%)" value={form.chargesFixesPct} onChange={e => set('chargesFixesPct', e.target.value)} style={inp} /> %
              </div>
            </Row>
            <Row label="Majoration du prix de vente" hint="Multiplicateur appliqué au prix de vente conseillé. Se règle dans Paramètres › Production › Majoration.">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(form.markupPercent).toLocaleString('fr-FR')} %</span>
                <Link to="/settings?page=production" className="odoo-btn-secondary ds-btn-sm"><ExternalLink size={13} aria-hidden="true" /> Modifier</Link>
              </div>
            </Row>
            </div>
          </section>

          <section className="ds-panel" aria-label="Production">
            <h2 className="ds-subhead" style={{ padding: '14px 20px 0' }}>Production</h2>
            <div style={{ padding: '2px 20px 6px' }}>
            <Row label="Tolérance de surproduction" hint="Au-delà de prévu × (1 + tolérance), un avertissement est émis. 0 = aucun contrôle.">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="1" min="0" className="ds-input" aria-label="Tolérance de surproduction (%)" value={form.overproductionPct} onChange={e => set('overproductionPct', e.target.value)} style={inp} /> %
              </div>
            </Row>
            <Row label="Étapes de fabrication" hint="Mode opératoire étape par étape sur les plans. Coupé : le panneau des étapes est masqué et aucune étape ne bloque la production.">
              <Toggle label="Étapes de fabrication" value={form.stepsEnabled} onChange={v => set('stepsEnabled', v)} />
            </Row>
            <Row label="Étapes bloquantes" hint="Une étape bloquante doit être terminée avant de produire l'article. Se règle dans Paramètres › Production › Coûts et prix.">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span>{form.stepsBlocking ? 'Oui' : 'Non'}</span>
                <Link to="/settings?page=production" className="odoo-btn-secondary ds-btn-sm"><ExternalLink size={13} aria-hidden="true" /> Modifier</Link>
              </div>
            </Row>
            <Row label="Rendement" hint="Saisie du rendement (vers magasin / frigo, pertes) à la production. Coupé : le panneau est masqué et la saisie refusée.">
              <Toggle label="Rendement" value={form.yieldEnabled} onChange={v => set('yieldEnabled', v)} />
            </Row>
            <Row label="Coût de revient" hint="Calcul du coût réel (matière + emballages + MO + énergie + charges) des plans. Coupé : le panneau est masqué et le calcul refusé.">
              <Toggle label="Coût de revient" value={form.costEnabled} onChange={v => set('costEnabled', v)} />
            </Row>
            </div>
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="odoo-btn-primary" disabled={save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // M1-04 : les réglages du module d'un côté, les politiques à héritage de l'autre.
  return (
    <SalesPageShell icon={SlidersHorizontal} parent="Production › Paramétrage" title="Réglages de production"
      summary="Coût de revient, tolérance de surproduction, politiques, types d'ordre et impressions du module.">
      <SettingsTabs label="Paramétrage de la production" tabs={[
        { key: 'general', label: 'Réglages', content: general },
        { key: 'policies', label: 'Politiques', content: <ProductionPoliciesPanel /> },
        { key: 'order-types', label: 'Types d\'ordre', content: <ProductionOrderTypesPanel /> },
        { key: 'print', label: 'Impressions', content: <ProductionPrintTemplatesPanel /> },
        { key: 'screens', label: 'Écrans', content: <ProductionScreensPanel /> },
      ]} />
    </SalesPageShell>
  );
}
