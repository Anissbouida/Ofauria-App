import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Pages de détail du module Achats, ouvertes par l'URL (lien partageable, bouton Précédent) :
 *   ?tab=reception&po=<id>   réception d'un bon de commande
 *   ?tab=rfq&rfq=<id>        demande de prix (fiche + comparatif)
 * `from` retient la rubrique d'origine pour y revenir (Annuler, après validation).
 */
export const DETAIL_PARAMS = ['po', 'rfq', 'from'] as const;

function useOpenDetail(tab: string, key: 'po' | 'rfq') {
  const [params, setParams] = useSearchParams();
  return useCallback((id: string) => {
    const next = new URLSearchParams(params);
    const from = params.get('tab');
    if (from && from !== tab) next.set('from', from); else next.delete('from');
    DETAIL_PARAMS.forEach(k => { if (k !== 'from') next.delete(k); });
    next.set('tab', tab);
    next.set(key, id);
    setParams(next);
  }, [params, setParams, tab, key]);
}

/** Ouvre la page « Réception · n° du BC » (Achats › Réceptions). */
export function useOpenReception() {
  return useOpenDetail('reception', 'po');
}

/** Ouvre la page d'une demande de prix (Achats › Demandes de prix). */
export function useOpenRfq() {
  return useOpenDetail('rfq', 'rfq');
}
