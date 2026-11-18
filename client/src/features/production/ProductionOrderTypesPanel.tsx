import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, X, Pencil, Workflow } from 'lucide-react';
import {
  productionApi, useWorkshops, CONSUMPTION_MODE_LABELS,
  type ProductionOrderType, type ProductionOrderTypeInput,
} from '../../api/production.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';

/**
 * Production › Paramétrage › Types d'ordre (M2-01).
 *
 * Un type d'ordre dit quelles étapes du parcours s'appliquent. « Plan du jour » reproduit
 * le parcours historique (bon de sortie pesé, démarrage après clôture du bon). Un type
 * sans bon de sortie démarre dès la confirmation et consomme la matière à la déclaration.
 */

type Draft = ProductionOrderTypeInput & { id?: string };

const yesNo = (v: boolean) => (v ? 'Oui' : 'Non');

export default function ProductionOrderTypesPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && ['admin', 'manager'].includes(user.role);
  const ws = useWorkshops();
  const { data: types = [], isLoading } = useQuery({ queryKey: ['production-order-types', false], queryFn: () => productionApi.orderTypes(false) });
  const [draft, setDraft] = useState<Draft | null>(null);
  // C-09 : ordres ouverts du type édité (les étapes ne changent pas sous des ordres en cours).
  const { data: impact } = useQuery({
    queryKey: ['production-order-type-impact', draft?.id],
    queryFn: () => productionApi.orderTypeImpact(draft!.id!),
    enabled: !!draft?.id,
  });
  const stepsLocked = !!impact?.underway;

  const save = useMutation({
    mutationFn: (d: Draft) => d.id
      ? productionApi.updateOrderType(d.id, { ...d, code: undefined })
      : productionApi.createOrderType({ ...d, code: d.code ?? '', label: d.label ?? '' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-order-types'] });
      notify.success('Type d\'ordre enregistré');
      setDraft(null);
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const edit = (t: ProductionOrderType) => setDraft({
    id: t.id, code: t.code, label: t.label, description: t.description,
    requiresBonSortie: t.requires_bon_sortie, requiresWeighing: t.requires_weighing,
    requiresQualityCheck: t.requires_quality_check, isSubcontracting: !!t.is_subcontracting, consumptionMode: t.consumption_mode,
    defaultTargetRole: t.default_target_role, isDefault: t.is_default, isActive: t.is_active, displayOrder: t.display_order,
  });

  const set = (patch: Partial<Draft>) => setDraft(d => {
    if (!d) return d;
    const next = { ...d, ...patch };
    // Mêmes règles que le serveur : sous-traité = ni bon de sortie, ni pesage, matières à la réception.
    if (next.isSubcontracting) { next.requiresBonSortie = false; next.requiresWeighing = false; next.consumptionMode = 'a_la_declaration'; }
    // Sans bon de sortie, ni pesage ni consommation au bon.
    if (next.requiresBonSortie === false) {
      next.requiresWeighing = false;
      if (next.consumptionMode === 'au_bon_de_sortie') next.consumptionMode = 'a_la_declaration';
    }
    return next;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <StatusBanner tone="info" icon={Workflow} title="Types d'ordre de fabrication">
        Chaque ordre porte un type. Le type par défaut s'applique à tout ordre créé sans type (plans du jour,
        semi-finis, réapprovisionnements). Un type sans bon de sortie passe de « confirmé » à « en production »
        sans attendre le magasinier ; ses matières sont déduites à la déclaration de production.
      </StatusBanner>

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="odoo-btn-primary" onClick={() => setDraft({
            code: '', label: '', requiresBonSortie: true, requiresWeighing: true, requiresQualityCheck: false,
            consumptionMode: 'au_bon_de_sortie', isActive: true, isDefault: false,
          })}>
            <Plus size={14} /> Nouveau type
          </button>
        </div>
      )}

      {isLoading ? <Loader2 className="animate-spin" size={18} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Code</th><th>Libellé</th><th>Bon de sortie</th><th>Pesage</th><th>Contrôle</th>
                <th>Consommation</th><th>Sous-traité</th><th>Atelier par défaut</th><th style={{ textAlign: 'right' }}>Ordres</th><th>État</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {types.map(t => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace' }}>{t.code}</td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{t.label}</span>
                    {t.is_default && <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6 }}>Par défaut</span>}
                  </td>
                  <td>{yesNo(t.requires_bon_sortie)}</td>
                  <td>{yesNo(t.requires_weighing)}</td>
                  <td>{yesNo(t.requires_quality_check)}</td>
                  <td>{CONSUMPTION_MODE_LABELS[t.consumption_mode]}</td>
                  <td>{yesNo(!!t.is_subcontracting)}</td>
                  <td>{t.default_target_role ? ws.label(t.default_target_role) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{(t.plan_count ?? 0).toLocaleString('fr-FR')}</td>
                  <td><StatusTag tone={t.is_active ? 'done' : 'draft'} label={t.is_active ? 'Actif' : 'Inactif'} /></td>
                  {canEdit && (
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="odoo-btn-secondary" onClick={() => edit(t)} aria-label={`Modifier ${t.label}`}>
                        <Pencil size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.35)', padding: 16 }}>
          <div className="odoo-scope" role="dialog" aria-label="Type d'ordre"
            style={{ background: 'var(--theme-bg-card, #fff)', borderRadius: 8, width: '100%', maxWidth: 560, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>{draft.id ? `Type ${draft.code}` : 'Nouveau type d\'ordre'}</h2>
              <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)} aria-label="Fermer"><X size={14} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <label className="block text-xs font-medium text-gray-500">Code
                <input className="input" value={draft.code ?? ''} disabled={!!draft.id} placeholder="SOUS_TRAITANCE"
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
              </label>
              <label className="block text-xs font-medium text-gray-500">Libellé
                <input className="input" value={draft.label ?? ''} onChange={(e) => set({ label: e.target.value })} />
              </label>
              <label className="block text-xs font-medium text-gray-500">Consommation des matières
                <select className="input" disabled={stepsLocked} value={draft.consumptionMode} onChange={(e) => set({ consumptionMode: e.target.value as Draft['consumptionMode'] })}>
                  {(Object.keys(CONSUMPTION_MODE_LABELS) as (keyof typeof CONSUMPTION_MODE_LABELS)[])
                    .filter(k => draft.requiresBonSortie !== false || k !== 'au_bon_de_sortie')
                    .map(k => <option key={k} value={k}>{CONSUMPTION_MODE_LABELS[k]}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-gray-500">Atelier par défaut
                <select className="input" value={draft.defaultTargetRole ?? ''} onChange={(e) => set({ defaultTargetRole: e.target.value || null })}>
                  <option value="">— Aucun —</option>
                  {ws.workshops.map(w => <option key={w.code} value={w.code}>{w.label}</option>)}
                </select>
              </label>
            </div>
            {impact && impact.draft + impact.underway > 0 && (
              <StatusBanner tone={impact.underway ? 'warning' : 'info'} icon={Workflow} title={`${impact.draft + impact.underway} ordre(s) de ce type non terminé(s)`}>
                {impact.underway
                  ? `${impact.underway} en cours : les étapes (bon de sortie, pesage, consommation, sous-traitance) ne peuvent pas changer avant leur fin. Le libellé, le contrôle et l'atelier restent modifiables.`
                  : `${impact.draft} brouillon(s) : ils prendront le nouveau réglage à leur confirmation.`}
              </StatusBanner>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem', fontSize: '0.875rem' }}>
              <label title="Fabrication confiée à un tiers : envoi des composants, réception du produit fini, coût de façon"><input type="checkbox" disabled={stepsLocked} checked={!!draft.isSubcontracting} onChange={(e) => set({ isSubcontracting: e.target.checked })} /> Sous-traité</label>
              <label style={{ opacity: draft.isSubcontracting ? 0.5 : 1 }}><input type="checkbox" disabled={!!draft.isSubcontracting || stepsLocked} checked={draft.requiresBonSortie !== false} onChange={(e) => set({ requiresBonSortie: e.target.checked })} /> Bon de sortie</label>
              <label style={{ opacity: draft.requiresBonSortie === false ? 0.5 : 1 }}>
                <input type="checkbox" disabled={draft.requiresBonSortie === false || stepsLocked} checked={!!draft.requiresWeighing} onChange={(e) => set({ requiresWeighing: e.target.checked })} /> Pesage
              </label>
              <label><input type="checkbox" checked={!!draft.requiresQualityCheck} onChange={(e) => set({ requiresQualityCheck: e.target.checked })} /> Contrôle à la déclaration</label>
              <label><input type="checkbox" checked={!!draft.isDefault} onChange={(e) => set({ isDefault: e.target.checked, ...(e.target.checked ? { isActive: true } : {}) })} /> Par défaut</label>
              <label><input type="checkbox" checked={draft.isActive !== false} disabled={!!draft.isDefault} onChange={(e) => set({ isActive: e.target.checked })} /> Actif</label>
            </div>
            <label className="block text-xs font-medium text-gray-500">Description
              <textarea className="input" rows={2} value={draft.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
              <button type="button" className="odoo-btn-primary" disabled={save.isPending || !draft.label?.trim() || !draft.code?.trim()} onClick={() => save.mutate(draft)}>
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
