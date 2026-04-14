import { useEffect, useRef } from 'react';
import { X, Printer } from 'lucide-react';

interface PrintOverlayProps {
  html: string;
  onClose: () => void;
}

/**
 * Affiche du contenu HTML imprimable dans une modale plein écran.
 * Compatible web et mobile (Capacitor).
 * - Bouton Retour pour fermer
 * - Bouton Imprimer (masqué sur mobile si pas d'imprimante)
 */
export default function PrintOverlay({ html, onClose }: PrintOverlayProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  const handlePrint = () => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b shadow-sm shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
        >
          <X size={18} />
          Retour
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium text-white transition-colors"
        >
          <Printer size={18} />
          Imprimer
        </button>
      </div>
      {/* Content */}
      <iframe
        ref={iframeRef}
        className="flex-1 w-full bg-white"
        title="Apercu impression"
      />
    </div>
  );
}
