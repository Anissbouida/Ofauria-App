import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contenantsApi } from '../../api/contenants.api';
import { recipesApi } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';
import {
  Plus, Pencil, Trash2, Search, X, Check, ChevronDown, ChevronUp,
  Layers, Clock, AlertTriangle, RotateCcw, Package, Weight,
  ArrowUp, ArrowDown, ArrowUpDown, ChefHat, ListChecks,
} from 'lucide-react';
import {
  getModeCalcul, MODE_LABELS, TYPE_PRODUCTION_LABELS, UNITE_LANCEMENT_OPTIONS,
  type ModeCalcul,
} from '@ofauria/shared';

// ─── Types ───

interface Contenant {
  id: string;
  nom: string;
  type_production: number;
  unite_lancement: string;
  quantite_theorique: string;
  pertes_fixes: string;
  poids_kg: string | null;
  quantite_nette_cible: string;
  seuil_rendement_defaut: string;
  etapes_defaut: unknown[];
  categories_pertes: string[];
  is_active: boolean;
  created_at: string;
  products?: { id: string; name: string }[];
}

interface LinkedRecipe {
  id: string;
  name: string;
  is_base: boolean;
  product_name: string | null;
  etapes: { ordre: number; nom: string }[];
}

const TYPE_LABELS = TYPE_PRODUCTION_LABELS;

const TYPE_ICONS: Record<number, string> = {
  1: '🍰', 2: '🎂', 3: '🧁', 4: '🥖', 5: '🥐',
};

const UNITE_OPTIONS = UNITE_LANCEMENT_OPTIONS;

// ─── Main Page ───

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = currentKey === sk;
  return (
    <th className={`${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} px-5 py-3 text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-700 transition-colors`}
      onClick={() => onSort(sk)}>
      <span className="inline-flex items-center gap-1">
        {align === 'right' && (active
          ? (currentDir === 'asc' ? <ArrowUp size={12} className="text-blue-500" /> : <ArrowDown size={12} className="text-blue-500" />)
          : <ArrowUpDown size={11} className="opacity-30" />)}
        {label}
        {align !== 'right' && (active
          ? (currentDir === 'asc' ? <ArrowUp size={12} className="text-blue-500" /> : <ArrowDown size={12} className="text-blue-500" />)
          : <ArrowUpDown size={11} className="opacity-30" />)}
      </span>
    </th>
  );
}

