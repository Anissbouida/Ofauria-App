import { useState, useMemo } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contenantsApi } from '../../api/contenants.api';
import { recipesApi } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';
import {
  Plus, Pencil, Trash2, Search, X, Check, ChevronDown, ChevronUp,
  Layers, Package, Weight,
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
  // Dimensions physiques (mig 167)
  longueur_cm?: string | null;
  largeur_cm?: string | null;
  profondeur_cm?: string | null;
  diametre_cm?: string | null;
  type_decoupe?: string | null;
  nb_pieces_decoupe?: number | null;
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

/** Champs de formulaire : densite et jetons de couleur alignes sur le reste du module. */
const FIELD = 'w-full h-8 px-2 bg-white border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400';
const LABEL = 'block text-xs font-medium text-gray-500 mb-1';

/** Meme en-tete triable que la liste des fiches (flechage `odoo-sort-arrow`, focus clavier). */
function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = currentKey === sk;
  return (
    <th style={{ textAlign: align }} aria-sort={active ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span role="button" tabIndex={0}
        onClick={() => onSort(sk)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(sk); } }}
        className="inline-flex items-center gap-1 cursor-pointer">
        {label}
        <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
          {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
        </span>
      </span>
    </th>
  );
}

/**
 * Referentiel des formats de production (contenants).
 *
 * Rendu comme onglet des Fiches techniques : le titre et le bouton « Nouveau format »
 * vivent dans la barre de controle du parent, comme pour les deux autres onglets.
 * `creating` peut donc etre pilote de l'exterieur ; sans prop, la page reste autonome.
 */
