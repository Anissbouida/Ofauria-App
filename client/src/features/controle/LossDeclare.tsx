import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, X, Trash2, Croissant, Wheat, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { ingredientLotsApi } from '../../api/inventory.api';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { ProductLossDeclareModal } from '../accounting/LossesTab';
import { LotMovementModal, type LotMovementLot } from '../stock/LotMovementModal';

/**
 * Déclaration UNIQUE d'une perte depuis Contrôle & Qualité : on choisit d'abord ce
 * qui est perdu (produit fini ou matière première), puis le formulaire habituel de
 * chaque flux — mêmes règles et mêmes écritures que depuis la Comptabilité ou le
 * Stock. Les motifs viennent des référentiels (loss_reasons, production_loss_reasons,
 * material_loss_reasons), éditables dans Paramètres.
 */

type LotRow = {
  id: string; lot_number: string | null; supplier_lot_number: string | null; ingredient_name: string; ingredient_unit: string;
  economat_quantity: string; pesage_quantity: string; unit_cost: string | null; expiration_date: string | null; expiration_status: string;
};

export default function LossDeclare({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'produit' | 'matiere' | null>(null);
  const [lot, setLot] = useState<LotMovementLot | null>(null);

  const refresh = () => {
    for (const k of ['controle-losses', 'controle-losses-summary', 'controle-overview', 'product-losses']) {
      queryClient.invalidateQueries({ queryKey: [k] });
    }
  };

  if (kind === 'produit') {
    return <ProductLossDeclareModal onClose={onClose} onSuccess={() => { refresh(); onClose(); }} />;
  }
  if (lot) {
    return <LotMovementModal lot={lot} initialType={lot.pesage_quantity > 0 ? 'waste' : 'losses'} only={['waste', 'losses']} onClose={onClose} onDone={refresh} />;
  }

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" aria-label="Déclarer une perte" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Trash2 size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Pertes</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{kind === 'matiere' ? 'Matière première' : 'Déclarer une perte'}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        {kind === 'matiere'
          ? <LotPicker onBack={() => setKind(null)} onPick={setLot} />
          : (
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <KindCard icon={Croissant} title="Produit fini" onClick={() => setKind('produit')}
                text="Raté ou brûlé en production, abîmé en vitrine, périmé, recyclé. Valorisé au coût de la fiche technique." />
              <KindCard icon={Wheat} title="Matière première" onClick={() => setKind('matiere')}
                text="Casse, contamination, fond de contenant, DLC dépassée, lot non conforme. Valorisé au prix d'achat du lot." />
            </div>
          )}
      </div>
    </ModalBackdrop>
  );
}

function KindCard({ icon: Icon, title, text, onClick }: { icon: typeof Trash2; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ textAlign: 'left', padding: '14px 14px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--theme-bg-card)', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--theme-accent)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--odoo-border)'; }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.875rem', color: 'var(--odoo-text)' }}>
        <Icon size={16} style={{ color: 'var(--theme-accent)' }} /> {title}
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', lineHeight: 1.45 }}>{text}</span>
    </button>
  );
}

/** Choix du lot concerné : seuls les lots actifs avec du stock (réserve ou pesage). */
function LotPicker({ onBack, onPick }: { onBack: () => void; onPick: (lot: LotMovementLot) => void }) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['loss-declare-lots', search],
    queryFn: () => ingredientLotsApi.list({ status: 'active', limit: '40', ...(search ? { search } : {}) }),
    placeholderData: prev => prev,
  });
  const lots = ((data?.data ?? []) as LotRow[])
    .filter(l => Number(l.economat_quantity) + Number(l.pesage_quantity) > 0.0005);
  const n = (v: string | null) => (v == null ? 0 : Number(v));
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" value={input} onChange={e => setInput(e.target.value)} autoFocus aria-label="Rechercher un ingrédient"
          placeholder="Ingrédient, n° de lot fournisseur, fournisseur..." className="odoo-search-input" style={{ flex: 1, minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
      </div>
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>
      ) : lots.length === 0 ? (
        <p style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucun lot en stock pour cette recherche.</p>
      ) : (
        <table className="odoo-table">
          <thead>
            <tr><th>Ingrédient · lot</th><th>DLC</th><th style={{ textAlign: 'right' }}>Réserve</th><th style={{ textAlign: 'right' }}>Pesage</th><th /></tr>
          </thead>
          <tbody>
            {lots.map(l => {
              const expired = l.expiration_status === 'expired';
              return (
                <tr key={l.id}>
                  <td>
                    <span style={{ fontWeight: 500 }}>{l.ingredient_name}</span>
                    {(l.lot_number || l.supplier_lot_number) && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontFamily: 'ui-monospace, monospace' }}>{l.lot_number ?? l.supplier_lot_number}</div>}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: expired ? '#b71c1c' : 'var(--theme-text-muted)', fontWeight: expired ? 600 : 400, whiteSpace: 'nowrap' }}>
                    {expired && <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 3 }} />}
                    {l.expiration_date ? format(new Date(l.expiration_date), 'dd/MM/yyyy') : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{fmt(n(l.economat_quantity))} {l.ingredient_unit}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{fmt(n(l.pesage_quantity))} {l.ingredient_unit}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="odoo-btn-secondary" onClick={() => onPick({
                      id: l.id, lot_number: l.lot_number ?? l.supplier_lot_number, ingredient_name: l.ingredient_name, unit: l.ingredient_unit,
                      economat_quantity: n(l.economat_quantity), pesage_quantity: n(l.pesage_quantity),
                      unit_cost: l.unit_cost != null ? n(l.unit_cost) : null, is_expired: expired,
                    })}>Choisir</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', margin: 0 }}>
        Une perte partielle se prend sur la quantité au pesage (contenant ouvert) ; un contenant encore scellé part en entier aux pertes.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <button type="button" className="odoo-btn-secondary" onClick={onBack}>Retour</button>
      </div>
    </div>
  );
}
