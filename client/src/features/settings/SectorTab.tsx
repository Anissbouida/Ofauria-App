import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Layers } from 'lucide-react';
import { settingsApi } from '../../api/settings.api';
import { SettingsSection } from './SettingsPrimitives';
import { notify } from '../../components/ui/InlineNotification';
import { usePermissions } from '../../context/PermissionsContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Secteur d'activité (mig 468) : choisit le pack qui active les modules et menus.
 * Changer de secteur masque/affiche des écrans sans rien supprimer ; après le
 * changement on recharge les droits pour que la navigation s'adapte aussitôt.
 */
export default function SectorTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { reload } = usePermissions();
  const { data, isLoading } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  const mut = useMutation({
    mutationFn: settingsApi.setSector,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sector'] }); notify.success('Secteur mis à jour'); reload(); },
    onError: () => notify.error('Changement de secteur impossible'),
  });

  const choose = async (code: string, label: string) => {
    if (code === data?.current.code) return;
    const ok = await confirm(
      "Les modules et menus seront adaptés à ce secteur. Aucune donnée n'est supprimée : revenir à un autre secteur réaffiche tout.",
      { title: `Basculer sur « ${label} » ?`, confirmLabel: 'Changer de secteur' });
    if (ok) mut.mutate(code);
  };

  return (
    <SettingsSection
      title="Secteur d'activité"
      description="Le secteur choisit les modules et les menus visibles : « Boulangerie » affiche tout ; les autres masquent ce qui ne sert pas au métier. Changer de secteur ne supprime aucune donnée."
      columns={1}
    >
      {isLoading ? (
        <div className="odoo-setting-help">Chargement…</div>
      ) : (
        <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
          {data?.available.map(s => {
            const on = s.code === data.current.code;
            return (
              <button key={s.code} type="button" onClick={() => choose(s.code, s.label)} disabled={mut.isPending}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.7rem 0.9rem',
                  borderRadius: 6, textAlign: 'left', cursor: on ? 'default' : 'pointer',
                  border: `1px solid ${on ? 'var(--odoo-purple)' : 'var(--odoo-border)'}`,
                  background: on ? 'var(--odoo-purple-light)' : 'var(--odoo-bg)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: on ? 600 : 400 }}>
                  <Layers size={15} /> {s.label}
                </span>
                {on && <span className="odoo-tag odoo-tag-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Actuel</span>}
              </button>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}
