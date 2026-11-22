import { FilterChips } from '../sales/ListTemplate';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Scale, Check } from 'lucide-react';
import { recipesApi, type FormatWeightRow } from '../../api/recipes.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, EmptyState, LoadingState } from '../../components/ds';

/**
 * Poids des formats, en grille (G2-05) : une ligne par format actif, poids cru, poids cuit
 * et perte à la cuisson calculée. Quand des pesées réelles existent (saisies au rendement
 * sur les trois derniers mois), elles sont proposées ; un clic les reprend. Chaque ligne
 * s'enregistre en quittant le champ. Chaque poids garde l'unité dans laquelle il a été saisi
 * (g ou kg, M3-04) ; la perte et les contrôles se calculent en grammes.
 */

type Unit = 'g' | 'kg';
type Draft = { cru: string; cuit: string; cruUnit: Unit; cuitUnit: Unit };
const toG = (n: number | null, u: Unit) => (n === null || Number.isNaN(n) ? n : u === 'kg' ? n * 1000 : n);
const parse = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const g = (n: number | null) => (n === null ? '' : String(n));
const lossPct = (cru: number | null, cuit: number | null) =>
  cru !== null && cuit !== null && cru > 0 && !Number.isNaN(cru) && !Number.isNaN(cuit) ? Math.round(((cru - cuit) / cru) * 1000) / 10 : null;

