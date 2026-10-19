import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save } from 'lucide-react';
import { payrollApi, payrollConfigApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { apiErrorMessage } from '../shared';

type Line = { id?: string; rubrique_id: string; label: string; kind: 'gain' | 'retenue'; amount: string; exempt_amount?: string; source: 'fixe' | 'manuel' };
type Draft = { rubriqueId: string; amount: string };

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
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Primes, indemnités et retenues</p>
      {isLoading ? <p className="text-sm text-gray-400">Chargement...</p> : (
        <>
          {fixed.map(l => (
            <div key={l.id} className="flex justify-between text-sm py-1">
              <span className="text-gray-600">{l.label} <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 4 }}>fixe</span>
                {parseFloat(l.exempt_amount || '0') > 0 && <span className="text-xs text-gray-400"> · dont {fmt(l.exempt_amount!)} exonérés</span>}
              </span>
              <span className={l.kind === 'retenue' ? 'text-red-600' : ''}>{l.kind === 'retenue' ? '−' : '+'} {fmt(l.amount)} DH</span>
            </div>
          ))}
          {drafts.map((d, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <select value={d.rubriqueId} disabled={locked} className="input" style={{ flex: 1 }}
                onChange={e => { const n = [...drafts]; n[i] = { ...d, rubriqueId: e.target.value }; setDrafts(n); setDirty(true); }}>
                <option value="">Rubrique...</option>
                {rubriques.map(r => <option key={r.id} value={r.id}>{r.kind === 'retenue' ? '− ' : '+ '}{r.label}</option>)}
              </select>
              <input type="number" min="0" step="0.01" value={d.amount} disabled={locked} className="input" style={{ width: 110 }}
                onChange={e => { const n = [...drafts]; n[i] = { ...d, amount: e.target.value }; setDrafts(n); setDirty(true); }} />
              {!locked && (
                <button type="button" className="odoo-pager-btn" title="Retirer" style={{ color: '#dc3545' }}
                  onClick={() => { setDrafts(drafts.filter((_, j) => j !== i)); setDirty(true); }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {fixed.length === 0 && drafts.length === 0 && <p className="text-sm text-gray-400">Aucune rubrique sur ce bulletin.</p>}
          {locked ? (
            lockReason && <p className="text-xs text-gray-400 mt-2">{lockReason}</p>
          ) : (
            <div className="flex justify-between mt-2">
              <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => { setDrafts([...drafts, { rubriqueId: '', amount: '' }]); setDirty(true); }}>
                <Plus size={13} /> Ajouter une rubrique
              </button>
              <button type="button" className="odoo-btn-primary" disabled={!dirty || save.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => {
                  if (drafts.some(d => !d.rubriqueId || !(parseFloat(d.amount) > 0))) { notify.error('Choisissez une rubrique et un montant > 0 pour chaque ligne'); return; }
                  save.mutate();
                }}>
                <Save size={13} /> {save.isPending ? 'Recalcul...' : 'Enregistrer et recalculer'}
              </button>
            </div>
          )}
          {drafts.some(d => label(d.rubriqueId)?.plafond_exoneration_mensuel) && (
            <p className="text-xs text-gray-400 mt-1">Les rubriques à plafond d'exonération ne sont soumises qu'au-delà du plafond.</p>
          )}
        </>
      )}
    </div>
  );
}
