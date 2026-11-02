import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Pencil, Trash2, Thermometer, X, Snowflake, Package } from 'lucide-react';
import { stockLocationsApi, type StockLocation, type StockLocationInput } from '../../api/stock-locations.api';
import { productionCoutApi } from '../../api/production-cout.api';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';

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
  const qc = useQueryClient();
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
    <div style={{ padding: '1rem' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-gray-700">
          <MapPin size={16} className="text-blue-600" />
          <span className="font-semibold">Emplacements de stock</span>
          <span className="text-xs text-gray-400">{locations.length} déclaré(s)</span>
        </div>
        <button onClick={openNew} className="odoo-btn-primary"><Plus size={14} /> Nouvel emplacement</button>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-gray-400">Chargement…</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-10 text-gray-400">Aucun emplacement. Déclarez vos chambres, zones et bacs.</div>
      ) : (
        <table className="odoo-table">
          <thead>
            <tr>
              <th>Code</th><th>Nom</th><th>Type</th><th>Sonde / enceinte</th>
              <th>Plage T°</th><th>Capacité</th><th>Emplacement parent</th>
              <th style={{ textAlign: 'right' }}>Lots</th><th />
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => {
              const tMin = num(l.temp_min_effectif), tMax = num(l.temp_max_effectif);
              const inherited = l.temp_min == null && l.equipement_id != null;
              return (
                <tr key={l.id}>
                  <td className="font-mono font-semibold">{l.code}</td>
                  <td>{l.name}</td>
                  <td><span className={TYPE_BADGE[l.type] || 'odoo-tag'}>{TYPE_LABELS[l.type] || l.type}</span></td>
                  <td className="text-gray-600">{l.equipement_nom ? <span className="inline-flex items-center gap-1"><Snowflake size={11} className="text-sky-500" />{l.equipement_nom}</span> : '—'}</td>
                  <td className="tabular-nums">
                    {tMin != null || tMax != null ? (
                      <span className="inline-flex items-center gap-1"><Thermometer size={11} className="text-orange-500" />{tMin ?? '?'} / {tMax ?? '?'} °C{inherited && <span className="text-[10px] text-gray-400">hérité</span>}</span>
                    ) : '—'}
                  </td>
                  <td className="tabular-nums">{l.capacite_valeur != null ? `${parseFloat(String(l.capacite_valeur))} ${l.capacite_unite ?? ''}` : '—'}</td>
                  <td className="text-gray-500">{l.parent_code ? `${l.parent_code} — ${l.parent_name}` : '—'}</td>
                  <td style={{ textAlign: 'right' }} className="tabular-nums">{l.lot_count > 0 ? <span className="inline-flex items-center gap-1"><Package size={11} className="text-gray-400" />{l.lot_count}</span> : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(l)} className="odoo-btn-secondary" style={{ padding: '2px 8px' }}><Pencil size={12} /></button>
                    <button onClick={() => askDeactivate(l)} className="odoo-btn-secondary" style={{ padding: '2px 8px', marginLeft: 4 }} title="Désactiver"><Trash2 size={12} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
  const [f, setF] = useState<StockLocationInput>(initial ? {
    code: initial.code, name: initial.name, type: initial.type,
    parentId: initial.parent_id, equipementId: initial.equipement_id,
    tempMin: num(initial.temp_min), tempMax: num(initial.temp_max),
    capaciteUnite: initial.capacite_unite, capaciteValeur: num(initial.capacite_valeur),
  } : { ...emptyForm });
  const set = (patch: Partial<StockLocationInput>) => setF(s => ({ ...s, ...patch }));
  const submit = () => {
    if (!f.code.trim() || !f.name.trim()) { notify.error('Code et nom requis.'); return; }
    onSave({ ...f, code: f.code.trim(), name: f.name.trim() });
  };
  const inp = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><MapPin size={16} className="text-blue-600" /> {initial ? 'Modifier' : 'Nouvel'} emplacement</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Code</span>
            <input value={f.code} onChange={e => set({ code: e.target.value })} className={inp} placeholder="CF-02" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Nom</span>
            <input value={f.name} onChange={e => set({ name: e.target.value })} className={inp} placeholder="Chambre négative" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Type</span>
            <select value={f.type} onChange={e => set({ type: e.target.value })} className={inp}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Enceinte (sonde HACCP)</span>
            <select value={f.equipementId ?? ''} onChange={e => set({ equipementId: e.target.value || null })} className={inp}>
              <option value="">— aucune —</option>
              {equipements.map(eq => <option key={eq.id} value={eq.id}>{eq.nom}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Emplacement parent</span>
            <select value={f.parentId ?? ''} onChange={e => set({ parentId: e.target.value || null })} className={inp}>
              <option value="">— aucun —</option>
              {locations.filter(l => l.id !== initial?.id).map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">T° min</span>
              <input value={f.tempMin ?? ''} onChange={e => set({ tempMin: e.target.value === '' ? null : parseFloat(e.target.value) })} inputMode="decimal" className={inp} placeholder="hérité" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">T° max</span>
              <input value={f.tempMax ?? ''} onChange={e => set({ tempMax: e.target.value === '' ? null : parseFloat(e.target.value) })} inputMode="decimal" className={inp} placeholder="hérité" /></label>
          </div>
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Capacité</span>
            <input value={f.capaciteValeur ?? ''} onChange={e => set({ capaciteValeur: e.target.value === '' ? null : parseFloat(e.target.value) })} inputMode="decimal" className={inp} placeholder="valeur" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-gray-600">Unité capacité</span>
            <select value={f.capaciteUnite ?? ''} onChange={e => set({ capaciteUnite: e.target.value || null })} className={inp}>
              <option value="">—</option><option value="bac">bac</option><option value="plaque">plaque</option><option value="kg">kg</option>
            </select></label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onCancel} className="odoo-btn-secondary">Annuler</button>
          <button onClick={submit} disabled={saving} className="odoo-btn-primary">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  );
}
