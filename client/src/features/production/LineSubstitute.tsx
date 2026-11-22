import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Replace } from 'lucide-react';
import api from '../../api/client';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Substitut d'article sur une ligne de bon non pesée (M4-05) : propose les substituts de
 * la fiche (ratio, stock utilisable, allergènes ajoutés) ; la bascule est tracée sur la
 * ligne (article d'origine, motif) et la ligne pèse ensuite l'article de remplacement.
 */
type Suggestion = { id: string; substitute_name: string; substitute_unit: string; ratio: number; needed_quantity: number | null; available: number; allergens_added: string[] };

export default function LineSubstitute({ ligneId, onDone }: { ligneId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const { data = [], isLoading } = useQuery({
    queryKey: ['bsi-line-substitutes', ligneId], enabled: open,
    queryFn: () => api.get(`/bons-sortie/ligne/${ligneId}/substitutes`).then(r => r.data.data as Suggestion[]),
  });
  const apply = useMutation({
    mutationFn: () => api.post(`/bons-sortie/ligne/${ligneId}/substitute`, { substitutionId: choice, reason }).then(r => r.data.data as { allergens_added: string[] }),
    onSuccess: (d) => {
      notify.success(d.allergens_added?.length ? `Substitut appliqué — allergène(s) ajouté(s) : ${d.allergens_added.join(', ')}` : 'Substitut appliqué');
      setOpen(false); onDone();
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  if (!open) return <button type="button" className="bsi-link-btn" onClick={() => setOpen(true)}><Replace size={11} /> Substitut</button>;
  return (
    <div style={{ marginTop: 4, padding: 6, border: '1px solid var(--ds-sep)', borderRadius: 6, display: 'grid', gap: 4, fontSize: '12px' }}>
      {isLoading ? 'Chargement…' : data.length === 0 ? <span>Aucun substitut déclaré sur la fiche pour cet article.</span> : data.map(s => (
        <label key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="radio" name={`sub-${ligneId}`} checked={choice === s.id} onChange={() => setChoice(s.id)} disabled={s.needed_quantity == null || s.available < (s.needed_quantity ?? 0)} />
          <span><strong>{s.substitute_name}</strong> — {s.needed_quantity != null ? `${s.needed_quantity.toLocaleString('fr-FR')} ${s.substitute_unit}` : 'unité non convertible'} (ratio {s.ratio.toLocaleString('fr-FR')}) · stock {s.available.toLocaleString('fr-FR')} {s.substitute_unit}
            {s.allergens_added.length > 0 && <span className="text-orange-700"> · ajoute : {s.allergens_added.join(', ')}</span>}</span>
        </label>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="ds-input sm" style={{ width: 200 }} placeholder="Motif (obligatoire)" value={reason} onChange={e => setReason(e.target.value)} aria-label="Motif de la substitution" />
        <button type="button" className="odoo-btn-secondary" disabled={!choice || reason.trim().length < 3 || apply.isPending} onClick={() => apply.mutate()}>Appliquer</button>
        <button type="button" className="bsi-link-btn" onClick={() => setOpen(false)}>Fermer</button>
      </div>
    </div>
  );
}
