import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WORKSPACES,TABLE_DENSITIES,type Workspace,type TableDensity } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { interfacePreferenceKey,interfacePreferencesApi,useInterfacePreferences,type InterfacePreferencePatch } from '../../api/interface-preferences.api';

export default function InterfacePreferenceMenu(){
  const {user}=useAuth();
  const {hasModule}=usePermissions();
  const query=useInterfacePreferences(user?.id);
  const qc=useQueryClient();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(false);
  const update=async(patch:InterfacePreferencePatch)=>{
    if(!user)return;setBusy(true);setError(false);
    try{const result=await interfacePreferencesApi.update(patch);qc.setQueryData(interfacePreferenceKey(user.id),result);}catch{setError(true);}finally{setBusy(false);}
  };
  if(!query.data?.available)return null;
  return <div className="px-4 py-2 text-sm text-gray-700 space-y-2"><p className="font-medium">Mes préférences d’interface</p><label className="block text-xs">Accueil<select className="w-full border rounded px-2 py-1 text-sm" value={query.data.personal.workspace??''} disabled={busy} onChange={e=>void update({workspace:(e.target.value||null) as Workspace|null})}><option value="">Selon la société</option>{WORKSPACES.map(w=><option key={w.value} value={w.value} disabled={!!w.module&&!hasModule(w.module)}>{w.label}</option>)}</select></label><label className="block text-xs">Densité<select className="w-full border rounded px-2 py-1 text-sm" value={query.data.personal.density??''} disabled={busy} onChange={e=>void update({density:(e.target.value||null) as TableDensity|null})}><option value="">Selon la société</option>{TABLE_DENSITIES.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select></label>{error&&<p role="alert" className="text-xs text-red-600">Préférence non enregistrée.</p>}</div>;
}
