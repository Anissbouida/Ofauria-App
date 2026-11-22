import { money } from '../../../utils/money';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { payrollApi, payrollConfigApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import SearchSelect from '../../../components/ui/SearchSelect';
import { apiErrorMessage } from '../shared';
import { SectionTitle, panel, inputCls } from '../ui';

type Line = { id?: string; rubrique_id: string; label: string; kind: 'gain' | 'retenue'; amount: string; exempt_amount?: string; source: 'fixe' | 'manuel' };
type Draft = { rubriqueId: string; amount: string };

const muted = { fontSize: 14, color: 'var(--ds-muted)', margin: 0 } as const;
const hint = { fontSize: 12, color: 'var(--ds-muted)', margin: 0 } as const;

/**
 * Rubriques d'un bulletin : les lignes « fixe » viennent des éléments fixes
 * de l'employé (fiche Employé), les lignes manuelles se saisissent ici.
 * Enregistrer recalcule tout le bulletin (CNSS, IR, net) côté serveur.
 */
export default function PayslipLinesEditor({ payrollId, locked, lockReason, onRecomputed }: {
  payrollId: string;
  locked: boolean;
  lockReason?: string;
  onRecomputed: (payroll: Record<string, any>) => void;
}) {
  const queryClient = useQueryClient();
  const { data: lines = [], isLoading } = useQuery<Line[]>({
    queryKey: ['payroll-lines', payrollId],
    queryFn: () => payrollApi.lines(payrollId),
  });
  const { data: rubriques = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['payroll-rubriques'],
    queryFn: () => payrollConfigApi.rubriques(),
  });

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDrafts(lines.filter(l => l.source === 'manuel').map(l => ({ rubriqueId: l.rubrique_id, amount: String(parseFloat(l.amount)) })));
    setDirty(false);
  }, [lines]);

  const save = useMutation({
    mutationFn: () => payrollApi.setLines(payrollId, drafts
      .filter(d => d.rubriqueId && parseFloat(d.amount) > 0)
      .map(d => ({ rubriqueId: d.rubriqueId, amount: parseFloat(d.amount) }))),
    onSuccess: (data: { payroll: Record<string, any> }) => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-lines', payrollId] });
      onRecomputed(data.payroll);
      notify.success('Bulletin recalculé');
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur lors du recalcul')),
  });

  const fixed = lines.filter(l => l.source === 'fixe');
  const label = (id: string) => rubriques.find(r => r.id === id);
  const fmt = (v: string | number) => parseFloat(String(v)).toFixed(2);

  return (
    <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionTitle>Primes, indemnités et retenues</SectionTitle>
      {isLoading ? <p style={muted}>Chargement…</p> : (
        <>
          {fixed.map(l => (
            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '2px 0' }}>
              <span style={{ color: 'var(--ds-ink)' }}>{l.label} <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 4 }}>fixe</span>
                {parseFloat(l.exempt_amount || '0') > 0 && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}> · dont {fmt(l.exempt_amount!)} exonérés</span>}
              </span>
              <span style={l.kind === 'retenue' ? { color: 'var(--ds-danger)' } : undefined}>{l.kind === 'retenue' ? '−' : '+'} {money(l.amount)}</span>
            </div>
          ))}
          {drafts.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SearchSelect value={d.rubriqueId} disabled={locked} width="100%" size="md" ariaLabel="Rubrique"
                onChange={id => { const n = [...drafts]; n[i] = { ...d, rubriqueId: id }; setDrafts(n); setDirty(true); }}
                placeholder="Rubrique…"
                options={rubriques.map(r => ({ id: String(r.id), label: `${r.kind === 'retenue' ? '− ' : '+ '}${r.label}` }))} />
              <input type="number" min="0" step="0.01" value={d.amount} disabled={locked} className={inputCls} style={{ width: 110 }} aria-label="Montant de la rubrique"
                onChange={e => { const n = [...drafts]; n[i] = { ...d, amount: e.target.value }; setDrafts(n); setDirty(true); }} />
              {!locked && (
                <button type="button" className="ds-icon-btn" title="Retirer" aria-label="Retirer la rubrique"
                  onClick={() => { setDrafts(drafts.filter((_, j) => j !== i)); setDirty(true); }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {fixed.length === 0 && drafts.length === 0 && <p style={muted}>Aucune rubrique sur ce bulletin.</p>}
          {locked ? (
            lockReason && <p style={{ ...hint, marginTop: 4 }}>{lockReason}</p>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <button type="button" className="odoo-btn-secondary ds-btn-sm"
                onClick={() => { setDrafts([...drafts, { rubriqueId: '', amount: '' }]); setDirty(true); }}>
                <Plus size={13} aria-hidden="true" /> Ajouter une rubrique
              </button>
              <button type="button" className="odoo-btn-primary" disabled={!dirty || save.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => {
                  if (drafts.some(d => !d.rubriqueId || !(parseFloat(d.amount) > 0))) { notify.error('Choisissez une rubrique et un montant > 0 pour chaque ligne'); return; }
                  save.mutate();
                }}>
                {save.isPending ? 'Recalcul…' : 'Enregistrer et recalculer'}
              </button>
            </div>
          )}
          {drafts.some(d => label(d.rubriqueId)?.plafond_exoneration_mensuel) && (
            <p style={hint}>Les rubriques à plafond d'exonération ne sont soumises qu'au-delà du plafond.</p>
          )}
        </>
      )}
    </div>
  );
}