export default function ContenantsPage() {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(0);
  const [editing, setEditing] = useState<Contenant | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>('nom');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'quantite_theorique' || key === 'quantite_nette_cible' ? 'desc' : 'asc'); }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['contenants', showInactive],
    queryFn: () => contenantsApi.list(showInactive),
  });
  const contenants: Contenant[] = data?.data || [];

  const { data: allRecipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: recipesApi.list,
  });

  // Group recipes by contenant_id
  const recipesByContenant = useMemo(() => {
    const map: Record<string, LinkedRecipe[]> = {};
    for (const r of allRecipes) {
      if (r.contenant_id) {
        if (!map[r.contenant_id]) map[r.contenant_id] = [];
        map[r.contenant_id].push({
          id: r.id, name: r.name, is_base: r.is_base,
          product_name: r.product_name || null,
          etapes: r.etapes || [],
        });
      }
    }
    return map;
  }, [allRecipes]);

  const filtered = contenants.filter(c => {
    if (typeFilter && c.type_production !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.nom.toLowerCase().includes(q) || TYPE_LABELS[c.type_production]?.toLowerCase().includes(q);
    }
    return true;
  });

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'nom': cmp = a.nom.localeCompare(b.nom); break;
        case 'type_production': cmp = a.type_production - b.type_production; break;
        case 'unite_lancement': cmp = a.unite_lancement.localeCompare(b.unite_lancement); break;
        case 'quantite_theorique': cmp = parseFloat(a.quantite_theorique) - parseFloat(b.quantite_theorique); break;
        case 'pertes_fixes': cmp = parseFloat(a.pertes_fixes) - parseFloat(b.pertes_fixes); break;
        case 'quantite_nette_cible': cmp = parseFloat(a.quantite_nette_cible) - parseFloat(b.quantite_nette_cible); break;
        case 'seuil_rendement_defaut': cmp = parseFloat(a.seuil_rendement_defaut) - parseFloat(b.seuil_rendement_defaut); break;
        case 'recettes': cmp = (recipesByContenant[a.id]?.length || 0) - (recipesByContenant[b.id]?.length || 0); break;
        case 'is_active': cmp = (a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1); break;
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => contenantsApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contenants'] });
      notify.success('Contenant desactive');
    },
    onError: (err: Error) => notify.error(err.message || 'Impossible de desactiver (produits lies)'),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers size={28} className="text-indigo-600" /> Contenants de production
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{contenants.length} contenants configures</p>
        </div>
        <button onClick={() => { setCreating(true); setEditing(null); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus size={16} /> Nouveau contenant
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(Number(e.target.value))}
          className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500">
          <option value={0}>Tous les types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{TYPE_ICONS[Number(k)]} {v}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
          Afficher inactifs
        </label>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map(type => {
          const count = contenants.filter(c => c.type_production === type && c.is_active).length;
          return (
            <div key={type}
              onClick={() => setTypeFilter(typeFilter === type ? 0 : type)}
              className={`bg-white border rounded-xl p-3 text-center cursor-pointer transition-all hover:shadow-sm ${
                typeFilter === type ? 'border-indigo-300 bg-indigo-50 shadow-sm' : 'border-gray-200'
              }`}>
              <div className="text-2xl">{TYPE_ICONS[type]}</div>
              <div className="text-lg font-bold text-gray-900 mt-1">{count}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{TYPE_LABELS[type]}</div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Form */}
      {(creating || editing) && (
        <ContenantForm
          contenant={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false); setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['contenants'] });
          }}
        />
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Package size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400 font-medium">Aucun contenant trouve</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <SortHeader label="Contenant" sortKey="nom" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Type" sortKey="type_production" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Unite" sortKey="unite_lancement" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Mode</th>
                <SortHeader label="Theorique" sortKey="quantite_theorique" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <SortHeader label="Pertes" sortKey="pertes_fixes" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <SortHeader label="Net cible" sortKey="quantite_nette_cible" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <SortHeader label="Seuil %" sortKey="seuil_rendement_defaut" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <SortHeader label="Recettes" sortKey="recettes" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <SortHeader label="Statut" sortKey="is_active" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map(c => (
                <ContenantRow key={c.id} contenant={c}
                  linkedRecipes={recipesByContenant[c.id] || []}
                  expanded={expandedId === c.id}
                  onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  onEdit={() => { setEditing(c); setCreating(false); }}
                  onDeactivate={() => {
                    if (confirm(`Desactiver "${c.nom}" ? Les produits lies devront etre reassignes.`))
                      deleteMutation.mutate(c.id);
                  }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Row Component ───

function ContenantRow({ contenant: c, linkedRecipes, expanded, onToggle, onEdit, onDeactivate }: {
  contenant: Contenant;
  linkedRecipes: LinkedRecipe[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  return (
    <>
      <tr className={`border-t border-gray-100 hover:bg-gray-50 transition-colors ${!c.is_active ? 'opacity-50' : ''}`}>
        <td className="px-5 py-3">
          <button onClick={onToggle} className="flex items-center gap-2 text-left group">
            {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            <span className="text-lg">{TYPE_ICONS[c.type_production]}</span>
            <span className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">{c.nom}</span>
          </button>
        </td>
        <td className="px-5 py-3">
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {TYPE_LABELS[c.type_production]}
          </span>
        </td>
        <td className="px-5 py-3 text-center text-gray-600">{c.unite_lancement}</td>
        <td className="px-5 py-3 text-center">
          {getModeCalcul(c.unite_lancement) === 'poids'
            ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">POIDS</span>
            : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">PIECES</span>
          }
        </td>
        <td className="px-5 py-3 text-center font-semibold text-indigo-700">
          {c.quantite_theorique} <span className="text-[10px] text-gray-400">{getModeCalcul(c.unite_lancement) === 'poids' ? 'kg' : 'pcs'}</span>
        </td>
        <td className="px-5 py-3 text-center font-semibold text-red-500">
          -{c.pertes_fixes} <span className="text-[10px] text-gray-400">{getModeCalcul(c.unite_lancement) === 'poids' ? 'kg' : 'pcs'}</span>
        </td>
        <td className="px-5 py-3 text-center font-bold text-emerald-600">
          {c.quantite_nette_cible} <span className="text-[10px] text-gray-400">{getModeCalcul(c.unite_lancement) === 'poids' ? 'kg' : 'pcs'}</span>
        </td>
        <td className="px-5 py-3 text-center font-semibold text-amber-600">{c.seuil_rendement_defaut}%</td>
        <td className="px-5 py-3 text-center">
          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs font-bold rounded-full">
            {linkedRecipes.length}
          </span>
        </td>
        <td className="px-5 py-3 text-center">
          {c.is_active ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">Actif</span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">Inactif</span>
          )}
        </td>
        <td className="px-5 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={onEdit} className="p-2 hover:bg-indigo-50 rounded-lg transition-colors" title="Modifier">
              <Pencil size={15} className="text-gray-500 hover:text-indigo-600" />
            </button>
            {c.is_active && (
              <button onClick={onDeactivate} className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Desactiver">
                <Trash2 size={15} className="text-gray-400 hover:text-red-600" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={11} className="px-5 py-4 bg-gray-50 border-t border-gray-100">
            <div className="grid grid-cols-2 gap-6">
              {/* Linked recipes */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ChefHat size={12} /> Recettes liees ({linkedRecipes.length})
                </h4>
                <div className="space-y-1.5">
                  {linkedRecipes.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100">
                      <span className={`p-1 rounded ${r.is_base ? 'bg-amber-100' : 'bg-orange-50'}`}>
                        {r.is_base ? <Layers size={12} className="text-amber-600" /> : <ChefHat size={12} className="text-amber-700" />}
                      </span>
                      <span className="flex-1 text-sm font-medium text-gray-800">{r.name}</span>
                      {r.etapes.length > 0 && (
                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-[9px] font-bold rounded flex items-center gap-0.5">
                          <ListChecks size={9} /> {r.etapes.length} etapes
                        </span>
                      )}
                    </div>
                  ))}
                  {linkedRecipes.length === 0 && (
                    <p className="text-xs text-gray-400 italic">Aucune recette liee a ce contenant</p>
                  )}
                </div>
              </div>
              {/* Loss categories */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Categories de pertes</h4>
                {c.categories_pertes?.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {c.categories_pertes.map((p, i) => (
                      <span key={i} className="px-2.5 py-1 bg-red-50 border border-red-100 text-red-700 text-xs font-medium rounded-lg">
                        {p.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">Aucune categorie</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Create / Edit Form ───

function ContenantForm({ contenant, onClose, onSaved }: {
  contenant: Contenant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!contenant;

  const [nom, setNom] = useState(contenant?.nom || '');
  const [typeProduction, setTypeProduction] = useState(contenant?.type_production || 1);
  const [uniteLancement, setUniteLancement] = useState(contenant?.unite_lancement || 'cadre');
  const [quantiteTheorique, setQuantiteTheorique] = useState(contenant?.quantite_theorique || '');
  const [pertesFixes, setPertesFixes] = useState(contenant?.pertes_fixes || '0');
  const [seuilRendement, setSeuilRendement] = useState(contenant?.seuil_rendement_defaut || '90');
  const [categoriesPertes, setCategoriesPertes] = useState(contenant?.categories_pertes?.join(', ') || '');

  const mode = getModeCalcul(uniteLancement);
  const modeLabels = MODE_LABELS[mode];
  const netCible = (parseFloat(quantiteTheorique) || 0) - (parseFloat(pertesFixes) || 0);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      isEdit ? contenantsApi.update(contenant!.id, data) : contenantsApi.create(data),
    onSuccess: () => {
      notify.success(isEdit ? 'Contenant mis a jour' : 'Contenant cree');
      onSaved();
    },
    onError: () => notify.error('Erreur lors de l\'enregistrement'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nom.trim() || !quantiteTheorique) {
      notify.error('Nom et quantite theorique sont obligatoires');
      return;
    }
    saveMutation.mutate({
      nom: nom.trim(),
      type_production: typeProduction,
      unite_lancement: uniteLancement,
      quantite_theorique: parseFloat(quantiteTheorique),
      pertes_fixes: parseFloat(pertesFixes) || 0,
      seuil_rendement_defaut: parseFloat(seuilRendement) || 90,
      categories_pertes: categoriesPertes
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="bg-white border border-indigo-200 rounded-2xl shadow-lg overflow-hidden">
      <form onSubmit={handleSubmit}>
        {/* Form header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">
            {isEdit ? `Modifier : ${contenant!.nom}` : 'Nouveau contenant'}
          </h2>
          <button type="button" onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Row 1: Nom + Type + Unite */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Nom *</label>
              <input type="text" required value={nom} onChange={e => setNom(e.target.value)}
                placeholder="Ex: Cadre 40x60cm"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Type de production</label>
              <select value={typeProduction} onChange={e => setTypeProduction(Number(e.target.value))}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500">
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{TYPE_ICONS[Number(k)]} {v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Unite de lancement</label>
              <select value={uniteLancement} onChange={e => setUniteLancement(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500">
                {UNITE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mode indicator */}
          <div className={`rounded-xl p-3 flex items-center gap-3 text-sm ${
            mode === 'poids' ? 'bg-blue-50 border border-blue-200' : 'bg-purple-50 border border-purple-200'
          }`}>
            <Weight size={16} className={mode === 'poids' ? 'text-blue-500' : 'text-purple-500'} />
            <div>
              <span className={`font-semibold ${mode === 'poids' ? 'text-blue-800' : 'text-purple-800'}`}>
                Mode {mode === 'poids' ? 'POIDS' : 'PIECES'}
              </span>
              <span className="text-gray-500 ml-2">
                {mode === 'poids'
                  ? 'Quantites en kg — cout calcule au kg'
                  : 'Quantites en pieces — cout calcule a la piece'}
              </span>
            </div>
          </div>

          {/* Row 2: Quantities */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{modeLabels.quantiteTheorique} *</label>
              <input type="number" step="0.01" min="0" required
                value={quantiteTheorique} onChange={e => setQuantiteTheorique(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{modeLabels.pertesFixes}</label>
              <input type="number" step="0.01" min="0"
                value={pertesFixes} onChange={e => setPertesFixes(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{modeLabels.netCible}</label>
              <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-bold text-emerald-700">
                {netCible.toFixed(2)} <span className="text-xs font-normal">{modeLabels.uniteRendement}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Seuil rendement %</label>
              <input type="number" step="0.1" min="0" max="100"
                value={seuilRendement} onChange={e => setSeuilRendement(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {/* Categories de pertes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Categories de pertes <span className="text-xs font-normal text-gray-400">(separees par des virgules)</span>
            </label>
            <input type="text" value={categoriesPertes} onChange={e => setCategoriesPertes(e.target.value)}
              placeholder="bords, accidents_decoupe, qualite_visuelle"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>

          {/* Info: étapes gérées dans les recettes */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
            <ListChecks size={18} className="text-indigo-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-indigo-800">Les etapes de production sont gerees dans les recettes</p>
              <p className="text-xs text-indigo-600 mt-0.5">Editez les etapes directement dans l'onglet "Etapes" de chaque recette liee a ce contenant.</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50">
          <button type="button" onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-colors">
            Annuler
          </button>
          <button type="submit" disabled={saveMutation.isPending}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm">
            {saveMutation.isPending ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Enregistrement...</>
            ) : (
              <><Check size={16} /> {isEdit ? 'Mettre a jour' : 'Creer'}</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
