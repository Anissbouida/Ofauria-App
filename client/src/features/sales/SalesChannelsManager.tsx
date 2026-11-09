import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salesChannelsApi, type SalesChannel } from '../../api/sales-channels.api';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Gestion des canaux de vente (mig 172) : liste, création, défaut, (dés)activation.
 * Composant sans décor : la coquille (page Ventes) ou la section (Paramètres) fournit
 * le titre et la marge. Source unique partagée par les deux points d'entrée.
 */
export default function SalesChannelsManager() {
  const queryClient = useQueryClient();
  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['sales-channels'],
    queryFn: salesChannelsApi.list,
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#64748b');

  const createMutation = useMutation({
    mutationFn: salesChannelsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-channels'] });
      notify.success('Canal créé');
      setNewCode(''); setNewLabel(''); setNewColor('#64748b');
      setShowAddForm(false);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message || 'Erreur lors de la création');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ label: string; color: string; isDefault: boolean; isActive: boolean }> }) =>
      salesChannelsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-channels'] });
      notify.success('Canal mis à jour');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: salesChannelsApi.deactivate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-channels'] });
      notify.success('Canal désactivé');
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message || 'Erreur');
    },
  });

  const handleSetDefault = (channel: SalesChannel) => {
    updateMutation.mutate({ id: channel.id, data: { isDefault: true } });
  };

  if (isLoading) return <div className="odoo-setting-help">Chargement…</div>;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {channels.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.625rem 0.75rem', borderRadius: 4, border: '1px solid var(--odoo-border)', background: c.is_active ? 'var(--odoo-bg)' : 'var(--odoo-bg-alt)', opacity: c.is_active ? 1 : 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: c.color }} />
            <div>
              <div className="odoo-setting-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {c.label}
                {c.is_default && <span className="odoo-tag odoo-tag-green">Par défaut</span>}
                {!c.is_active && <span className="odoo-tag odoo-tag-grey">Inactif</span>}
              </div>
              <div className="odoo-setting-help" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.code}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!c.is_default && c.is_active && (
              <button type="button" onClick={() => handleSetDefault(c)} className="odoo-btn-secondary">
                Définir par défaut
              </button>
            )}
            {!c.is_default && c.is_active && (
              <button type="button" onClick={() => deactivateMutation.mutate(c.id)} className="odoo-btn-danger">
                Désactiver
              </button>
            )}
            {!c.is_active && (
              <button type="button" onClick={() => updateMutation.mutate({ id: c.id, data: { isActive: true } })} className="odoo-btn-secondary">
                Réactiver
              </button>
            )}
          </div>
        </div>
      ))}

      {showAddForm ? (
        <div style={{ padding: '0.75rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg-alt)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 64px', gap: 8 }}>
            <input id="channel-code" type="text" placeholder="code (ex. pro_b2b)" aria-label="Code du canal"
              value={newCode} onChange={e => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              className="odoo-input" />
            <input id="channel-label" type="text" placeholder="Libellé" aria-label="Libellé du canal"
              value={newLabel} onChange={e => setNewLabel(e.target.value)}
              className="odoo-input" />
            <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} aria-label="Couleur du canal"
              className="odoo-input" style={{ height: 34, padding: 2 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setShowAddForm(false)} className="odoo-btn-secondary">Annuler</button>
            <button type="button"
              onClick={() => createMutation.mutate({ code: newCode, label: newLabel, color: newColor })}
              disabled={!newCode || !newLabel || createMutation.isPending}
              className="odoo-btn-primary">
              Créer
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setShowAddForm(true)} className="odoo-btn-secondary">
            + Ajouter un canal
          </button>
        </div>
      )}
    </div>
  );
}
