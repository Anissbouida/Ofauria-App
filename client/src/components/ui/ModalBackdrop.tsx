import { useRef, type ReactNode, type CSSProperties } from 'react';

/**
 * Backdrop de modal qui se ferme au clic — mais ignore les drags qui commencent
 * dans le panneau interne. Sans ce garde-fou, sélectionner du texte dans un champ
 * et relâcher hors du panneau fermerait le modal.
 *
 * Pattern : on n'appelle onClose que si mousedown ET click ont eu lieu sur le backdrop.
 */
export default function ModalBackdrop({
  children, onClose, className, style,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const mouseDownOnBackdrop = useRef(false);

  return (
    <div
      className={className}
      style={style}
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownOnBackdrop.current) onClose();
      }}
    >
      {children}
    </div>
  );
}