export default function FormatWeightsGrid() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['format-weights'], queryFn: recipesApi.formatWeights });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [savedId, setSavedId] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (v: { id: string; cru: number | null; cuit: number | null; cruUnit: Unit; cuitUnit: Unit }) =>
      recipesApi.saveFormatWeights(v.id, { poidsCruG: v.cru, poidsCuitG: v.cuit, cruUnit: v.cruUnit, cuitUnit: v.cuitUnit }),
    onSuccess: (row, v) => {
      qc.setQueryData<FormatWeightRow[]>(['format-weights'], old => (old ?? []).map(r => (r.formatId === v.id ? { ...r, ...row, proposal: r.proposal } : r)));
      setDrafts(d => { const { [v.id]: _done, ...rest } = d; return rest; });
      setSavedId(v.id);
      qc.invalidateQueries({ queryKey: ['data-quality'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const draftOf = (r: FormatWeightRow): Draft => drafts[r.formatId] ?? {
    cru: g(r.cru?.qty ?? r.poidsCruG), cuit: g(r.cuit?.qty ?? r.poidsCuitG),
    cruUnit: (r.cru?.unit === 'kg' ? 'kg' : 'g'), cuitUnit: (r.cuit?.unit === 'kg' ? 'kg' : 'g'),
  };
  const edit = (r: FormatWeightRow, patch: Partial<Draft>) => { setSavedId(null); setDrafts(d => ({ ...d, [r.formatId]: { ...draftOf(r), ...patch } })); };
  /** Enregistre la ligne si elle a changé et si elle est cohérente. */
  const commit = (r: FormatWeightRow, d: Draft = draftOf(r)) => {
    const cru = parse(d.cru), cuit = parse(d.cuit);
    if (Number.isNaN(cru) || Number.isNaN(cuit)) { notify.error('Un poids n\'est pas un nombre'); return; }
    const cruG = toG(cru, d.cruUnit), cuitG = toG(cuit, d.cuitUnit);
    if (cruG === r.poidsCruG && cuitG === r.poidsCuitG && d.cruUnit === (r.cru?.unit ?? 'g') && d.cuitUnit === (r.cuit?.unit ?? 'g')) return;
    if (cruG !== null && cuitG !== null && cuitG > cruG) { notify.error('Le poids cuit ne peut pas dépasser le poids cru'); return; }
    save.mutate({ id: r.formatId, cru, cuit, cruUnit: d.cruUnit, cuitUnit: d.cuitUnit });
  };
  const applyProposal = (r: FormatWeightRow) => {
    if (!r.proposal) return;
    const d = draftOf(r);
    // Les pesées sont en grammes : la proposition se reprend en grammes.
    const next: Draft = {
      cru: r.proposal.cruG !== null ? String(r.proposal.cruG) : d.cru, cruUnit: r.proposal.cruG !== null ? 'g' : d.cruUnit,
      cuit: r.proposal.cuitG !== null ? String(r.proposal.cuitG) : d.cuit, cuitUnit: r.proposal.cuitG !== null ? 'g' : d.cuitUnit,
    };
    setDrafts(x => ({ ...x, [r.formatId]: next }));
    commit(r, next);
  };

  const missing = rows.filter(r => r.poidsCuitG === null).length;
  const shown = onlyMissing ? rows.filter(r => r.poidsCuitG === null || drafts[r.formatId] || savedId === r.formatId) : rows;

  if (isLoading) return <LoadingState />;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone={missing === 0 ? 'success' : 'info'} icon={Scale} title="Poids des formats">
        {missing === 0
          ? `Les ${rows.length} formats actifs ont leur poids cuit.`
          : `${missing} format${missing > 1 ? 's' : ''} sur ${rows.length} n'${missing > 1 ? 'ont' : 'a'} pas de poids cuit. Saisissez les poids (g ou kg) ; chaque ligne s'enregistre en quittant le champ.`}
      </StatusBanner>

      <FilterChips label="Formats affichés" value={onlyMissing ? 'missing' : 'all'} onChange={k => setOnlyMissing(k === 'missing')} chips={[
        { key: 'missing', label: 'Sans poids cuit', count: missing },
        { key: 'all', label: 'Tous les formats', count: rows.length },
      ]} />

      {shown.length === 0 && <EmptyState icon={Scale} title="Aucun format à afficher" />}

      {shown.length > 0 && (
        <DataPanel label="Poids des formats">
          <table className="odoo-table ds-dense" style={{ width: '100%' }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Fiche</th>
              <th style={{ textAlign: 'left' }}>Format</th>
              <th className="ds-num">Poids cru</th>
              <th className="ds-num">Poids cuit</th>
              <th className="ds-num">Perte à la cuisson (%)</th>
              <th style={{ textAlign: 'left' }}>Pesées réelles (3 mois)</th>
              <th style={{ textAlign: 'left' }}>État</th>
            </tr></thead>
            <tbody>
              {shown.map(r => {
                const d = draftOf(r);
                const loss = lossPct(toG(parse(d.cru), d.cruUnit), toG(parse(d.cuit), d.cuitUnit));
                const unitSelect = (field: 'cruUnit' | 'cuitUnit', label: string) => (
                  <select className="ds-input sm" value={d[field]} aria-label={`Unité du ${label} de ${r.recipeName}`} style={{ width: 60, marginLeft: 4 }}
                    onChange={e => { const next = { ...d, [field]: e.target.value as Unit }; setDrafts(x => ({ ...x, [r.formatId]: next })); commit(r, next); }}>
                    <option value="g">g</option><option value="kg">kg</option>
                  </select>
                );
                const dirty = Boolean(drafts[r.formatId]);
                return (
                  <tr key={r.formatId}>
                    <td className="ds-strong">{r.recipeName}</td>
                    <td style={{ color: 'var(--ds-muted)' }}>{r.formatLabel}{r.isDefault ? ' · par défaut' : ''}</td>
                    <td className="ds-num">
                      <input className="ds-input sm" type="text" inputMode="decimal" aria-label={`Poids cru de ${r.recipeName}, ${r.formatLabel}`}
                        style={{ width: 90, textAlign: 'right' }} value={d.cru}
                        onChange={e => edit(r, { cru: e.target.value })} onBlur={() => commit(r)} />
                      {unitSelect('cruUnit', 'poids cru')}
                    </td>
                    <td className="ds-num">
                      <input className="ds-input sm" type="text" inputMode="decimal" aria-label={`Poids cuit de ${r.recipeName}, ${r.formatLabel}`}
                        style={{ width: 90, textAlign: 'right' }} value={d.cuit}
                        onChange={e => edit(r, { cuit: e.target.value })} onBlur={() => commit(r)} />
                      {unitSelect('cuitUnit', 'poids cuit')}
                    </td>
                    <td className="ds-num">{loss === null ? '—' : loss.toLocaleString('fr-FR')}</td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {r.proposal ? (
                        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => applyProposal(r)}
                          title={`Moyenne de ${r.proposal.samples} pesée${r.proposal.samples > 1 ? 's' : ''} : reprendre ces valeurs`}>
                          {r.proposal.cruG !== null ? `${r.proposal.cruG.toLocaleString('fr-FR')} g cru` : ''}
                          {r.proposal.cruG !== null && r.proposal.cuitG !== null ? ' · ' : ''}
                          {r.proposal.cuitG !== null ? `${r.proposal.cuitG.toLocaleString('fr-FR')} g cuit` : ''}
                        </button>
                      ) : <span style={{ color: 'var(--ds-muted)' }}>Aucune pesée</span>}
                    </td>
                    <td>
                      {save.isPending && save.variables?.id === r.formatId ? <Loader2 size={14} className="animate-spin" />
                        : dirty ? <StatusTag tone="progress" label="À enregistrer" />
                        : savedId === r.formatId ? <StatusTag tone="done" label="Enregistré" icon={Check} />
                        : r.poidsCuitG === null ? <StatusTag tone="todo" label="Poids cuit manquant" />
                        : <StatusTag tone="done" label="Complet" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </div>
  );
}
