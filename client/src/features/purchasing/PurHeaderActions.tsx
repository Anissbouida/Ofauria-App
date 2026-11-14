import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Emplacement des boutons de l'écran actif dans l'en-tête « Achats / rubrique » (PurchasingPage),
 * comme les actions de SalesPageShell côté Ventes : chaque rubrique y pose son bouton principal.
 */
export const PurHeaderSlot = createContext<HTMLElement | null>(null);

export function PurHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(PurHeaderSlot);
  // Hors du module Achats (aucun emplacement) : les boutons restent à leur place dans la page.
  return slot ? createPortal(children, slot) : <>{children}</>;
}
