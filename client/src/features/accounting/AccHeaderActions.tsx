import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Emplacement des actions de l'écran actif dans la barre « Comptabilité › Rubrique › Page »
 * (AccountingPage), comme PurHeaderActions côté Achats : chaque écran y pose ses exports
 * (secondaires) puis son unique action principale, en haut à droite (Design System, gabarit de page).
 */
export const AccHeaderSlot = createContext<HTMLElement | null>(null);

export function AccHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(AccHeaderSlot);
  // Hors du module Comptabilité (aucun emplacement) : les boutons restent à leur place dans la page.
  return slot ? createPortal(children, slot) : <>{children}</>;
}
