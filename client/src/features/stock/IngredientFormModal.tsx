import { useEffect, useMemo, useRef, useState } from 'react';
import ItemConversionsPanel from '../../components/ItemConversionsPanel';
import { useQuery } from '@tanstack/react-query';
import { Package, Edit3, X, Save, Tag, Boxes, ShieldAlert, Info } from 'lucide-react';
import { suppliersApi } from '../../api/accounting.api';
import { referentielApi } from '../../api/referentiel.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useExtraUnits } from '../../hooks/useReferentiel';
import { AllergenSelector } from '../../components/ui/AllergenSelector';
import SearchSelect, { type SearchSelectOption } from '../../components/ui/SearchSelect';
import { useStockCategories, STOCKABLE_ROOT_IDS } from './useStockCategories';
import CustomFieldsEditor from '../../components/custom-fields/CustomFieldsEditor';
import { useCustomFieldsForm } from '../../api/custom-fields.api';
import { notify } from '../../components/ui/InlineNotification';
import { currencySymbol } from '../../utils/money';
import { FormField, FormFooter, FormSection, Modal } from '../../components/ds';
import PurchaseTaxCodeSelect from '../../components/purchasing/PurchaseTaxCodeSelect';
import { useProdTerms } from '../../hooks/useProdTerms';

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
  /**
   * Vrai s'il reste des lots en stock : le coût unitaire est alors le prix du lot en cours
   * d'utilisation (mig 653), pas une saisie. Le champ passe en lecture seule.
   */
  costFromLots?: boolean;
}

