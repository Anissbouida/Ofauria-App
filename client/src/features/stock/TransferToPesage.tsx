import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageOpen, Check, X, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ingredientLotsApi, ingredientsApi } from '../../api/inventory.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { smartFormatQuantity } from '../../utils/units';
import { containerOf } from '../../utils/container';

type Row = Record<string, any>;

/**
 * Transfert à l'avance économat -> pesage, depuis le poste de pesée.
 * Le magasinier prépare le pesage (le matin, ou avant une grosse production) sans
 * attendre un bon : il choisit l'ingrédient, le lot (FEFO par défaut, périmés
 * exclus), la quantité ou le nombre de contenants, ou « Tout le lot ». Les bons du
 * jour trouveront ensuite le stock « À peser ». Même trace que l'ouverture faite
 * au moment de la pesée (mouvement de zone, nombre de contenants).
 */
export function TransferToPesage({ onDone, initialIngredientId }: { onDone?: () => void; initialIngredientId?: string | null }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [ingredientId, setIngredientId] = useState<string | null>(initialIngredientId ?? null);
  useEffect(() => { if (initialIngredientId) { setIngredientId(initialIngredientId); setLotId(null); } }, [initialIngredientId]);
  const [lotId, setLotId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [containers, setContainers] = useState('');
  // Reste entame d'un lot (moins d'un contenant) : transfert en entier, explicite.
  const [wholeLot, setWholeLot] = useState(false);

  const { data: ingredients = [] } = useQuery<Row[]>({ queryKey: ['ingredients'], queryFn: ingredientsApi.list, staleTime: 60000 });
  const ingredient = ingredients.find(i => i.id === ingredientId) || null;
  const unit = (ingredient?.unit as string) || 'kg';
  // Regle « contenant entier » : si l'ingredient a un contenant defini, on ne saisit
  // que des contenants (arrondi au superieur, dernier contenant entame = tout le reste).
  const container = containerOf(ingredient);
  const containerSize = container ? container.size : 0;
  // Minimum un contenant : le champ est pre-rempli a 1 des qu'un ingredient a
  // contenant est choisi (pas de champ vide a completer avant de pouvoir valider).
  useEffect(() => {
    setContainers(containerSize > 0 ? '1' : '');
    setQty('');
    setWholeLot(false);
  }, [ingredientId, containerSize, lotId]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [] as Row[];
    return ingredients.filter(i => String(i.name || '').toLowerCase().includes(q)).slice(0, 8);
  }, [search, ingredients]);

  const { data: lotsResp, isLoading: lotsLoading } = useQuery<{ data: Row[] }>({
    queryKey: ['ingredient-lots', 'economat', ingredientId],
    queryFn: () => ingredientLotsApi.list({ ingredientId: ingredientId as string, status: 'active', limit: '100' }),
    enabled: !!ingredientId,
  });
  const today = new Date().toISOString().slice(0, 10);
  const lots: Row[] = ((lotsResp?.data || []) as Row[])
    .filter(l => parseFloat(l.economat_quantity as string || '0') > 0)
    .map((l): Row => ({ ...l, _expired: !!l.expiration_date && String(l.expiration_date).slice(0, 10) < today }))
    .sort((a, b) => Number(a._expired) - Number(b._expired) || String(a.expiration_date || '9999').localeCompare(String(b.expiration_date || '9999')));
  const lot = lots.find(l => l.id === lotId) || lots.find(l => !l._expired) || null;
  const eco = lot ? parseFloat(lot.economat_quantity as string || '0') : 0;

  const fmt = (q: number) => { const f = smartFormatQuantity(q, unit); return `${f.value.toFixed(f.unit === 'g' || f.unit === 'ml' ? 0 : 2)} ${f.unit}`; };
  const parsedContainers = containers.trim() !== '' && Number(containers) > 0 ? Math.floor(Number(containers)) : null;
  // Regle stricte : N contenants = N x taille. Si le lot n'en a pas assez, le champ
  // est en erreur (pas de plafonnement silencieux). « Tout le lot » transfere le
  // reste exact d'un lot entame.
  const parsedQty = containerSize > 0
    ? (wholeLot ? eco : parsedContainers !== null ? parsedContainers * containerSize : NaN)
    : parseFloat(qty.replace(',', '.'));
  const qtyOk = Number.isFinite(parsedQty) && parsedQty > 0 && parsedQty <= eco + 1e-9;
  const fullContainersInLot = containerSize > 0 ? Math.floor(eco / containerSize + 1e-9) : 0;
  const lotRemainder = containerSize > 0 ? eco - fullContainersInLot * containerSize : 0;

  const mutation = useMutation({
    mutationFn: () => ingredientLotsApi.openToPesage(lot!.id as string, {
      quantity: parsedQty,
      containerCount: containerSize > 0 && !wholeLot ? (parsedContainers ?? undefined) : undefined,
    }),
    onSuccess: (data: Row) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-pesage-stock'] });
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots'] });
      queryClient.invalidateQueries({ queryKey: ['bons-sortie'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-requests'] });
      notify.success(`${fmt(parseFloat(data.opened_quantity))} ${data.ingredient_name} mis au pesage${data.lot_number ? ` (lot ${data.lot_number})` : ''}`);
      setQty(''); setContainers(containerSize > 0 ? '1' : ''); setLotId(null); setWholeLot(false);
      onDone?.();
    },
    onError: (e: unknown) => notify.error(apiErrorMessage(e, 'Erreur')),
  });

  return (
    <div className="odoo-section" style={{ margin: 0 }}>
      <div className="odoo-section-header"><PackageOpen size={12} /> Ingrédient, lot et quantité à ouvrir</div>
      <div className="transfer-pesage-form">
        {/* 1. Ingrédient */}
        <div className="transfer-pesage-field" style={{ position: 'relative', minWidth: 260 }}>
          <label>Ingrédient</label>
          {ingredient ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong>{ingredient.name as string}</strong>
              <button type="button" className="odoo-btn-secondary" onClick={() => { setIngredientId(null); setLotId(null); setSearch(''); }} title="Changer d'ingrédient"><X size={12} /></button>
            </div>
          ) : (
            <>
              <div className="odoo-search-panel" style={{ margin: 0 }}>
                <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un ingrédient…" className="odoo-search-input" autoFocus />
              </div>
              {matches.length > 0 && (
                <ul className="transfer-pesage-matches">
                  {matches.map(m => (
                    <li key={m.id as string}>
                      <button type="button" onClick={() => { setIngredientId(m.id as string); setSearch(''); }}>
                        {m.name as string} <span className="bsi-unit">{m.unit as string}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* 2. Lot (FEFO) */}
        {ingredient && (
          <div className="transfer-pesage-field" style={{ minWidth: 300 }}>
            <label>Lot en économat (FEFO)</label>
            {lotsLoading ? <Loader2 size={14} className="animate-spin" />
              : lots.length === 0 ? <span className="bsi-muted">Rien en économat pour cet ingrédient.</span>
              : (
                <select value={lot?.id as string || ''} onChange={(e) => setLotId(e.target.value)} className="bsi-lot-select" style={{ maxWidth: 'none' }}>
                  {lots.map(l => (
                    <option key={l.id as string} value={l.id as string} disabled={!!l._expired}>
                      {((l.supplier_lot_number || l.lot_number) as string | null) || 'lot sans n°'} · DLC {l.expiration_date ? format(new Date(l.expiration_date as string), 'dd/MM/yy') : '—'} · économat {fmt(parseFloat(l.economat_quantity as string))}{l._expired ? ' · PÉRIMÉ' : ''}
                    </option>
                  ))}
                </select>
              )}
          </div>
        )}

        {/* 3. Quantité */}
        {ingredient && lot && (
          <div className="transfer-pesage-field">
            <label>Quantité mise au pesage</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
              {containerSize > 0 ? (
                <>
                  {wholeLot ? (
                    <span className="bsi-unit">Tout le lot : <strong>{fmt(eco)}</strong> (fond de contenant, moins d'un {container!.label.toLowerCase()})
                      <button type="button" className="bsi-link-btn" style={{ marginLeft: 6 }} onClick={() => setWholeLot(false)}>par contenants</button>
                    </span>
                  ) : (
                    <label className="bsi-containers" title={`${container!.label} de ${fmt(containerSize)} — transfert par contenant entier`}>
                      <input type="text" inputMode="numeric" value={containers} onChange={(e) => setContainers(e.target.value.replace(/[^0-9]/g, ''))}
                        className={`bsi-weigh-input bsi-containers-input ${containers && !qtyOk ? 'is-out' : qtyOk ? 'is-ok' : ''}`} placeholder="1" />
                      <span className="bsi-unit">× {container!.label} de {fmt(containerSize)}{parsedContainers !== null ? <> = <strong>{fmt(parsedContainers * containerSize)}</strong></> : null}</span>
                    </label>
                  )}
                  {fullContainersInLot > 0 && !wholeLot && (
                    <button type="button" className="bsi-link-btn" onClick={() => setContainers(String(fullContainersInLot))} title="Tous les contenants entiers du lot">
                      Tous les {fullContainersInLot} {container!.label.toLowerCase()}{fullContainersInLot > 1 ? 's' : ''} ({fmt(fullContainersInLot * containerSize)})
                    </button>
                  )}
                  {lotRemainder > 1e-9 && !wholeLot && (
                    <button type="button" className="bsi-link-btn" onClick={() => setWholeLot(true)} title="Le lot contient un reste inférieur à un contenant : il se transfère en entier">
                      Tout le lot ({fmt(eco)})
                    </button>
                  )}
                </>
              ) : (
                <>
                  <input type="text" inputMode="decimal" value={qty}
                    onChange={(e) => setQty(e.target.value.replace(/[^0-9.,]/g, ''))}
                    className={`bsi-weigh-input ${qty && !qtyOk ? 'is-out' : qtyOk ? 'is-ok' : ''}`} placeholder={String(eco)} />
                  <span className="bsi-unit">{unit}</span>
                  <button type="button" className="bsi-link-btn" onClick={() => setQty(String(eco))} title="Tout ce que le lot a en économat">
                    Tout le lot ({fmt(eco)})
                  </button>
                </>
              )}
              <button type="button" className="odoo-btn-primary" disabled={!qtyOk || mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Mettre au pesage
              </button>
            </div>
            {containerSize > 0 && !wholeLot && parsedContainers !== null && !qtyOk && (
              <div style={{ fontSize: '0.75rem', color: '#a94442', marginTop: 2 }}>
                Le lot n'a que {fmt(eco)} en économat ({fullContainersInLot} {container!.label.toLowerCase()}{fullContainersInLot > 1 ? 's' : ''} entier{fullContainersInLot > 1 ? 's' : ''}{lotRemainder > 1e-9 ? ` + ${fmt(lotRemainder)}` : ''}).
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
