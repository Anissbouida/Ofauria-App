import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Edit3, X, Save, Tag, Boxes, ShieldAlert, Info } from 'lucide-react';
import { suppliersApi } from '../../api/accounting.api';
import { referentielApi } from '../../api/referentiel.api';
import { AllergenSelector } from '../../components/ui/AllergenSelector';
import SearchSelect, { type SearchSelectOption } from '../../components/ui/SearchSelect';
import { useStockCategories, STOCKABLE_ROOT_IDS } from './useStockCategories';

/*
 * Formulaire unique de creation / modification d'un ingredient.
 * Sections : identification (nom, unite, cout), classement (categorie, fournisseur),
 * conditionnement (type de contenant + quantite par contenant), allergenes.
 * Le contenant est choisi par pastilles (referentiel container_types) avec
 * apercu « 1 sac = 25 kg » : c'est lui qui pilote l'achat et le transfert
 * vers le pesage par contenant entier (cf. utils/container).
 */

const UNITS = [
  { value: 'kg', label: 'kg', hint: 'Kilogramme' },
  { value: 'g', label: 'g', hint: 'Gramme' },
  { value: 'l', label: 'L', hint: 'Litre' },
  { value: 'ml', label: 'ml', hint: 'Millilitre' },
  { value: 'unit', label: 'Unité', hint: 'Pièce' },
];
const unitShort = (u: string) => (u === 'unit' ? 'u' : u === 'l' ? 'L' : u);

// Tailles de contenant courantes, proposees en raccourci selon l'unite de stock.
const SIZE_PRESETS: Record<string, number[]> = {
  kg: [1, 2.5, 5, 10, 25], g: [250, 500, 1000], l: [1, 5, 10, 20], ml: [250, 500, 1000], unit: [6, 12, 24, 30],
};

const fmt = (n: number) => (n % 1 === 0 ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }));

interface Props {
  mode: 'create' | 'edit';
  ingredient?: Record<string, any>;
  /** Seuil minimum actuel (edition seulement : le seuil vit sur inventory). */
  threshold?: number;
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
  isLoading: boolean;
  /** Creation depuis un BC : titre « Nouvel article », nom pre-rempli par la recherche. */
  title?: string;
  initialName?: string;
  initialSupplier?: string;
  /** Branches de categories proposees (defaut : branches stockables). */
  rootIds?: string[];
  /** Vrai si la categorie range l'article en consommable : contenant et allergenes masques. */
  isConsumable?: (categoryId: string) => boolean;
}

