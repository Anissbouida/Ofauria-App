import api from './client';
import { useQuery } from '@tanstack/react-query';
import type { InterfacePreferences } from '@ofauria/shared';

export type InterfacePreferencePatch=Partial<{[K in keyof InterfacePreferences]:InterfacePreferences[K]|null}>;
export interface InterfacePreferenceResult {available:boolean;values:InterfacePreferences;personal:InterfacePreferencePatch;sources:Record<keyof InterfacePreferences,string>}
export const interfacePreferenceKey=(userId?:string)=>['interface-preferences',userId] as const;
export const interfacePreferencesApi={
  get:()=>api.get('/users/me/interface-preferences').then(r=>r.data.data as InterfacePreferenceResult),
  update:(patch:InterfacePreferencePatch)=>api.put('/users/me/interface-preferences',patch).then(r=>r.data.data as InterfacePreferenceResult),
};
export const useInterfacePreferences=(userId?:string)=>useQuery({queryKey:interfacePreferenceKey(userId),queryFn:interfacePreferencesApi.get,enabled:!!userId,staleTime:30_000});
