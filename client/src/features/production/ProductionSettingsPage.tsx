import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal, Loader2, Save } from 'lucide-react';
import { productionApi, type ProductionSettings } from '../../api/production.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit', width: 120, textAlign: 'right' };

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--theme-bg-separator)' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: '0.88rem' }}>{label}</div>
        {hint && <div style={{ fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} aria-pressed={value}
      style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .15s', background: value ? 'var(--theme-accent, #1a73e8)' : 'var(--odoo-border)' }}>
      <span style={{ position: 'absolute', top: 2, left: value ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

export default function ProductionSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['production-settings'], queryFn: productionApi.getSettings });

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
      markupPercent: Number(form!.markupPercent) || 0,
      stepsEnabled: form!.stepsEnabled,
      stepsBlocking: form!.stepsBlocking,
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

  return (
    <div className="odoo-scope" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={SlidersHorizontal} title="Paramétrage de la production">
        Réglages du module : coût de revient, tolérance de surproduction et fonctions activées. Appliqués sans redéploiement.
      </StatusBanner>

      {(isLoading || !form) && <div style={{ padding: 24, color: 'var(--theme-text-muted)' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /> Chargement…</div>}

      {form && (
        <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section>
            <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-muted)', margin: '0 0 4px' }}>Coût de revient</h4>
            <Row label="Taux de charges fixes" hint="Appliqué au coût matière dans le coût de revient (ex. 40 %).">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="0.1" min="0" value={form.chargesFixesPct} onChange={e => set('chargesFixesPct', e.target.value)} style={inp} /> %
              </div>
            </Row>
            <Row label="Marge / markup produit" hint="Multiplicateur appliqué au prix de vente conseillé.">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="0.1" min="0" value={form.markupPercent} onChange={e => set('markupPercent', e.target.value)} style={inp} /> %
              </div>
            </Row>
          </section>

          <section>
            <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-muted)', margin: '0 0 4px' }}>Production</h4>
            <Row label="Tolérance de surproduction" hint="Au-delà de prévu × (1 + tolérance), un avertissement est émis. 0 = aucun contrôle.">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="1" min="0" value={form.overproductionPct} onChange={e => set('overproductionPct', e.target.value)} style={inp} /> %
              </div>
            </Row>
            <Row label="Étapes de fabrication" hint="Active le mode opératoire étape par étape sur les plans.">
              <Toggle value={form.stepsEnabled} onChange={v => set('stepsEnabled', v)} />
            </Row>
            <Row label="Étapes bloquantes" hint="Une étape bloquante doit être terminée avant de produire l'article.">
              <Toggle value={form.stepsBlocking} onChange={v => set('stepsBlocking', v)} />
            </Row>
            <Row label="Rendement" hint="Saisie du rendement (vers magasin / frigo, pertes) à la production.">
              <Toggle value={form.yieldEnabled} onChange={v => set('yieldEnabled', v)} />
            </Row>
            <Row label="Coût de revient" hint="Calcul du coût réel (matière + MO + énergie + charges) des plans.">
              <Toggle value={form.costEnabled} onChange={v => set('costEnabled', v)} />
            </Row>
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="odoo-btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
