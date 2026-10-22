import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, rolesApi } from '../../api/users.api';
import RolesPanel from './RolesPanel';
import { storesApi } from '../../api/stores.api';
import { Plus, Pencil, Shield, ShieldOff, KeyRound, Settings2, X, Check, MapPin } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { ROLE_LABELS, MODULE_LABELS, APP_MODULES, DEFAULT_ROLE_MODULES, SETTINGS_SECTION_LABELS } from '@ofauria/shared';
import type { AppModule, UserPermission, SettingsSection } from '@ofauria/shared';

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<'users' | 'roles'>('users');

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  // Roles editables (mig 330) ; repli sur les libelles fixes si la liste n'est pas disponible.
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const roleLabel = (code: string) =>
    roles.find(r => r.code === code)?.label ?? ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code;
  const { data: stores = [] } = useQuery({ queryKey: ['stores'], queryFn: storesApi.list });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      editing ? usersApi.update(editing.id as string, data) : usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      notify.success(editing ? 'Utilisateur mis a jour' : 'Utilisateur cree');
      setShowForm(false); setEditing(null);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message || 'Erreur');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.update(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      notify.success('Statut mis a jour');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-bakery-chocolate">Utilisateurs</h1>
          <div className="odoo-scope">
            <div className="odoo-view-switcher">
              <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Comptes</button>
              <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Rôles et contrôle</button>
            </div>
          </div>
        </div>
        {tab === 'users' && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Nouvel utilisateur
          </button>
        )}
      </div>

      {tab === 'roles' && <RolesPanel />}

      {tab === 'users' && (isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Nom</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Email</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Code PIN</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Role</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Point de vente</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u: Record<string, any>) => (
                <tr key={u.id as string} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className="font-medium">{u.firstName as string} {u.lastName as string}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{u.email as string}</td>
                  <td className="px-6 py-4">
                    {u.hasPin ? (
                      <span className="font-mono text-sm bg-green-100 text-green-700 px-2 py-1 rounded">Defini</span>
                    ) : (
                      <span className="text-xs text-gray-300">Non defini</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                      {roleLabel(u.role as string)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {(() => {
                      const store = stores.find((s: Record<string, any>) => s.id === u.storeId);
                      return store ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600">
                          <MapPin size={12} /> {store.name as string}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">Non assigne</span>
                      );
                    })()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right flex items-center justify-end gap-1">
                    <button onClick={() => setPermUserId(u.id as string)}
                      className="p-2 hover:bg-blue-50 rounded-lg" title="Permissions">
                      <Settings2 size={16} className="text-blue-500" />
                    </button>
                    <button onClick={() => { setEditing(u); setShowForm(true); }} className="p-2 hover:bg-gray-100 rounded-lg" title="Modifier">
                      <Pencil size={16} className="text-gray-500" />
                    </button>
                    <button
                      onClick={() => toggleMutation.mutate({ id: u.id as string, isActive: !u.isActive })}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                      title={u.isActive ? 'Desactiver' : 'Activer'}
                    >
                      {u.isActive ? <ShieldOff size={16} className="text-red-500" /> : <Shield size={16} className="text-green-500" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p className="text-center py-8 text-gray-400">Aucun utilisateur</p>}
        </div>
      ))}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">{editing ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, any> = Object.fromEntries(fd);
              if (!data.password) delete data.password;
              if (!data.pinCode) data.pinCode = editing ? null : undefined;
              if (data.pinCode === undefined) delete data.pinCode;
              // Handle storeId: empty string means null (unassign)
              if (data.storeId === '') data.storeId = null;
              saveMutation.mutate(data);
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Prenom</label>
                  <input name="firstName" defaultValue={editing?.firstName as string} className="input" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nom</label>
                  <input name="lastName" defaultValue={editing?.lastName as string} className="input" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input name="email" type="email" defaultValue={editing?.email as string} className="input" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                    <KeyRound size={14} />
                    Mot de passe {editing ? '(vide = inchange)' : ''}
                  </label>
                  <input name="password" type="password" className="input" placeholder={editing ? '••••••••' : 'Mot de passe'} {...(!editing ? { required: true, minLength: 4 } : {})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                    <KeyRound size={14} />
                    Code PIN (4 chiffres)
                  </label>
                  <input name="pinCode" type="text" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6}
                    defaultValue="" className="input font-mono text-center tracking-widest"
                    placeholder="ex: 1234" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Role</label>
                  <select name="role" defaultValue={editing?.role as string || 'cashier'} className="input">
                    {roles.length > 0
                      ? roles.filter(r => r.is_active || r.code === editing?.role).map(r => (
                          <option key={r.code} value={r.code}>{r.label}</option>
                        ))
                      : Object.entries(ROLE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                    <MapPin size={14} /> Point de vente
                  </label>
                  <select name="storeId" defaultValue={editing?.storeId as string || ''} className="input">
                    <option value="">-- Aucun --</option>
                    {stores.map((s: Record<string, any>) => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}{s.city ? ` (${s.city})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
                  {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {permUserId && (
        <PermissionsModal
          userId={permUserId}
          userName={(() => {
            const u = users.find((u: Record<string, any>) => u.id === permUserId);
            return u ? `${u.firstName} ${u.lastName}` : '';
          })()}
          userRole={(() => {
            const u = users.find((u: Record<string, any>) => u.id === permUserId);
            return (u?.role as string) || '';
          })()}
          onClose={() => setPermUserId(null)}
        />
      )}
    </div>
  );
}

/* ============ PERMISSIONS MODAL ============ */

interface PermState {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config: Record<string, any>;
}

const ALL_MODULES = Object.values(APP_MODULES) as AppModule[];

// Modules that support category_slugs config (for partial access)
const CATEGORY_MODULES: AppModule[] = ['production'];

// Sections du module Parametres (config.sections) : vide = toutes les sections.
const SETTINGS_SECTION_KEYS = Object.keys(SETTINGS_SECTION_LABELS) as SettingsSection[];

function PermissionsModal({ userId, userName, userRole, onClose }: {
  userId: string;
  userName: string;
  userRole: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: existingPerms, isLoading } = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: () => usersApi.getPermissions(userId),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['all-categories'],
    queryFn: async () => {
      const { default: api } = await import('../../api/client');
      const res = await api.get('/products', { params: { limit: '1' } });
      // Get categories from products endpoint or a dedicated one
      const prodsRes = await api.get('/products', { params: { limit: '500' } });
      const prods = prodsRes.data.data || [];
      const catMap = new Map<string, string>();
      prods.forEach((p: Record<string, any>) => {
        if (p.category_slug && p.category_name) {
          catMap.set(p.category_slug as string, p.category_name as string);
        }
      });
      return Array.from(catMap.entries()).map(([slug, name]) => ({ slug, name }));
    },
  });

  const [perms, setPerms] = useState<Record<AppModule, PermState> | null>(null);
  const [initialized, setInitialized] = useState(false);
  // Droits du role (mig 330) : point de depart quand l'utilisateur n'a pas de droits propres.
  const { data: rolePerms, isFetched: rolePermsFetched } = useQuery({
    queryKey: ['role-permissions', userRole],
    queryFn: () => rolesApi.permissions(userRole),
    retry: false,
  });

  // Initialize from existing or defaults
  if (!initialized && existingPerms !== undefined && !isLoading && rolePermsFetched) {
    const defaultModules = DEFAULT_ROLE_MODULES[userRole] || [];
    const existingList = existingPerms as UserPermission[];
    const hasCustomPerms = existingList.length > 0;
    const state: Record<string, PermState> = {};

    for (const mod of ALL_MODULES) {
      const existing = existingList.find(p => p.module === mod);
      if (existing) {
        state[mod] = {
          canView: existing.canView,
          canCreate: existing.canCreate,
          canEdit: existing.canEdit,
          canDelete: existing.canDelete,
          config: existing.config || {},
        };
      } else if (hasCustomPerms) {
        // Custom permissions exist but this module is not in the list → no access
        state[mod] = {
          canView: false,
          canCreate: false,
          canEdit: false,
          canDelete: false,
          config: {},
        };
      } else {
        // No custom permissions at all → fall back to the role's rights
        const fromRole = rolePerms?.find(p => p.module === mod);
        const hasAccess = rolePerms ? !!fromRole?.canView : defaultModules.includes(mod);
        state[mod] = {
          canView: hasAccess,
          canCreate: rolePerms ? !!fromRole?.canCreate : hasAccess,
          canEdit: rolePerms ? !!fromRole?.canEdit : hasAccess,
          canDelete: rolePerms ? !!fromRole?.canDelete : false,
          config: (fromRole?.config as Record<string, any>) || {},
        };
      }
    }
    setPerms(state as Record<AppModule, PermState>);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!perms) return Promise.resolve();
      const permissions = ALL_MODULES
        .filter(mod => perms[mod].canView || perms[mod].canCreate || perms[mod].canEdit || perms[mod].canDelete)
        .map(mod => ({
          module: mod,
          canView: perms[mod].canView,
          canCreate: perms[mod].canCreate,
          canEdit: perms[mod].canEdit,
          canDelete: perms[mod].canDelete,
          config: perms[mod].config,
        }));
      return usersApi.setPermissions(userId, permissions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-permissions', userId] });
      notify.success('Permissions enregistrees');
      onClose();
    },
    onError: () => notify.error('Erreur lors de la sauvegarde'),
  });

  const toggleModule = (mod: AppModule, field: keyof Omit<PermState, 'config'>) => {
    if (!perms) return;
    const next = { ...perms };
    next[mod] = { ...next[mod], [field]: !next[mod][field] };
    // If unchecking canView, uncheck everything
    if (field === 'canView' && !next[mod].canView) {
      next[mod].canCreate = false;
      next[mod].canEdit = false;
      next[mod].canDelete = false;
    }
    // If checking create/edit/delete, ensure canView is on
    if (field !== 'canView' && next[mod][field]) {
      next[mod].canView = true;
    }
    setPerms(next);
  };

  const toggleCategorySlug = (mod: AppModule, slug: string) => {
    if (!perms) return;
    const next = { ...perms };
    const currentSlugs = (next[mod].config.category_slugs as string[]) || [];
    if (currentSlugs.includes(slug)) {
      next[mod] = { ...next[mod], config: { ...next[mod].config, category_slugs: currentSlugs.filter(s => s !== slug) } };
    } else {
      next[mod] = { ...next[mod], config: { ...next[mod].config, category_slugs: [...currentSlugs, slug] } };
    }
    setPerms(next);
  };

  const toggleSettingsSection = (section: SettingsSection) => {
    if (!perms) return;
    const current = (perms.settings.config.sections as SettingsSection[]) || [];
    const sections = current.includes(section) ? current.filter(s => s !== section) : [...current, section];
    setPerms({ ...perms, settings: { ...perms.settings, config: { ...perms.settings.config, sections } } });
  };

  const selectAllCategories = (mod: AppModule) => {
    if (!perms) return;
    const next = { ...perms };
    next[mod] = { ...next[mod], config: { ...next[mod].config, category_slugs: categories.map(c => c.slug) } };
    setPerms(next);
  };

  const clearAllCategories = (mod: AppModule) => {
    if (!perms) return;
    const next = { ...perms };
    next[mod] = { ...next[mod], config: { ...next[mod].config, category_slugs: [] } };
    setPerms(next);
  };

  if (userRole === 'admin') {
    return (
      <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl font-bold mb-4">Permissions — {userName}</h2>
          <p className="text-gray-500">L'administrateur a acces a tous les modules par defaut.</p>
          <div className="flex justify-end mt-6">
            <button onClick={onClose} className="btn-secondary">Fermer</button>
          </div>
        </div>
      </ModalBackdrop>
    );
  }

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Permissions — {userName}</h2>
            <p className="text-sm text-gray-500 mt-1">
              Role: <span className="font-medium">{ROLE_LABELS[userRole as keyof typeof ROLE_LABELS] || userRole}</span>
              {' '}· sans droits propres, l'utilisateur suit les droits de son rôle (onglet Rôles et contrôle)
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading || !perms ? (
            <p className="text-gray-500">Chargement...</p>
          ) : (
            <div className="space-y-1">
              {/* Header */}
              <div className="grid grid-cols-[1fr_70px_70px_70px_70px] gap-2 px-3 py-2 text-xs font-semibold text-gray-500 uppercase border-b">
                <span>Module</span>
                <span className="text-center">Voir</span>
                <span className="text-center">Creer</span>
                <span className="text-center">Modifier</span>
                <span className="text-center">Supprimer</span>
              </div>

              {/* « Utilisateurs » reste reserve a l'administrateur (routes /users en dur). */}
              {ALL_MODULES.filter(m => m !== 'users').map(mod => {
                const p = perms[mod];
                const hasCategoryConfig = CATEGORY_MODULES.includes(mod);
                const activeSlugs = (p.config.category_slugs as string[]) || [];

                return (
                  <div key={mod}>
                    <div className={`grid grid-cols-[1fr_70px_70px_70px_70px] gap-2 px-3 py-3 rounded-lg items-center ${
                      p.canView ? 'bg-blue-50/50' : 'bg-gray-50/50'
                    }`}>
                      <span className="font-medium text-sm">{MODULE_LABELS[mod]}</span>
                      {(['canView', 'canCreate', 'canEdit', 'canDelete'] as const).map(field => (
                        <label key={field} className="flex justify-center cursor-pointer">
                          <input type="checkbox" checked={p[field]}
                            onChange={() => toggleModule(mod, field)}
                            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                        </label>
                      ))}
                    </div>

                    {/* Sections autorisees du module Parametres */}
                    {mod === 'settings' && p.canView && (
                      <div className="ml-6 mt-1 mb-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <span className="text-xs font-semibold text-slate-700">Sections autorisées :</span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {SETTINGS_SECTION_KEYS.map(sec => {
                            const selected = ((p.config.sections as string[]) || []).includes(sec);
                            return (
                              <button key={sec} type="button" onClick={() => toggleSettingsSection(sec)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                  selected
                                    ? 'bg-slate-700 text-white shadow-sm'
                                    : 'bg-white text-gray-600 border border-gray-200 hover:border-slate-400'
                                }`}>
                                {selected && <Check size={12} className="inline mr-1 -mt-0.5" />}
                                {SETTINGS_SECTION_LABELS[sec]}
                              </button>
                            );
                          })}
                        </div>
                        {!((p.config.sections as string[]) || []).length && (
                          <p className="text-xs text-slate-500 mt-2 italic">Toutes les sections (aucune restriction)</p>
                        )}
                      </div>
                    )}

                    {/* Category config for production */}
                    {hasCategoryConfig && p.canView && (
                      <div className="ml-6 mt-1 mb-2 p-3 bg-amber-50 rounded-lg border border-amber-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-amber-800">Categories autorisees :</span>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => selectAllCategories(mod)}
                              className="text-xs text-amber-600 hover:underline">Tout</button>
                            <button type="button" onClick={() => clearAllCategories(mod)}
                              className="text-xs text-amber-600 hover:underline">Aucun</button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {categories.map(cat => {
                            const selected = activeSlugs.includes(cat.slug);
                            return (
                              <button key={cat.slug} type="button"
                                onClick={() => toggleCategorySlug(mod, cat.slug)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                  selected
                                    ? 'bg-amber-500 text-white shadow-sm'
                                    : 'bg-white text-gray-600 border border-gray-200 hover:border-amber-300'
                                }`}>
                                {selected && <Check size={12} className="inline mr-1 -mt-0.5" />}
                                {cat.name}
                              </button>
                            );
                          })}
                        </div>
                        {activeSlugs.length === 0 && (
                          <p className="text-xs text-amber-600 mt-2 italic">Toutes les categories (aucune restriction)</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 border-t flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="btn-primary flex items-center gap-2">
            <Settings2 size={16} />
            {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer les permissions'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