export default function IngredientFormModal({ mode, ingredient, threshold, onClose, onSave, isLoading, title, initialName, initialSupplier, rootIds = STOCKABLE_ROOT_IDS, isConsumable }: Props) {
  const ing = ingredient || {};
  const [form, setForm] = useState({
    name: (ing.name as string) || initialName || '',
    unit: (ing.unit as string) || 'kg',
    unitCost: ing.unit_cost != null ? String(ing.unit_cost) : '',
    supplier: (ing.supplier as string) || initialSupplier || '',
    categoryId: ing.category_id ? String(ing.category_id) : '',
    threshold: threshold != null ? String(threshold) : '',
    containerTypeId: (ing.container_type_id as string) || '',
    containerSize: ing.container_size != null ? String(ing.container_size) : '',
    densiteKgL: ing.densite_kg_l != null ? String(ing.densite_kg_l) : '',
    allergens: (Array.isArray(ing.allergens) ? ing.allergens : []) as string[],
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data: containerTypes = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['ref-entries', 'container_types'],
    queryFn: () => referentielApi.entries('container_types').then((r: any) => (r?.entries ?? []) as Record<string, any>[]),
    staleTime: 5 * 60 * 1000,
  });
  const { data: suppliers = [] } = useQuery<Record<string, any>[]>({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  // Categorie : une seule recherche sur les feuilles stockables, avec le chemin en sous-titre.
  const { byId, resolve, leavesUnder } = useStockCategories();
  const categoryOptions: SearchSelectOption[] = useMemo(() => {
    const seen = new Set<string>();
    return rootIds.filter(r => byId.has(r)).flatMap(r => leavesUnder(r)).filter(leaf => {
      const id = String(leaf.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map(leaf => {
      const path = resolve(leaf.id)?.path.split(' / ') || [];
      return {
        id: String(leaf.id),
        label: leaf.name,
        sublabel: path.slice(0, -1).join(' › '),
        detail: (byId.get(String(leaf.id)) as any)?.requires_po ? 'BC requis' : undefined,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, rootIds]);
  const consumable = !!form.categoryId && !!isConsumable?.(form.categoryId);

  const activeContainerTypes = containerTypes.filter(ct => ct.is_active !== false);
  const containerType = activeContainerTypes.find(ct => String(ct.id) === form.containerTypeId);
  const size = parseFloat(form.containerSize);
  const u = unitShort(form.unit);

  const errors = {
    name: !form.name.trim() ? 'Le nom est obligatoire.' : '',
    // Obligatoire a la creation (routage achat) ; en edition on n'interdit pas de corriger une fiche legacy non classee.
    categoryId: mode === 'create' && !form.categoryId ? 'Choisissez une catégorie.' : '',
    containerSize: !consumable && form.containerTypeId && !(size > 0) ? 'Indiquez la quantité contenue dans un contenant.' : '',
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    const payload: Record<string, any> = {
      name: form.name.trim(), unit: form.unit, unitCost: parseFloat(form.unitCost) || 0,
      supplier: form.supplier.trim() || undefined, categoryId: form.categoryId || null,
      containerTypeId: !consumable && form.containerTypeId ? form.containerTypeId : null,
      containerSize: !consumable && form.containerTypeId && size > 0 ? size : null,
      densiteKgL: form.densiteKgL !== '' ? (parseFloat(form.densiteKgL) || null) : null,
      allergens: form.allergens,
    };
    if (mode === 'edit') payload.threshold = parseFloat(form.threshold) || 0;
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="odoo-scope" style={{
        margin: 0, minHeight: 0, width: '100%', maxWidth: 640, maxHeight: 'calc(100vh - 2rem)',
        display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
      }}>
        {/* En-tete */}
        <div style={{ padding: '0.875rem 1.125rem', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f9fafb', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {mode === 'create' ? <Package size={16} style={{ color: 'var(--theme-accent)' }} /> : <Edit3 size={16} style={{ color: 'var(--theme-accent)' }} />}
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>
                {title || (mode === 'create' ? 'Nouvel ingrédient' : "Modifier l'ingrédient")}
                {isConsumable && form.categoryId && (
                  <span className={`odoo-tag ${consumable ? 'odoo-tag-purple' : 'odoo-tag-green'}`} style={{ marginLeft: 8, fontSize: '0.625rem', verticalAlign: 'middle' }}>
                    {consumable ? 'Consommable' : 'Ingrédient'}
                  </span>
                )}
              </h2>
              {mode === 'edit' && <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>{ing.name as string}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} title="Fermer (Échap)" style={{ padding: 4, color: 'var(--theme-text-muted)' }}><X size={16} /></button>
        </div>

        <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, backgroundColor: '#fff' }}>
          <div style={{ padding: '1rem 1.125rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* ── Identification ── */}
            <Section icon={<Package size={13} />} title="Identification">
              <Field label={title ? "Nom de l'article" : "Nom de l'ingrédient"} required error={err('name')}>
                <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex : Farine T55" autoFocus />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '0.75rem' }}>
                <Field label="Unité de stock">
                  <div role="radiogroup" style={{ display: 'flex', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, overflow: 'hidden' }}>
                    {UNITS.map((opt, i) => {
                      const active = form.unit === opt.value;
                      return (
                        <button key={opt.value} type="button" role="radio" aria-checked={active} title={opt.hint}
                          onClick={() => set('unit', opt.value)}
                          style={{
                            flex: 1, padding: '0.4rem 0', fontSize: '0.8125rem', fontWeight: active ? 600 : 500,
                            borderLeft: i ? '1px solid var(--theme-bg-separator)' : 'none',
                            backgroundColor: active ? 'var(--theme-accent)' : '#fff',
                            color: active ? '#fff' : 'var(--theme-text-body)',
                          }}>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Coût unitaire">
                  <Suffixed suffix={`DH / ${u}`}>
                    <input type="number" step="0.01" min="0" className="input" value={form.unitCost}
                      onChange={e => set('unitCost', e.target.value)} placeholder="0,00" />
                  </Suffixed>
                </Field>
              </div>
              {(form.unit === 'l' || form.unit === 'ml') && (
                <Field label="Masse volumique (kg/L)"
                  hint="Permet les recettes saisies au poids pour un ingrédient stocké en volume. Ex : 1,03 lait · 0,92 huile · 1 eau.">
                  <input type="number" step="0.001" min="0" className="input" value={form.densiteKgL}
                    onChange={e => set('densiteKgL', e.target.value)} placeholder="ex 1.03" style={{ maxWidth: 180 }} />
                </Field>
              )}
            </Section>

            {/* ── Classement ── */}
            <Section icon={<Tag size={13} />} title="Classement">
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem' }}>
                <Field label="Catégorie" required={mode === 'create'} error={err('categoryId')}>
                  <SearchSelect options={categoryOptions} value={form.categoryId}
                    onChange={id => set('categoryId', id)} placeholder="Rechercher : farine, beurre…" width="100%" />
                </Field>
                <Field label="Fournisseur habituel">
                  <input className="input" list="ingredient-form-suppliers" value={form.supplier}
                    onChange={e => set('supplier', e.target.value)} placeholder="Choisir ou saisir" />
                  <datalist id="ingredient-form-suppliers">
                    {suppliers.filter(s => s.is_active !== false).map(s => <option key={s.id as string} value={s.name as string} />)}
                  </datalist>
                </Field>
              </div>
              {mode === 'edit' && (
                <Field label="Seuil minimum d'alerte">
                  <Suffixed suffix={u}>
                    <input type="number" step="0.1" min="0" className="input" value={form.threshold}
                      onChange={e => set('threshold', e.target.value)} style={{ maxWidth: 180 }} />
                  </Suffixed>
                </Field>
              )}
            </Section>

            {/* ── Conditionnement ── */}
            {!consumable && <Section icon={<Boxes size={13} />} title="Conditionnement"
              aside="Comment l'ingrédient arrive du fournisseur">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <Chip active={!form.containerTypeId} onClick={() => setForm(f => ({ ...f, containerTypeId: '', containerSize: '' }))}>
                  En vrac / aucun
                </Chip>
                {activeContainerTypes.map(ct => (
                  <Chip key={ct.id as string} active={form.containerTypeId === String(ct.id)}
                    onClick={() => set('containerTypeId', String(ct.id))}>
                    {ct.label as string}
                  </Chip>
                ))}
              </div>
              {containerType && (
                <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 6, padding: '0.75rem', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <Field label={`Contenance d'un ${String(containerType.label).toLowerCase()}`} required error={err('containerSize')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Suffixed suffix={u} width={150}>
                        <input type="number" step="0.001" min="0" className="input" value={form.containerSize}
                          onChange={e => set('containerSize', e.target.value)} placeholder="ex 25" />
                      </Suffixed>
                      {(SIZE_PRESETS[form.unit] || []).map(p => (
                        <Chip key={p} small active={size === p} onClick={() => set('containerSize', String(p))}>
                          {fmt(p)} {u}
                        </Chip>
                      ))}
                    </div>
                  </Field>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                    <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    {size > 0 ? (
                      <span>
                        <strong style={{ color: 'var(--theme-text-strong)' }}>1 {String(containerType.label).toLowerCase()} = {fmt(size)} {u}</strong>
                        {' '}— commandes et transferts vers le pesage se feront par {String(containerType.label).toLowerCase()} entier
                        (ex : besoin de {fmt(size * 1.5)} {u} → 2 × {fmt(size)} {u}).
                      </span>
                    ) : (
                      <span>Indiquez combien contient un contenant pour commander et transférer par contenant entier.</span>
                    )}
                  </div>
                </div>
              )}
              {activeContainerTypes.length === 0 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                  Aucun type de contenant défini — ajoutez-en dans Paramètres › Référentiel › Types de contenant.
                </p>
              )}
            </Section>}

            {/* ── Allergenes ── */}
            {!consumable && <Section icon={<ShieldAlert size={13} />} title="Allergènes"
              aside={form.allergens.length ? `${form.allergens.length} sélectionné${form.allergens.length > 1 ? 's' : ''}` : 'Aucun'}>
              <AllergenSelector value={form.allergens} onChange={allergens => set('allergens', allergens)} />
            </Section>}
          </div>

          {/* Pied fixe : toujours visible, meme si le contenu defile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end', padding: '0.75rem 1.125rem', borderTop: '1px solid var(--theme-bg-separator)', backgroundColor: '#f9fafb', flexShrink: 0 }}>
            {submitted && hasErrors && (
              <span style={{ marginRight: 'auto', fontSize: '0.75rem', color: '#dc3545' }}>Complétez les champs signalés.</span>
            )}
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="odoo-btn-primary">
              <Save size={13} /> {isLoading ? 'Enregistrement…' : mode === 'create' ? (title ? 'Créer et ajouter' : "Créer l'ingrédient") : 'Sauvegarder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4, borderBottom: '1px solid var(--theme-bg-separator)' }}>
        <span style={{ color: 'var(--theme-accent)', display: 'flex' }}>{icon}</span>
        <h3 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-strong)' }}>{title}</h3>
        {aside && <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#dc3545' }}> *</span>}
      </label>
      {children}
      {error ? <p style={{ fontSize: '0.6875rem', color: '#dc3545', marginTop: 3 }}>{error}</p>
        : hint ? <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 3 }}>{hint}</p> : null}
    </div>
  );
}

/** Champ avec suffixe d'unite colle a droite (« DH / kg », « kg »). */
function Suffixed({ suffix, width, children }: { suffix: string; width?: number; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: width ?? '100%' }}>
      {children}
      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--theme-text-muted)', pointerEvents: 'none' }}>
        {suffix}
      </span>
    </div>
  );
}

function Chip({ active, small, onClick, children }: { active: boolean; small?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      style={{
        padding: small ? '0.2rem 0.55rem' : '0.35rem 0.8rem', borderRadius: 999,
        fontSize: small ? '0.75rem' : '0.8125rem', fontWeight: active ? 600 : 500,
        border: `1px solid ${active ? 'var(--theme-accent)' : 'var(--theme-bg-separator)'}`,
        backgroundColor: active ? 'var(--theme-accent-light, #fdf2f2)' : '#fff',
        color: active ? 'var(--theme-accent)' : 'var(--theme-text-body)',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}
