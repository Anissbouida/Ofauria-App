import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Delete, Play, Scale } from 'lucide-react';
import api from '../../api/client';
import { productionApi } from '../../api/production.api';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { usePermissions } from '../../context/PermissionsContext';

/**
 * Poste opérateur tactile (plan d'exécution multi-industries, étape 10, pas 10f).
 *
 * Plein écran, gros boutons, pensé pour une tablette à l'atelier. L'écran suit l'étape du
 * parcours en cours de l'ordre (GET /production/:id/progress, étape 5) :
 *   - bon de sortie : pesée ligne par ligne, saisie au pavé numérique, « Valider » au doigt ;
 *   - fabrication prête : « Démarrer » ;
 *   - autres étapes : l'étape en cours, sans action.
 * Rien de neuf côté serveur : les mêmes actions que la fiche d'ordre, avec les mêmes contrôles.
 */
type Plan = { id: string; of_number?: string | null; status: string; plan_date: string; item_count?: number; target_role_label?: string | null };
type Stage = { code: string; label: string; state: 'fait' | 'courant' | 'a_venir' | 'saute'; techStatus: string };
const OPEN = ['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'];
const big = { fontSize: 22, padding: '18px 22px', borderRadius: 14, minHeight: 64 } as const;

export default function OperatorStationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sectorLabel, hasFeature } = usePermissions();
  // Audit des profils : « pesée » seulement avec la capacité Pesée, sinon « préparation ».
  const weighWord = hasFeature('pesage') ? 'la pesée' : 'la préparation';
  const [planId, setPlanId] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [entry, setEntry] = useState('');

  const { data: plansResp } = useQuery({ queryKey: ['poste-plans'], queryFn: () => productionApi.list(), refetchInterval: 30_000 });
  const plans = useMemo(() => {
    const r = plansResp as { data?: unknown; plans?: unknown } | undefined;
    const raw = ((r?.data as { plans?: unknown })?.plans ?? r?.data ?? r?.plans ?? []) as Plan[];
    return (Array.isArray(raw) ? raw : []).filter(p => OPEN.includes(p.status)).slice(0, 30);
  }, [plansResp]);
  const { data: progress } = useQuery({
    queryKey: ['poste-progress', planId], enabled: !!planId,
    queryFn: () => api.get(`/production/${planId}/progress`).then(r => r.data.data as { model: { label: string } | null; stages: Stage[] }),
  });
  const { data: bons = [] } = useQuery({ queryKey: ['poste-bons', planId], enabled: !!planId, queryFn: () => bonSortieApi.getByPlan(planId!) });
  const bon = bons.find(b => b.status !== 'annule' && b.status !== 'cloture');
  const lines = (bon?.lines ?? []).filter(l => Number(l.allocated_quantity) > 0);
  const toWeigh = lines.filter(l => !l.weighed_at);
  const current = progress?.stages.find(s => s.state === 'courant');
  const plan = plans.find(p => p.id === planId);
  const line = lines.find(l => l.id === lineId) ?? toWeigh[0];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['poste-bons', planId] });
    qc.invalidateQueries({ queryKey: ['poste-progress', planId] });
    qc.invalidateQueries({ queryKey: ['poste-plans'] });
  };
  const prepare = useMutation({
    mutationFn: () => bonSortieApi.markPreparation(bon!.id),
    onSuccess: () => { refresh(); notify.success('Pesée commencée'); },
    onError: (e: unknown) => notify.error(apiErrorMessage(e)),
  });
  const weigh = useMutation({
    mutationFn: () => bonSortieApi.weighLignes(bon!.id, [{ ligneId: line!.id, actualQuantity: Number(entry.replace(',', '.')), source: 'manual' }]),
    onSuccess: () => { setEntry(''); setLineId(null); refresh(); notify.success('Pesée validée'); },
    onError: (e: unknown) => notify.error(apiErrorMessage(e)),
  });
  const start = useMutation({
    mutationFn: () => productionApi.start(planId!),
    onSuccess: () => { refresh(); notify.success('Fabrication démarrée'); },
    onError: (e: unknown) => notify.error(apiErrorMessage(e)),
  });
  const press = (k: string) => setEntry(v => (k === '⌫' ? v.slice(0, -1) : k === ',' ? (v.includes(',') ? v : `${v || '0'},`) : `${v}${k}`).slice(0, 10));
  const entryOk = entry !== '' && Number(entry.replace(',', '.')) > 0;

  return (
    <div role="application" aria-label="Poste opérateur" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--ds-bg, #f6f7f9)', display: 'grid', gridTemplateColumns: '360px 1fr', fontSize: 18 }}>
      <aside style={{ borderRight: '1px solid var(--ds-hair, #e5e7eb)', overflow: 'auto', padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}>
        <button type="button" className="odoo-btn-secondary" style={big} onClick={() => navigate('/production/atelier')}><ArrowLeft size={22} /> Quitter le poste</button>
        <h1 style={{ fontSize: 24, margin: '8px 0' }}>{sectorLabel('production_plans', 'Plans de production')}</h1>
        {plans.length === 0 && <p style={{ color: 'var(--ds-muted)' }}>Aucun ordre en cours.</p>}
        {plans.map(p => (
          <button key={p.id} type="button" onClick={() => { setPlanId(p.id); setLineId(null); setEntry(''); }}
            className={p.id === planId ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ ...big, textAlign: 'left', display: 'grid', gap: 4 }}>
            <strong>{p.of_number ?? p.id.slice(0, 8)}</strong>
            <span style={{ fontSize: 15, opacity: 0.8 }}>{p.target_role_label ?? ''} · {p.item_count ?? 0} article(s)</span>
          </button>
        ))}
      </aside>

      <main style={{ overflow: 'auto', padding: 24, display: 'grid', gap: 20, alignContent: 'start' }}>
        {!plan && <p style={{ fontSize: 22, color: 'var(--ds-muted)' }}>Choisissez un ordre.</p>}
        {plan && (
          <>
            <ol aria-label="Parcours de l'ordre" style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8, padding: 0, margin: 0 }}>
              {(progress?.stages ?? []).filter(s => s.state !== 'saute').map(s => (
                <li key={s.code} style={{ padding: '10px 16px', borderRadius: 999, fontWeight: s.state === 'courant' ? 700 : 400,
                  background: s.state === 'courant' ? 'var(--kl-accent, #2563eb)' : s.state === 'fait' ? 'var(--ds-success-bg, #dcfce7)' : 'var(--ds-hair, #e5e7eb)',
                  color: s.state === 'courant' ? '#fff' : 'inherit' }}>
                  {s.state === 'fait' && <Check size={16} aria-hidden="true" />} {s.label}
                </li>
              ))}
            </ol>

            {bon && bon.status === 'genere' && (
              <button type="button" className="odoo-btn-primary" style={big} disabled={prepare.isPending} onClick={() => prepare.mutate()}>
                <Scale size={24} /> Commencer {weighWord} ({sectorLabel('doc_bon_sortie', 'Bon de sortie')} {bon.numero})
              </button>
            )}

            {bon && ['preparation', 'preparation_partielle'].includes(bon.status) && (
              <section aria-label="Pesée" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
                <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                  <h2 style={{ fontSize: 22, margin: 0 }}>Pesée — {toWeigh.length} ligne(s) restante(s)</h2>
                  {lines.map(l => (
                    <button key={l.id} type="button" disabled={!!l.weighed_at} onClick={() => { setLineId(l.id); setEntry(''); }}
                      className={line?.id === l.id ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
                      style={{ ...big, display: 'flex', justifyContent: 'space-between', opacity: l.weighed_at ? 0.55 : 1 }}>
                      <span>{l.weighed_at && <Check size={20} aria-hidden="true" />} {l.ingredient_name ?? '—'}</span>
                      <span>{Number(l.allocated_quantity)} {l.unit ?? ''}</span>
                    </button>
                  ))}
                </div>
                {line && !line.weighed_at && (
                  <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                    <div style={{ fontSize: 18 }}>{line.ingredient_name} · cible {Number(line.allocated_quantity)} {line.unit ?? ''}</div>
                    <output aria-live="polite" aria-label="Poids saisi" style={{ fontSize: 44, fontWeight: 700, textAlign: 'right', padding: '12px 16px', borderRadius: 14, background: '#fff', border: '2px solid var(--ds-hair, #e5e7eb)' }}>
                      {entry || '0'} <span style={{ fontSize: 22 }}>{line.unit ?? ''}</span>
                    </output>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'].map(k => (
                        <button key={k} type="button" className="odoo-btn-secondary" style={{ ...big, fontSize: 28 }} onClick={() => press(k)} aria-label={k === '⌫' ? 'Effacer' : k}>
                          {k === '⌫' ? <Delete size={26} /> : k}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="odoo-btn-primary" style={{ ...big, fontSize: 26 }} disabled={!entryOk || weigh.isPending} onClick={() => weigh.mutate()}>
                      <Check size={28} /> Valider {weighWord}
                    </button>
                  </div>
                )}
              </section>
            )}

            {['confirmed', 'ready_to_produce'].includes(plan.status) && (!bon || bon.status === 'cloture') && (
              <button type="button" className="odoo-btn-primary" style={{ ...big, fontSize: 26 }} disabled={start.isPending} onClick={() => start.mutate()}>
                <Play size={28} /> Démarrer la fabrication
              </button>
            )}
            {plan.status === 'in_progress' && <p style={{ fontSize: 22 }}>Fabrication en cours — étape « {current?.label ?? 'Fabrication'} ».</p>}
          </>
        )}
      </main>
    </div>
  );
}