export default function IngredientFormModal({ mode, ingredient, threshold, onClose, onSave, isLoading, title, initialName, initialSupplier, rootIds = STOCKABLE_ROOT_IDS, isConsumable, costFromLots = false }: Props) {
  const ing = ingredient || {};
  const { ingredient: ingTerm, ingredientLc: ingTermLc } = useProdTerms();
  // Allergènes : seulement si la capacité réglementaire est active pour le secteur.
  const { hasFeature } = usePermissions();
  const showAllergens = hasFeature('allergenes');
  const extraUnits = useExtraUnits(UNITS.map(u => u.value));
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
    poidsPieceKg: ing.poids_piece_kg != null ? String(ing.poids_piece_kg) : '',
    nonStocke: ing.non_stocke === true,
    defaultTaxCode: (ing.default_tax_code as string) || '',
    allergens: (Array.isArray(ing.allergens) ? ing.allergens : []) as string[],
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  // Échap et clic extérieur : gérés par la fenêtre commune (Modal).
  const formRef = useRef<HTMLFormElement>(null);

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
  // Champs personnalisés (mig 369) : ceux des matières, ou des consommables selon la catégorie.
  const cfEntity = consumable ? 'packaging_item' as const : 'ingredient' as const;
  const cf = useCustomFieldsForm(cfEntity, (ing as Record<string, unknown>).custom_fields);

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
      poidsPieceKg: form.poidsPieceKg !== '' ? (parseFloat(form.poidsPieceKg) || null) : null,
      nonStocke: !consumable && form.nonStocke,
      // TVA à l'achat (constat 124) : vide = hériter de la catégorie.
      defaultTaxCode: form.defaultTaxCode || null,
      allergens: form.allergens,
    };
    if (mode === 'edit') payload.threshold = parseFloat(form.threshold) || 0;
    // Coût tenu par les lots en stock : jamais envoyé (le serveur l'ignorerait de toute façon).
    if (costFromLots) delete payload.unitCost;
    const cfMissing = cf.missing();
    if (cfMissing.length) { notify.error(`À renseigner : ${cfMissing.join(', ')}`); return; }
    // Enregistrés par ingredientsApi après la fiche (id connu).
    if (cf.defs.length) { payload.__cf = cf.values; payload.__cfEntity = cfEntity; }
    onSave(payload);
  };

  return (
    <Modal
      title={title || (mode === 'create' ? `Nouvelle fiche ${ingTermLc}` : `Modifier la fiche ${ingTermLc}`)}
      subtitle={mode === 'edit' ? (ing.name as string) : undefined}
      aside={isConsumable && form.categoryId ? (
        <span className={`odoo-tag ${consumable ? 'odoo-tag-purple' : 'odoo-tag-green'}`} style={{ fontSize: '11px' }}>
          {consumable ? 'Consommable' : ingTerm}
        </span>
      ) : undefined}
      onClose={onClose} locked={isLoading} width={640}
      footer={
        <FormFooter onCancel={onClose} busy={isLoading} onSubmit={() => formRef.current?.requestSubmit()}
          submitLabel={isLoading ? 'Enregistrement…' : mode === 'create' ? (title ? 'Créer et ajouter' : 'Créer la fiche') : 'Enregistrer'}>
          {submitted && hasErrors && (
            <span role="alert" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-danger)' }}>Complétez les champs signalés.</span>
          )}
        </FormFooter>
      }>
        <form ref={formRef} onSubmit={submit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* ── Identification ── */}
            <Section icon={<Package size={13} />} title="Identification">
              <Field label={title ? "Nom de l'article" : `Nom (${ingTermLc})`} required error={err('name')}>
                <input className="ds-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex : article acheté" autoFocus />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '0.75rem' }}>
                <Field label="Unité de stock">
                  <div role="radiogroup" style={{ display: 'flex', border: '1px solid var(--ds-sep)', borderRadius: 4, overflow: 'hidden' }}>
                    {UNITS.map((opt, i) => {
                      const active = form.unit === opt.value;
                      return (
                        <button key={opt.value} type="button" role="radio" aria-checked={active} title={opt.hint}
                          onClick={() => set('unit', opt.value)}
                          style={{
                            flex: 1, padding: '0.4rem 0', fontSize: '13px', fontWeight: active ? 600 : 500,
                            borderLeft: i ? '1px solid var(--ds-sep)' : 'none',
                            backgroundColor: active ? 'var(--ds-accent)' : 'var(--ds-card)',
                            color: active ? '#fff' : 'var(--ds-body)',
                          }}>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Unités ajoutées au référentiel (mètre, m²…, mig 515). */}
                  {extraUnits.length > 0 && (
                    <select className="ds-input" style={{ marginTop: 6 }} aria-label="Autre unité de stock"
                      value={UNITS.some(u => u.value === form.unit) ? '' : form.unit}
                      onChange={e => e.target.value && set('unit', e.target.value)}>
                      <option value="">Autre unité…</option>
                      {extraUnits.map(u => <option key={u.code} value={u.code}>{u.label} ({u.code})</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Coût unitaire"
                  hint={costFromLots
                    ? 'Prix du lot en cours d\'utilisation (contenant ouvert, sinon DLC la plus proche) : c\'est le prix payé pour la matière qu\'on consomme. Il change seul quand ce lot s\'épuise. Pour corriger le prix d\'un lot, passez par « Corrections de prix ».'
                    : 'Prix prévisionnel tant que l\'article n\'a aucun lot en stock ; la première réception le remplacera par le prix du lot reçu.'}>
                  <Suffixed suffix={`${currencySymbol()} / ${u}`}>
                    <input type="number" step="0.01" min="0" className="ds-input" value={form.unitCost}
                      readOnly={costFromLots} aria-readonly={costFromLots}
                      onChange={e => set('unitCost', e.target.value)} placeholder="0,00" />
                  </Suffixed>
                </Field>
              </div>
              {(form.unit === 'l' || form.unit === 'ml') && (
                <Field label="Masse volumique (kg/L)"
                  hint="Permet les recettes saisies au poids pour un article stocké en volume. Ex : 1,03 lait · 0,92 huile · 1 eau.">
                  <input type="number" step="0.001" min="0" className="ds-input" value={form.densiteKgL}
                    onChange={e => set('densiteKgL', e.target.value)} placeholder="ex 1.03" style={{ maxWidth: 180 }} />
                </Field>
              )}
              {form.unit === 'unit' && (
                <Field label="Poids d'une pièce (kg)"
                  hint="Permet de répartir les frais d'approche au poids pour un article compté à la pièce. Ex : 0,25 pour une pièce de 250 g.">
                  <input type="number" step="0.0001" min="0" className="ds-input" value={form.poidsPieceKg}
                    onChange={e => set('poidsPieceKg', e.target.value)} placeholder="ex 0.25" style={{ maxWidth: 180 }} />
                </Field>
              )}
              {!consumable && (
                <Field label="Matière non stockée"
                  hint="Eau du réseau, par exemple : pas de stock, pas de bon de sortie ni de commande. Elle reste dans les fiches techniques.">
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={form.nonStocke} onChange={e => set('nonStocke', e.target.checked)} />
                    Ne pas gérer de stock pour cette matière
                  </label>
                </Field>
              )}
              {mode === 'edit' && ing.id && <ItemConversionsPanel kind="ingredient" itemId={ing.id as string} />}
            </Section>

            {/* ── Classement ── */}
            <Section icon={<Tag size={13} />} title="Classement">
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem' }}>
                <Field label="Catégorie" required={mode === 'create'} error={err('categoryId')}>
                  <SearchSelect options={categoryOptions} value={form.categoryId}
                    onChange={id => set('categoryId', id)} placeholder="Rechercher une catégorie…" width="100%" />
                </Field>
                <Field label="Fournisseur habituel">
                  <input className="ds-input" list="ingredient-form-suppliers" value={form.supplier}
                    onChange={e => set('supplier', e.target.value)} placeholder="Choisir ou saisir" />
                  <datalist id="ingredient-form-suppliers">
                    {suppliers.filter(s => s.is_active !== false).map(s => <option key={s.id as string} value={s.name as string} />)}
                  </datalist>
                </Field>
              </div>
              <Field label="TVA à l'achat"
                hint="Proposée sur les lignes de bon de commande et reprise sur la facture. Sans code, la TVA de la catégorie s'applique.">
                <PurchaseTaxCodeSelect value={form.defaultTaxCode} onChange={code => set('defaultTaxCode', code)}
                  emptyLabel="Hériter de la catégorie" />
              </Field>
              {mode === 'edit' && (
                <Field label="Seuil minimum d'alerte">
                  <Suffixed suffix={u}>
                    <input type="number" step="0.1" min="0" className="ds-input" value={form.threshold}
                      onChange={e => set('threshold', e.target.value)} style={{ maxWidth: 180 }} />
                  </Suffixed>
                </Field>
              )}
            </Section>

            {/* ── Conditionnement ── */}
            {!consumable && <Section icon={<Boxes size={13} />} title="Conditionnement"
              aside="Comment l'article arrive du fournisseur">
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
                <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 6, padding: '0.75rem', backgroundColor: 'var(--ds-bg)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <Field label={`Contenance d'un ${String(containerType.label).toLowerCase()}`} required error={err('containerSize')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Suffixed suffix={u} width={150}>
                        <input type="number" step="0.001" min="0" className="ds-input" value={form.containerSize}
                          onChange={e => set('containerSize', e.target.value)} placeholder="ex 25" />
                      </Suffixed>
                      {(SIZE_PRESETS[form.unit] || []).map(p => (
                        <Chip key={p} small active={size === p} onClick={() => set('containerSize', String(p))}>
                          {fmt(p)} {u}
                        </Chip>
                      ))}
                    </div>
                  </Field>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '12px', color: 'var(--ds-muted)' }}>
                    <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    {size > 0 ? (
                      <span>
                        <strong style={{ color: 'var(--ds-ink)' }}>1 {String(containerType.label).toLowerCase()} = {fmt(size)} {u}</strong>
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
                <p style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>
                  Aucun type de contenant défini — ajoutez-en dans Paramètres › Référentiel › Types de contenant.
                </p>
              )}
            </Section>}

            {/* ── Allergenes ── */}
            {!consumable && showAllergens && <Section icon={<ShieldAlert size={13} />} title="Allergènes"
              aside={form.allergens.length ? `${form.allergens.length} sélectionné${form.allergens.length > 1 ? 's' : ''}` : 'Aucun'}>
              <AllergenSelector value={form.allergens} onChange={allergens => set('allergens', allergens)} />
            </Section>}
            <CustomFieldsEditor entity={cfEntity} values={cf.values} onChange={cf.setValues} />
          </div>

        </form>
    </Modal>
  );
}

/** Section du formulaire : délègue à `FormSection` du Design System (icône et complément dans le titre). */
function Section({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <FormSection title={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: 'var(--ds-accent)', display: 'flex' }} aria-hidden="true">{icon}</span>{title}
      {aside && <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400, color: 'var(--ds-muted)' }}>{aside}</span>}
    </span>}>
      {children}
    </FormSection>
  );
}

/** Champ du formulaire : délègue à `FormField` (astérisque, aide ou erreur sous le champ). */
function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return <FormField label={label} required={required} error={error} hint={hint}>{children}</FormField>;
}

/** Champ avec suffixe d'unite colle a droite (« DH / kg », « kg »). */
function Suffixed({ suffix, width, children }: { suffix: string; width?: number; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: width ?? '100%' }}>
      {children}
      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--ds-muted)', pointerEvents: 'none' }}>
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
        border: `1px solid ${active ? 'var(--ds-accent)' : 'var(--ds-sep)'}`,
        backgroundColor: active ? 'var(--ds-tint, var(--ds-tint))' : 'var(--ds-card)',
        color: active ? 'var(--ds-accent)' : 'var(--ds-body)',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}
