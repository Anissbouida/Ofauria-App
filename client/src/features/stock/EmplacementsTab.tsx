import { usePermissions } from '../../context/PermissionsContext';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Pencil, Trash2, Thermometer, X, Snowflake, Package, Loader2 } from 'lucide-react';
import { stockLocationsApi, type StockLocation, type StockLocationInput } from '../../api/stock-locations.api';
import { STOCK_LOCATION_ROLES, roleOfLocationType } from '@ofauria/shared';
import { productionCoutApi } from '../../api/production-cout.api';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import { useReferentiel } from '../../hooks/useReferentiel';
import '../sales/ListTemplate';
import './stock.css';
import { DataPanel, EmptyState, FormField, FormFooter, LoadingState, Modal, TableFooter } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { HeaderActions } from './StockUi';

// Secours si le référentiel n'est pas encore chargé ; la liste vient de stock_location_types (mig 699).
const TYPE_LABELS: Record<string, string> = {
  sec: 'Sec', positif: 'Froid positif', negatif: 'Froid négatif',
  pesage: 'Pesage', vitrine: 'Vitrine', labo: 'Labo',
};
const TYPE_BADGE: Record<string, string> = {
  sec: 'odoo-tag', positif: 'odoo-tag-blue', negatif: 'odoo-tag-indigo',
  pesage: 'odoo-tag-amber', vitrine: 'odoo-tag-green', labo: 'odoo-tag',
};
const num = (v: number | string | null) => (v == null ? null : parseFloat(String(v)));

type Equipement = { id: string; nom: string; type: string; temp_min: number | string | null; temp_max: number | string | null };

const emptyForm: StockLocationInput = {
  code: '', name: '', type: 'sec', parentId: null, equipementId: null,
  tempMin: null, tempMax: null, capaciteUnite: null, capaciteValeur: null,
};

