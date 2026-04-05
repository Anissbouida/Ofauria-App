import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { usersApi } from '../api/users.api';
import type { AppModule, UserPermission } from '@ofauria/shared';
import { DEFAULT_ROLE_MODULES, getRoleCategorySlugs } from '@ofauria/shared';

interface PermissionsContextType {
  permissions: UserPermission[];
  hasModule: (module: AppModule) => boolean;
  canView: (module: AppModule) => boolean;
  canCreate: (module: AppModule) => boolean;
  canEdit: (module: AppModule) => boolean;
  canDelete: (module: AppModule) => boolean;
  getModuleConfig: (module: AppModule) => Record<string, unknown>;
  isLoading: boolean;
  reload: () => void;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) {
      setPermissions([]);
      setIsLoading(false);
      return;
    }

    // Admin always has full access
    if (user.role === 'admin') {
      setPermissions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    usersApi.myPermissions()
      .then((perms: UserPermission[]) => {
        setPermissions(perms);
      })
      .catch(() => {
        setPermissions([]);
      })
      .finally(() => setIsLoading(false));
  }, [user, reloadKey]);

  const isAdmin = user?.role === 'admin';
  const hasCustomPermissions = permissions.length > 0;

  const hasModule = (module: AppModule): boolean => {
    if (isAdmin) return true;
    if (hasCustomPermissions) {
      return permissions.some(p => p.module === module && p.canView);
    }
    // Fallback to default role permissions
    const defaults = DEFAULT_ROLE_MODULES[user?.role || ''] || [];
    return defaults.includes(module);
  };

  const canView = (module: AppModule): boolean => {
    if (isAdmin) return true;
    if (hasCustomPermissions) {
      const perm = permissions.find(p => p.module === module);
      return perm?.canView ?? false;
    }
    const defaults = DEFAULT_ROLE_MODULES[user?.role || ''] || [];
    return defaults.includes(module);
  };

  const canCreate = (module: AppModule): boolean => {
    if (isAdmin) return true;
    if (hasCustomPermissions) {
      const perm = permissions.find(p => p.module === module);
      return perm?.canCreate ?? false;
    }
    return canView(module);
  };

  const canEdit = (module: AppModule): boolean => {
    if (isAdmin) return true;
    if (hasCustomPermissions) {
      const perm = permissions.find(p => p.module === module);
      return perm?.canEdit ?? false;
    }
    return canView(module);
  };

  const canDelete = (module: AppModule): boolean => {
    if (isAdmin) return true;
    if (hasCustomPermissions) {
      const perm = permissions.find(p => p.module === module);
      return perm?.canDelete ?? false;
    }
    return false;
  };

  const getModuleConfig = (module: AppModule): Record<string, unknown> => {
    if (isAdmin) return {};
    // Use custom permissions config if available
    if (hasCustomPermissions) {
      const perm = permissions.find(p => p.module === module);
      if (perm?.config && Object.keys(perm.config).length > 0) return perm.config;
    }
    // Fallback: for production module, use role-based category slugs
    if (module === 'production' && user?.role) {
      const slugs = getRoleCategorySlugs(user.role);
      if (slugs) return { category_slugs: slugs };
    }
    return {};
  };

  const reload = () => setReloadKey(k => k + 1);

  return (
    <PermissionsContext.Provider value={{
      permissions, hasModule, canView, canCreate, canEdit, canDelete, getModuleConfig, isLoading, reload,
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}
