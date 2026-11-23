import { useQuery } from '@tanstack/react-query';
import { invoicesApi } from '../../api/accounting.api';

type TaxCode = { code: string; label: string; rate: string | number };

/**
 * Choix de la TVA à l'achat par défaut (mig 309, constat 124) : code du référentiel
 * tax_codes en vigueur (N20, R10, EXO_SDD, HC…). Sert sur la fiche ingrédient, la fiche
 * consommable et la catégorie de charges ; le taux est proposé sur les lignes de bon de
 * commande puis repris sur la facture issue de la réception.
 * Valeur vide = pas de code (l'article hérite de sa catégorie, la catégorie laisse le
 * taux à préciser). Un code qui n'est plus en vigueur reste affiché, signalé comme tel.
 */
export default function PurchaseTaxCodeSelect({ id, value, onChange, emptyLabel }: {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  /** Libellé de l'option vide (« Hériter de la catégorie », « Aucun »…). */
  emptyLabel: string;
}) {
  const { data = [] } = useQuery<TaxCode[]>({
    queryKey: ['tax-codes'],
    queryFn: () => invoicesApi.taxCodes(),
    staleTime: 5 * 60 * 1000,
  });
  const codes = data as TaxCode[];
  const label = (t: TaxCode) => (String(t.label).includes('%') ? t.label : `${t.label} (${Number(t.rate)} %)`);
  const stale = !!value && !codes.some(t => t.code === value);
  return (
    <select id={id} className="ds-input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {codes.map(t => <option key={t.code} value={t.code}>{label(t)}</option>)}
      {stale && <option value={value}>{value} (plus en vigueur)</option>}
    </select>
  );
}