export default function EmplacementsTab() {
  // Audit des profils (R1) : sondes et températures avec HACCP / relevés ; enceintes lues seulement
  // avec la production (sinon 403) ; rôles proposés selon les modules et capacités.
  const { moduleActive, hasFeature } = usePermissions();
  const coldOn = hasFeature('haccp') || hasFeature('releves_temperature');
  const qc = useQueryClient();
  const types = useReferentiel('stock_location_types');
  const typeLabel = (code: string) => types.map[code]?.label ?? TYPE_LABELS[code] ?? code;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<StockLocation | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: locations = [], isLoading } = useQuery<StockLocation[]>({
    queryKey: ['stock-locations'],
    queryFn: () => stockLocationsApi.list(),
  });
  const { data: equipements = [] } = useQuery<Equipement[]>({
    queryKey: ['production-equipements'],
    queryFn: () => productionCoutApi.listEquipements(),
    enabled: coldOn && (moduleActive('production') || moduleActive('recipes')),
  });

  const saveMut = useMutation({
    mutationFn: ({ id, data }: { id?: string; data: StockLocationInput }) =>
      id ? stockLocationsApi.update(id, data) : stockLocationsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-locations'] });
      setShowForm(false); setEditing(null);
      notify.success('Emplacement enregistré.');
    },
    onError: (e) => notify.error(apiErrorMessage(e, "Échec de l'enregistrement.")),
  });
  const deactivateMut = useMutation({
    mutationFn: (id: string) => stockLocationsApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-locations'] }); notify.success('Emplacement désactivé.'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Échec de la désactivation.')),
  });

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (l: StockLocation) => { setEditing(l); setShowForm(true); };
  const askDeactivate = async (l: StockLocation) => {
    const ok = await confirm(`Désactiver l'emplacement « ${l.name} » ?`, { title: 'Désactiver', confirmLabel: 'Désactiver', danger: true });
    if (ok) deactivateMut.mutate(l.id);
  };

  return (
    <div className="stk-stack">
      <HeaderActions>
        <button type="button" onClick={openNew} className="odoo-btn-primary"><Plus size={14} aria-hidden="true" /> Nouvel emplacement</button>
      </HeaderActions>

      {isLoading ? (
        <LoadingState label="Chargement des emplacements…" />
      ) : locations.length === 0 ? (
        <EmptyState icon={MapPin} title="Aucun emplacement" text="Déclarez vos chambres, zones et bacs pour y ranger les lots."
          action={<button type="button" onClick={openNew} className="odoo-btn-primary"><Plus size={13} aria-hidden="true" /> Nouvel emplacement</button>} />
      ) : (
        <DataPanel label="Emplacements" footer={<TableFooter note={`${locations.length} emplacement${locations.length > 1 ? 's' : ''} déclaré${locations.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Code</th><th>Nom</th><th>Type</th><th>Rôle</th>{coldOn && <th>Sonde / enceinte</th>}
              {coldOn && <th>Plage de température (°C)</th>}<th className="ds-num">Capacité</th><th>Emplacement parent</th>
              {hasFeature('lots') && <th className="ds-num">Lots</th>}<th className="ds-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => {
              const tMin = num(l.temp_min_effectif), tMax = num(l.temp_max_effectif);
              const inherited = l.temp_min == null && l.equipement_id != null;
              return (
                <tr key={l.id}>
                  <td><span className="ds-ref">{l.code}</span></td>
                  <td className="ds-strong">{l.name}</td>
                  <td><span className={TYPE_BADGE[l.type] || 'odoo-tag'}>{typeLabel(l.type)}</span></td>
                  <td>{l.role ? (STOCK_LOCATION_ROLES as Record<string, { label: string }>)[l.role]?.label ?? l.role : '—'}
                    {l.role_default && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }} title="Emplacement utilisé par défaut pour ce rôle">Par défaut</span>}</td>
                  {coldOn && <td className="text-gray-600">{l.equipement_nom ? <span className="inline-flex items-center gap-1"><Snowflake size={11} className="text-sky-500" />{l.equipement_nom}</span> : '—'}</td>}
                  {coldOn && <td className="tabular-nums">
                    {tMin != null || tMax != null ? (
                      <span className="inline-flex items-center gap-1"><Thermometer size={11} className="text-orange-500" />{tMin ?? '?'} / {tMax ?? '?'}{inherited && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>hérité</span>}</span>
                    ) : '—'}
                  </td>}
                  <td className="ds-num">{l.capacite_valeur != null ? `${parseFloat(String(l.capacite_valeur))} ${l.capacite_unite ?? ''}` : '—'}</td>
                  <td className="text-gray-500">{l.parent_code ? `${l.parent_code} — ${l.parent_name}` : '—'}</td>
                  {hasFeature('lots') && <td className="tabular-nums ds-num">{l.lot_count > 0 ? <span className="inline-flex items-center gap-1"><Package size={11} className="text-gray-400" />{l.lot_count}</span> : '—'}</td>}
                  <td className="ds-actions">
                    <button type="button" onClick={() => openEdit(l)} className="odoo-btn-secondary ds-btn-sm"><Pencil size={12} aria-hidden="true" /> Modifier</button>
                    <RowMenu items={[{ label: 'Désactiver', icon: Trash2, danger: true, onSelect: () => askDeactivate(l) }]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </DataPanel>
      )}

      {showForm && (
        <EmplacementForm
          initial={editing}
          locations={locations}
          equipements={equipements}
          saving={saveMut.isPending}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={(data) => saveMut.mutate({ id: editing?.id, data })}
        />
      )}
    </div>
  );
}

function EmplacementForm({ initial, locations, equipements, saving, onCancel, onSave }: {
  initial: StockLocation | null;
  locations: StockLocation[];
  equipements: Equipement[];
  saving: boolean;
  onCancel: () => void;
  onSave: (data: StockLocationInput) => void;
}) {
  const { moduleActive, hasFeature } = usePermissions();
  const coldOn = hasFeature('haccp') || hasFeature('releves_temperature');
  const roleOn = (k: string) => k === 'quarantaine' ? hasFeature('quarantaine') : k === 'en_cours_ouvert' ? hasFeature('pesage')
    : k === 'atelier' ? moduleActive('production') : k === 'chantier' ? moduleActive('projects') : k === 'quai' ? hasFeature('stock_deposant') : true;
  const [f, setF] = useState<StockLocationInput>(initial ? {
    code: initial.code, name: initial.name, type: initial.type, role: initial.role, roleDefault: initial.role_default,
    parentId: initial.parent_id, equipementId: initial.equipement_id,
    tempMin: num(initial.temp_min), tempMax: num(initial.temp_max),
    capaciteUnite: initial.capacite_unite, capaciteValeur: num(initial.capacite_valeur),
  } : { ...emptyForm });
  const set = (patch: Partial<StockLocationInput>) => setF(s => ({ ...s, ...patch }));
  const submit = () => {
    if (!f.code.trim() || !f.name.trim()) { setTried(true); notify.error('Code et nom requis.'); return; }
    onSave({ ...f, code: f.code.trim(), name: f.name.trim() });
  };
  // Erreurs affichées sous les champs après une première tentative d'enregistrement.
  const [tried, setTried] = useState(false);
  // Types actifs du référentiel (secteur de la société) ; le type déjà enregistré reste proposé.
  const refTypes = useReferentiel('stock_location_types');
  const typeOptions = (current: string): [string, string][] => {
    const list: [string, string][] = refTypes.entries.length
      ? refTypes.entries.map(e => [e.code, e.label])
      : Object.entries(TYPE_LABELS);
    return list.some(([k]) => k === current) || !current ? list : [[current, refTypes.map[current]?.label ?? TYPE_LABELS[current] ?? current], ...list];
  };
  const inp = 'ds-input';
  return (
    <Modal title={initial ? 'Modifier l\'emplacement' : 'Nouvel emplacement'} onClose={onCancel} locked={saving} width={512}
      footer={<FormFooter onCancel={onCancel} busy={saving} submitLabel={saving ? 'Enregistrement…' : 'Enregistrer'} onSubmit={submit} />}>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code" htmlFor="loc-code" required error={tried && !f.code.trim() ? 'Saisissez le code de l\'emplacement.' : undefined}>
            <input id="loc-code" value={f.code} onChange={e => set({ code: e.target.value })} className={inp} placeholder="CF-02" aria-invalid={tried && !f.code.trim() || undefined} /></FormField>
          <FormField label="Nom" htmlFor="loc-name" required error={tried && !f.name.trim() ? 'Saisissez le nom de l\'emplacement.' : undefined}>
            <input id="loc-name" value={f.name} onChange={e => set({ name: e.target.value })} className={inp} placeholder="Chambre négative" aria-invalid={tried && !f.name.trim() || undefined} /></FormField>
          <FormField label="Type" htmlFor="loc-type">
            <select id="loc-type" value={f.type} onChange={e => set({ type: e.target.value, ...(initial ? {} : { role: roleOfLocationType(e.target.value) }) })} className={inp}>
              {typeOptions(f.type).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></FormField>
          {/* Étape 8 multi-industries : le rôle dit à quoi sert l'emplacement (réception, pesée, vente…). */}
          <FormField label="Rôle" htmlFor="loc-role" hint={(STOCK_LOCATION_ROLES as Record<string, { help: string }>)[f.role ?? roleOfLocationType(f.type)]?.help}>
            <select id="loc-role" value={f.role ?? roleOfLocationType(f.type)} onChange={e => set({ role: e.target.value })} className={inp}>
              {Object.entries(STOCK_LOCATION_ROLES).filter(([k]) => roleOn(k) || k === (f.role ?? roleOfLocationType(f.type))).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select></FormField>
          <label className="col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={!!f.roleDefault} onChange={e => set({ roleDefault: e.target.checked })} />
            Emplacement par défaut pour ce rôle dans l'établissement
          </label>
          {coldOn && <FormField label="Enceinte (sonde HACCP)">
            <SearchSelect value={f.equipementId != null ? String(f.equipementId) : ''} onChange={id => set({ equipementId: id || null })}
              placeholder="— aucune —" width="100%" size="md" ariaLabel="Enceinte (sonde HACCP)"
              options={equipements.map(eq => ({ id: String(eq.id), label: eq.nom as string }))} /></FormField>}
          <FormField label="Emplacement parent">
            <SearchSelect value={f.parentId != null ? String(f.parentId) : ''} onChange={id => set({ parentId: id || null })}
              placeholder="— aucun —" width="100%" size="md" ariaLabel="Emplacement parent"
              options={locations.filter(l => l.id !== initial?.id).map(l => ({ id: String(l.id), label: `${l.code} — ${l.name}` }))} /></FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Température min (°C)" htmlFor="loc-tmin">
              <input id="loc-tmin" value={f.tempMin ?? ''} onChange={e => set({ tempMin: e.target.value === '' ? null : parseFloat(e.target.value) })} inputMode="decimal" className={inp} placeholder="hérité" /></FormField>
            <FormField label="Température max (°C)" htmlFor="loc-tmax">
              <input id="loc-tmax" value={f.tempMax ?? ''} onChange={e => set({ tempMax: e.target.value === '' ? null : parseFloat(e.target.value) })} inputMode="decimal" className={inp} placeholder="hérité" /></FormField>
          </div>
          <FormField label="Capacité" htmlFor="loc-cap">
            <input id="loc-cap" value={f.capaciteValeur ?? ''} onChange={e => set({ capaciteValeur: e.target.value === '' ? null : parseFloat(e.target.value) })} inputMode="decimal" className={inp} placeholder="valeur" /></FormField>
          <FormField label="Unité de capacité" htmlFor="loc-capu">
            <select id="loc-capu" value={f.capaciteUnite ?? ''} onChange={e => set({ capaciteUnite: e.target.value || null })} className={inp}>
              <option value="">—</option><option value="bac">bac</option><option value="plaque">plaque</option><option value="kg">kg</option>
            </select></FormField>
        </div>
    </Modal>
  );
}