export default function ContenantsPage({ creating: creatingProp, onCreatingChange }: {
  creating?: boolean;
  onCreatingChange?: (v: boolean) => void;
} = {}) {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(0);
  const [editing, setEditing] = useState<Contenant | null>(null);
  const [creatingLocal, setCreatingLocal] = useState(false);
  const creating = creatingProp ?? creatingLocal;
  const setCreating = (v: boolean) => { if (onCreatingChange) onCreatingChange(v); else setCreatingLocal(v); };
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
      notify.success('Format desactive');
    },
    onError: (err: Error) => notify.error(err.message || 'Impossible de desactiver (produits lies)'),
  });

  const activeCount = contenants.filter(c => c.is_active).length;

  return (
    <>
      {/* ══════ SEARCH PANEL — même bandeau que les deux autres onglets ══════ */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher un format..."
          className="odoo-search-input"
          value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ marginLeft: 8 }}>
          <SearchSelect
            options={Object.entries(TYPE_LABELS).map(([k, v]) => ({ id: k, label: `${TYPE_ICONS[Number(k)]} ${v}` }))}
            value={typeFilter ? String(typeFilter) : ''}
            onChange={id => setTypeFilter(id ? Number(id) : 0)}
            placeholder="Tous les types"
          />
        </div>
        {search && (
          <span className="odoo-filter-chip">
            Recherche: {search}
            <span className="odoo-filter-chip-remove" onClick={() => setSearch('')}>×</span>
          </span>
        )}
        {typeFilter > 0 && (
          <span className="odoo-filter-chip">
            {TYPE_LABELS[typeFilter]}
            <span className="odoo-filter-chip-remove" onClick={() => setTypeFilter(0)}>×</span>
          </span>
        )}
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer" style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Afficher inactifs
        </label>
        <div style={{ flex: 1 }} />
        <span className="odoo-pager">
          <strong>{sortedFiltered.length}</strong> / {activeCount}
        </span>
      </div>

      {/* ══════ FILTRES PAR TYPE ══════ */}
      {/* Ce sont des filtres, pas des indicateurs : `odoo-stat-card` porte déjà l'état
          actif et le survol, au lieu des cartes flottantes qui les faisaient passer
          pour des KPI décoratifs. */}
      <div className="odoo-stat-grid">
        {[1, 2, 3, 4, 5].map(type => {
          const count = contenants.filter(c => c.type_production === type && c.is_active).length;
          return (
            <button key={type} type="button"
              onClick={() => setTypeFilter(typeFilter === type ? 0 : type)}
              aria-pressed={typeFilter === type}
              className={`odoo-stat-card ${typeFilter === type ? 'active' : ''}`}>
              <div className="odoo-stat-card-label">
                <span style={{ marginRight: 4 }}>{TYPE_ICONS[type]}</span>{TYPE_LABELS[type]}
              </div>
              <div className="odoo-stat-card-value">{count}</div>
            </button>
          );
        })}
      </div>

      {/* ══════ CREATE / EDIT ══════ */}
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

      {/* ══════ TABLE ══════ */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem' }}>
          <div style={{ width: 28, height: 28, border: '3px solid var(--theme-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : sortedFiltered.length === 0 ? (
        <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Package size={44} style={{ margin: '0 auto 0.75rem', opacity: 0.35 }} />
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>
            {contenants.length === 0 ? 'Aucun format de production' : 'Aucun résultat'}
          </p>
          <p style={{ fontSize: '0.8125rem', marginTop: 4, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
            {contenants.length === 0
              ? 'Un format est le cadre, le moule ou la plaque dans lequel une recette est lancée : il fixe la quantité théorique et le rendement.'
              : 'Aucun format ne correspond aux filtres actifs.'}
          </p>
          <div style={{ marginTop: '1rem' }}>
            {contenants.length === 0 ? (
              <button onClick={() => { setCreating(true); setEditing(null); }} className="odoo-btn-primary">
                <Plus size={14} /> Créer un format
              </button>
            ) : (
              <button onClick={() => { setSearch(''); setTypeFilter(0); }} className="odoo-btn-secondary">
                Réinitialiser les filtres
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <SortHeader label="Format" sortKey="nom" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Type" sortKey="type_production" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Unité" sortKey="unite_lancement" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <th>Mode</th>
                <SortHeader label="Théorique" sortKey="quantite_theorique" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Pertes" sortKey="pertes_fixes" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Net cible" sortKey="quantite_nette_cible" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Seuil %" sortKey="seuil_rendement_defaut" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Recettes" sortKey="recettes" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Statut" sortKey="is_active" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <th style={{ textAlign: 'right' }}>Actions</th>
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
                    if (confirm(`Désactiver « ${c.nom} » ?\n\nLes produits liés devront être réassignés.`))
                      deleteMutation.mutate(c.id);
                  }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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
  const mode = getModeCalcul(c.unite_lancement);
  const unite = mode === 'poids' ? 'kg' : 'pcs';
  const num = (v: string) => (
    <>
      <span style={{ fontWeight: 600 }}>{v}</span>
      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{unite}</span>
    </>
  );

  return (
    <>
      <tr onClick={onToggle} style={!c.is_active ? { opacity: 0.55 } : undefined}>
        {/* Pastille = santé de la donnée, comme dans la liste des fiches (elle ne
            redouble pas la colonne Statut) : un format actif que personne n'utilise
            est un format à raccrocher ou à désactiver. */}
        <td>
          <span className={`odoo-status-dot ${!c.is_active ? 'neutral' : linkedRecipes.length === 0 ? 'warning' : 'ok'}`}
            title={!c.is_active ? 'Format inactif'
              : linkedRecipes.length === 0 ? 'Aucune recette n’utilise ce format'
              : `${linkedRecipes.length} recette(s) liée(s)`} />
        </td>
        <td>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            {expanded ? <ChevronUp size={13} style={{ color: 'var(--theme-text-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--theme-text-muted)' }} />}
            <span>{TYPE_ICONS[c.type_production]}</span>
            {c.nom}
          </span>
        </td>
        <td>
          <span className="odoo-tag odoo-tag-grey">{TYPE_LABELS[c.type_production]}</span>
        </td>
        <td style={{ color: 'var(--theme-text-muted)' }}>{c.unite_lancement}</td>
        <td>
          <span className={`odoo-tag ${mode === 'poids' ? 'odoo-tag-blue' : 'odoo-tag-purple'}`}>
            {mode === 'poids' ? 'POIDS' : 'PIÈCES'}
          </span>
        </td>
        <td style={{ textAlign: 'right' }}>{num(c.quantite_theorique)}</td>
        <td style={{ textAlign: 'right', color: parseFloat(c.pertes_fixes) > 0 ? '#dc3545' : undefined }}>
          {parseFloat(c.pertes_fixes) > 0 ? num(`-${c.pertes_fixes}`) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
        </td>
        <td style={{ textAlign: 'right', color: '#28a745' }}>{num(c.quantite_nette_cible)}</td>
        <td style={{ textAlign: 'right' }}>
          <span style={{ fontWeight: 500 }}>{parseFloat(c.seuil_rendement_defaut)}</span>
          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>%</span>
        </td>
        <td style={{ textAlign: 'right' }}>
          {linkedRecipes.length > 0
            ? <span className="odoo-tag odoo-tag-purple">{linkedRecipes.length}</span>
            : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
        </td>
        <td>
          <span className={`odoo-tag ${c.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>
            {c.is_active ? 'Actif' : 'Inactif'}
          </span>
        </td>
        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'inline-flex', gap: 2 }}>
            <button onClick={onEdit} className="odoo-pager-btn" title="Modifier le format">
              <Pencil size={13} />
            </button>
            {c.is_active && (
              <button onClick={onDeactivate} className="odoo-pager-btn" title="Désactiver le format"
                style={{ color: '#dc3545' }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {/* Expanded detail */}
      {expanded && (
        <tr style={{ cursor: 'default' }}>
          <td colSpan={12} style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--theme-bg-page)' }}>
            <div className="grid grid-cols-2 gap-6">
              {/* Linked recipes */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ChefHat size={12} /> Recettes liées ({linkedRecipes.length})
                </h4>
                <div className="space-y-1.5">
                  {linkedRecipes.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 bg-white rounded px-3 py-1.5 border border-gray-200">
                      {r.is_base
                        ? <Layers size={12} style={{ color: 'var(--theme-accent)' }} />
                        : <ChefHat size={12} style={{ color: 'var(--theme-accent)' }} />}
                      <span className="flex-1 text-sm">{r.name}</span>
                      <span className={`odoo-tag ${r.is_base ? 'odoo-tag-purple' : 'odoo-tag-green'}`}>
                        {r.is_base ? 'Base' : 'Produit'}
                      </span>
                      {r.etapes.length > 0 && (
                        <span className="odoo-tag odoo-tag-grey"><ListChecks size={9} /> {r.etapes.length} étapes</span>
                      )}
                    </div>
                  ))}
                  {linkedRecipes.length === 0 && (
                    <p className="text-xs text-gray-400 italic">Aucune recette liée à ce format</p>
                  )}
                </div>
              </div>
              {/* Loss categories */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Catégories de pertes</h4>
                {c.categories_pertes?.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {c.categories_pertes.map((p, i) => (
                      <span key={i} className="odoo-tag odoo-tag-red">{p.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">Aucune catégorie</p>
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
  // Dimensions physiques (mig 167)
  const [longueurCm, setLongueurCm] = useState(contenant?.longueur_cm || '');
  const [largeurCm, setLargeurCm] = useState(contenant?.largeur_cm || '');
  const [profondeurCm, setProfondeurCm] = useState(contenant?.profondeur_cm || '');
  const [diametreCm, setDiametreCm] = useState(contenant?.diametre_cm || '');
  const [typeDecoupe, setTypeDecoupe] = useState(contenant?.type_decoupe || '');
  const [nbPiecesDecoupe, setNbPiecesDecoupe] = useState(contenant?.nb_pieces_decoupe?.toString() || '');

  const mode = getModeCalcul(uniteLancement);
  const modeLabels = MODE_LABELS[mode];
  const netCible = (parseFloat(quantiteTheorique) || 0) - (parseFloat(pertesFixes) || 0);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      isEdit ? contenantsApi.update(contenant!.id, data) : contenantsApi.create(data),
    onSuccess: () => {
      notify.success(isEdit ? 'Format mis a jour' : 'Format cree');
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
      longueur_cm: longueurCm ? parseFloat(longueurCm) : null,
      largeur_cm: largeurCm ? parseFloat(largeurCm) : null,
      profondeur_cm: profondeurCm ? parseFloat(profondeurCm) : null,
      diametre_cm: diametreCm ? parseFloat(diametreCm) : null,
      type_decoupe: typeDecoupe || null,
      nb_pieces_decoupe: nbPiecesDecoupe ? parseInt(nbPiecesDecoupe, 10) : null,
    });
  };

  return (
    <div className="odoo-section">
      <form onSubmit={handleSubmit}>
        <div className="odoo-section-header" style={{ justifyContent: 'space-between' }}>
          <span className="inline-flex items-center gap-2">
            <Layers size={13} /> {isEdit ? `Modifier le format : ${contenant!.nom}` : 'Nouveau format de production'}
          </span>
          <button type="button" onClick={onClose} className="odoo-pager-btn" title="Fermer">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--theme-bg-card)' }}>
          {/* Row 1: Nom + Type + Unite */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>Nom *</label>
              <input type="text" required value={nom} onChange={e => setNom(e.target.value)}
                placeholder="Ex: Cadre 40x60cm" className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Type de production</label>
              <select value={typeProduction} onChange={e => setTypeProduction(Number(e.target.value))} className={FIELD}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{TYPE_ICONS[Number(k)]} {v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Unité de lancement</label>
              <select value={uniteLancement} onChange={e => setUniteLancement(e.target.value)} className={FIELD}>
                {UNITE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mode déduit de l'unité de lancement — bleu/violet identiques aux tags du tableau */}
          <div className={`rounded p-2.5 flex items-center gap-2.5 text-sm border ${
            mode === 'poids' ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200'
          }`}>
            <Weight size={15} className={mode === 'poids' ? 'text-blue-600' : 'text-purple-600'} />
            <div>
              <span className={`odoo-tag ${mode === 'poids' ? 'odoo-tag-blue' : 'odoo-tag-purple'}`}>
                {mode === 'poids' ? 'POIDS' : 'PIÈCES'}
              </span>
              <span className="text-gray-500 ml-2 text-xs">
                {mode === 'poids'
                  ? 'Quantités en kg — coût calculé au kg'
                  : 'Quantités en pièces — coût calculé à la pièce'}
              </span>
            </div>
          </div>

          {/* Row 2: Quantities */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className={LABEL}>{modeLabels.quantiteTheorique} *</label>
              <input type="number" step="0.01" min="0" required
                value={quantiteTheorique} onChange={e => setQuantiteTheorique(e.target.value)}
                className={`${FIELD} text-right tabular-nums`} />
            </div>
            <div>
              <label className={LABEL}>{modeLabels.pertesFixes}</label>
              <input type="number" step="0.01" min="0"
                value={pertesFixes} onChange={e => setPertesFixes(e.target.value)}
                className={`${FIELD} text-right tabular-nums`} />
            </div>
            <div>
              <label className={LABEL}>{modeLabels.netCible}</label>
              <div className="h-8 px-2 flex items-center justify-end rounded border text-sm font-semibold tabular-nums"
                style={{ backgroundColor: '#d4edda', borderColor: '#b7dfc1', color: '#155724' }}
                title="Calculé : quantité théorique − pertes fixes">
                {netCible.toFixed(2)}
                <span className="text-[11px] font-normal ml-1 opacity-70">{modeLabels.uniteRendement}</span>
              </div>
            </div>
            <div>
              <label className={LABEL}>Seuil rendement %</label>
              <input type="number" step="0.1" min="0" max="100"
                value={seuilRendement} onChange={e => setSeuilRendement(e.target.value)}
                className={`${FIELD} text-right tabular-nums`} />
            </div>
          </div>

          {/* Categories de pertes */}
          <div>
            <label className={LABEL}>
              Catégories de pertes <span className="text-gray-400">(séparées par des virgules)</span>
            </label>
            <input type="text" value={categoriesPertes} onChange={e => setCategoriesPertes(e.target.value)}
              placeholder="bords, accidents_decoupe, qualite_visuelle" className={FIELD} />
          </div>

          {/* Dimensions physiques (mig 167) — sert au libelle, au rendement decoupe et a la comparaison */}
          <div className="border border-gray-200 rounded p-3 space-y-3" style={{ backgroundColor: 'var(--theme-bg-page)' }}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-2">
              📐 Dimensions physiques <span className="font-normal normal-case tracking-normal text-gray-400">(optionnel)</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className={LABEL}>Longueur (cm)</label>
                <input type="number" step="0.1" min="0"
                  value={longueurCm} onChange={e => setLongueurCm(e.target.value)}
                  placeholder="40" className={`${FIELD} text-right tabular-nums`} />
              </div>
              <div>
                <label className={LABEL}>Largeur (cm)</label>
                <input type="number" step="0.1" min="0"
                  value={largeurCm} onChange={e => setLargeurCm(e.target.value)}
                  placeholder="60" className={`${FIELD} text-right tabular-nums`} />
              </div>
              <div>
                <label className={LABEL}>Profondeur (cm)</label>
                <input type="number" step="0.1" min="0"
                  value={profondeurCm} onChange={e => setProfondeurCm(e.target.value)}
                  placeholder="4.5" className={`${FIELD} text-right tabular-nums`} />
              </div>
              <div>
                <label className={LABEL}>Diamètre (cm)</label>
                <input type="number" step="0.1" min="0"
                  value={diametreCm} onChange={e => setDiametreCm(e.target.value)}
                  placeholder="18" className={`${FIELD} text-right tabular-nums`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Type de découpe</label>
                <select value={typeDecoupe} onChange={e => setTypeDecoupe(e.target.value)} className={FIELD}>
                  <option value="">— Non spécifié —</option>
                  <option value="sans_decoupe">Sans découpe</option>
                  <option value="damier">Damier (grille régulière)</option>
                  <option value="bande">Bande (tranches)</option>
                  <option value="triangle">Triangle (parts)</option>
                  <option value="forme_libre">Forme libre (emporte-pièce)</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Nb pièces après découpe</label>
                <input type="number" step="1" min="1"
                  value={nbPiecesDecoupe} onChange={e => setNbPiecesDecoupe(e.target.value)}
                  placeholder="20" className={`${FIELD} text-right tabular-nums`} />
              </div>
            </div>
            {/* Apercu format libelle */}
            {(longueurCm && largeurCm) || diametreCm ? (
              <div className="text-xs text-gray-500">
                Format affiché : <strong className="text-gray-700">
                  {diametreCm ? `Ø${diametreCm} cm` : `${longueurCm}×${largeurCm} cm`}
                  {profondeurCm && ` × ${profondeurCm} cm`}
                </strong>
                {nbPiecesDecoupe && <span> → <strong className="text-gray-700">{nbPiecesDecoupe} pièces</strong></span>}
              </div>
            ) : null}
          </div>

          {/* Info: étapes gérées dans les recettes */}
          <div className="rounded p-3 flex items-start gap-2.5 border"
            style={{ backgroundColor: 'var(--theme-accent-light)', borderColor: 'var(--theme-accent)' }}>
            <ListChecks size={16} style={{ color: 'var(--theme-accent)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--theme-text-strong)' }}>
                Les étapes de production sont gérées dans les recettes
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Éditez-les dans l'onglet « Étapes » de chaque recette liée à ce format.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2"
          style={{ backgroundColor: 'var(--theme-bg-page)' }}>
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button type="submit" disabled={saveMutation.isPending} className="odoo-btn-primary">
            <Check size={14} /> {saveMutation.isPending ? 'Enregistrement…' : (isEdit ? 'Mettre à jour' : 'Créer')}
          </button>
        </div>
      </form>
    </div>
  );
}
