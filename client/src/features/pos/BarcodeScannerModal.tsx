// Scanner code-barres par camera (parametre local du poste).
//
// Utilise l'API BarcodeDetector (Chrome/Android — donc le webview Capacitor
// de la tablette) sur le flux camera arriere. Sur les navigateurs sans
// BarcodeDetector (Safari/Firefox), la camera n'est pas lancee et seule la
// saisie manuelle du code reste disponible.
//
// Le code scanne est matche contre products.sku par l'appelant (POSPage).
// Le modal reste ouvert apres un scan (mode rafale, cooldown 1,5 s) pour
// enchainer les articles comme sur Loyverse.
import { useEffect, useRef, useState } from 'react';
import { X, ScanLine, CheckCircle, AlertTriangle } from 'lucide-react';

type ScanFeedback = { code: string; productName: string | null } | null;

export default function BarcodeScannerModal({ onDetect, onClose }: {
  /** Retourne le nom du produit ajoute, ou null si code inconnu. */
  onDetect: (code: string) => string | null;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const detectorSupported = typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector !== 'undefined';

  // Refs pour eviter de relancer la camera a chaque render.
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const cooldownUntil = useRef(0);

  useEffect(() => {
    if (!detectorSupported) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const BD = (window as unknown as {
          BarcodeDetector: new (opts?: { formats?: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
        }).BarcodeDetector;
        const detector = new BD({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
        });

        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          if (Date.now() < cooldownUntil.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes[0]?.rawValue?.trim();
            if (raw) {
              cooldownUntil.current = Date.now() + 1500;
              const productName = onDetectRef.current(raw);
              setFeedback({ code: raw, productName });
            }
          } catch { /* frame illisible : on retente au tick suivant */ }
        }, 250);
      } catch (err) {
        if (!cancelled) {
          setCameraError(err instanceof Error && err.name === 'NotAllowedError'
            ? 'Accès caméra refusé — autorisez la caméra pour ce site.'
            : 'Caméra indisponible sur ce poste.');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [detectorSupported]);

  const submitManual = () => {
    const code = manualCode.trim();
    if (!code) return;
    const productName = onDetectRef.current(code);
    setFeedback({ code, productName });
    setManualCode('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanLine size={18} className="text-primary-600" />
            <h2 className="font-bold text-gray-800">Scanner un produit</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {detectorSupported && !cameraError ? (
          <div className="relative bg-black aspect-[4/3]">
            {/* playsInline : indispensable sur tablette pour rester dans la page */}
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-24 border-2 border-white/80 rounded-xl pointer-events-none" />
          </div>
        ) : (
          <div className="px-5 py-6 text-center bg-gray-50">
            <AlertTriangle size={22} className="mx-auto text-amber-500 mb-2" />
            <p className="text-sm text-gray-600">
              {cameraError || 'Scanner caméra non supporté par ce navigateur — saisissez le code ci-dessous.'}
            </p>
          </div>
        )}

        {feedback && (
          <div className={`mx-5 mt-3 rounded-xl py-2.5 px-3 ring-1 flex items-center gap-2 ${
            feedback.productName ? 'bg-green-50 ring-green-200' : 'bg-red-50 ring-red-200'
          }`}>
            {feedback.productName
              ? <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
              : <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />}
            <p className={`text-xs font-semibold ${feedback.productName ? 'text-green-700' : 'text-red-600'}`}>
              {feedback.productName
                ? `Ajouté : ${feedback.productName}`
                : `Code inconnu : ${feedback.code} (aucun produit avec ce SKU)`}
            </p>
          </div>
        )}

        {/* Saisie manuelle : toujours disponible (douchette USB en mode clavier, ou code illisible) */}
        <div className="px-5 py-4 flex items-center gap-2">
          <input type="text" inputMode="numeric" value={manualCode}
            placeholder="Ou saisir le code-barres / SKU"
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }}
            autoFocus={!detectorSupported}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
          />
          <button onClick={submitManual} disabled={!manualCode.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
