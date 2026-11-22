import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck } from 'lucide-react';
import api from '../../api/client';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Activation de la double authentification (G6-01) : QR code à scanner dans l'application
 * d'authentification (Google Authenticator, Microsoft Authenticator…), confirmation par un
 * code, puis affichage UNIQUE des codes de secours. Utilisé en écran imposé quand le rôle
 * exige la double authentification.
 */
export default function MfaSetup({ onDone, forced = false }: { onDone: () => void; forced?: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.post('/auth/mfa/setup', {}).then(r => setSetup(r.data.data)).catch(e => notify.error(apiErrorMessage(e)));
  }, []);
  useEffect(() => { if (setup) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then(setQr).catch(() => setQr('')); }, [setup]);

  const enable = async () => {
    setBusy(true);
    try { setBackup((await api.post('/auth/mfa/enable', { code })).data.data.backupCodes); }
    catch (e) { notify.error(apiErrorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--ds-bg)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-md p-8" style={{ backgroundColor: 'var(--ds-card)', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '1.1rem' }}><ShieldCheck size={20} /> Double authentification</div>
        {forced && !backup && <p className="text-sm text-gray-600">Votre rôle exige un second facteur. Activez-le pour continuer.</p>}
        {!backup ? (
          <>
            <ol className="text-sm text-gray-700" style={{ display: 'grid', gap: 6, paddingLeft: 18, listStyle: 'decimal' }}>
              <li>Ouvrez votre application d'authentification et scannez ce code.</li>
              <li>Saisissez le code à 6 chiffres qu'elle affiche.</li>
            </ol>
            {qr ? <img src={qr} alt="QR code de la double authentification" style={{ width: 200, height: 200, justifySelf: 'center' }} /> : <span className="text-sm text-gray-500">Préparation…</span>}
            {setup && <div className="text-xs text-gray-500" style={{ textAlign: 'center' }}>Ou saisissez la clé : <code style={{ userSelect: 'all' }}>{setup.secret}</code></div>}
            <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" aria-label="Code à 6 chiffres"
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) enable(); }} />
            <button type="button" className="btn-primary w-full py-3" disabled={code.length !== 6 || busy || !setup} onClick={enable}>Activer</button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">Double authentification activée. Gardez ces codes de secours en lieu sûr : chacun permet <strong>une</strong> connexion si vous n'avez plus votre téléphone. Ils ne seront plus affichés.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontFamily: 'ui-monospace, monospace', fontSize: '0.9rem', userSelect: 'all' }}>
              {backup.map(c => <span key={c}>{c}</span>)}
            </div>
            <button type="button" className="btn-primary w-full py-3" onClick={onDone}>J'ai noté mes codes</button>
          </>
        )}
      </div>
    </div>
  );
}
