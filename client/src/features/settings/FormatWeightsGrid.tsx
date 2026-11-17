import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Scale, Check } from 'lucide-react';
import { recipesApi, type FormatWeightRow } from '../../api/recipes.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Poids des formats, en grille (G2-05) : une ligne par format actif, poids cru, poids cuit
 * et perte à la cuisson calculée. Quand des pesées réelles existent (saisies au rendement
 * sur les trois derniers mois), elles sont proposées ; un clic les reprend. Chaque ligne
 * s'enregistre en quittant le champ. Les poids se saisissent en grammes, tels qu'ils sont pesés.
 */

type Draft = { cru: string; cuit: string };
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
    mutationFn: (v: { id: string; cru: number | null; cuit: number | null }) => recipesApi.saveFormatWeights(v.id, { poidsCruG: v.cru, poidsCuitG: v.cuit }),
    onSuccess: (row, v) => {
      qc.setQueryData<FormatWeightRow[]>(['format-weights'], old => (old ?? []).map(r => (r.formatId === v.id ? { ...r, ...row, proposal: r.proposal } : r)));
      setDrafts(d => { const { [v.id]: _done, ...rest } = d; return rest; });
      setSavedId(v.id);
      qc.invalidateQueries({ queryKey: ['data-quality'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const draftOf = (r: FormatWeightRow): Draft => drafts[r.formatId] ?? { cru: g(r.poidsCruG), cuit: g(r.poidsCuitG) };
  const edit = (r: FormatWeightRow, patch: Partial<Draft>) => { setSavedId(null); setDrafts(d => ({ ...d, [r.formatId]: { ...draftOf(r), ...patch } })); };
  /** Enregistre la ligne si elle a changé et si elle est cohérente. */
  const commit = (r: FormatWeightRow, d: Draft = draftOf(r)) => {
    const cru = parse(d.cru), cuit = parse(d.cuit);
    if (Number.isNaN(cru) || Number.isNaN(cuit)) { notify.error('Un poids n\'est pas un nombre'); return; }
    if (cru === r.poidsCruG && cuit === r.poidsCuitG) return;
    if (cru !== null && cuit !== null && cuit > cru) { notify.error('Le poids cuit ne peut pas dépasser le poids cru'); return; }
    save.mutate({ id: r.formatId, cru, cuit });
  };
  const applyProposal = (r: FormatWeightRow) => {
    if (!r.proposal) return;
    const d = draftOf(r);
    const next = { cru: r.proposal.cruG !== null ? String(r.proposal.cruG) : d.cru, cuit: r.proposal.cuitG !== null ? String(r.proposal.cuitG) : d.cuit };
    setDrafts(x => ({ ...x, [r.formatId]: next }));
    commit(r, next);
  };

  const missing = rows.filter(r => r.poidsCuitG === null).length;
  const shown = onlyMissing ? rows.filter(r => r.poidsCuitG === null || drafts[r.formatId] || savedId === r.formatId) : rows;

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone={missing === 0 ? 'success' : 'info'} icon={Scale} title="Poids des formats">
        {missing === 0
          ? `Les ${rows.length} formats actifs ont leur poids cuit.`
          : `${missing} format${missing > 1 ? 's' : ''} sur ${rows.length} n'${missing > 1 ? 'ont' : 'a'} pas de poids cuit. Saisissez les poids en grammes ; chaque ligne s'enregistre en quittant le champ.`}
      </StatusBanner>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
        <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />
        N'afficher que les formats sans poids cuit
      </label>

      {shown.length === 0 && <div style={{ padding: 16, color: 'var(--theme-text-muted)' }}>Aucun format à afficher.</div>}

      {shown.length > 0 && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', overflowX: 'auto' }}>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Fiche</th>
              <th style={{ textAlign: 'left' }}>Format</th>
              <th style={{ textAlign: 'right' }}>Poids cru (g)</th>
              <th style={{ textAlign: 'right' }}>Poids cuit (g)</th>
              <th style={{ textAlign: 'right' }}>Perte à la cuisson</th>
              <th style={{ textAlign: 'left' }}>Pesées réelles (3 mois)</th>
              <th style={{ textAlign: 'left' }}>État</th>
            </tr></thead>
            <tbody>
              {shown.map(r => {
                const d = draftOf(r);
                const loss = lossPct(parse(d.cru), parse(d.cuit));
                const dirty = Boolean(drafts[r.formatId]);
                return (
                  <tr key={r.formatId}>
                    <td style={{ fontWeight: 500 }}>{r.recipeName}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{r.formatLabel}{r.isDefault ? ' · par défaut' : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="odoo-input" type="text" inputMode="decimal" aria-label={`Poids cru de ${r.recipeName}, ${r.formatLabel}`}
                        style={{ width: 90, textAlign: 'right' }} value={d.cru}
                        onChange={e => edit(r, { cru: e.target.value })} onBlur={() => commit(r)} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="odoo-input" type="text" inputMode="decimal" aria-label={`Poids cuit de ${r.recipeName}, ${r.formatLabel}`}
                        style={{ width: 90, textAlign: 'right' }} value={d.cuit}
                        onChange={e => edit(r, { cuit: e.target.value })} onBlur={() => commit(r)} />
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{loss === null ? '—' : `${loss.toLocaleString('fr-FR')} %`}</td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {r.proposal ? (
                        <button type="button" className="odoo-btn-secondary" onClick={() => applyProposal(r)}
                          title={`Moyenne de ${r.proposal.samples} pesée${r.proposal.samples > 1 ? 's' : ''} : reprendre ces valeurs`}>
                          {r.proposal.cruG !== null ? `${r.proposal.cruG.toLocaleString('fr-FR')} g cru` : ''}
                          {r.proposal.cruG !== null && r.proposal.cuitG !== null ? ' · ' : ''}
                          {r.proposal.cuitG !== null ? `${r.proposal.cuitG.toLocaleString('fr-FR')} g cuit` : ''}
                        </button>
                      ) : <span style={{ color: 'var(--theme-text-muted)' }}>Aucune pesée</span>}
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
        </div>
      )}
    </div>
  );
}
