import type { AppModule } from './modules.js';

/** L'accueil est une préférence de navigation, jamais un droit d'accès. */
export const WORKSPACES = [
  {value:'sector',label:'Selon le secteur',route:null,module:null},
  {value:'direction',label:'Direction',route:'/',module:null},
  {value:'production',label:'Production',route:'/production',module:'production'},
  {value:'sales',label:'Ventes',route:'/sales',module:'sales'},
  {value:'accounting',label:'Comptabilité',route:'/accounting',module:'accounting'},
] as const satisfies readonly {value:string;label:string;route:string|null;module:AppModule|null}[];
export const TABLE_DENSITIES = [{value:'standard',label:'Standard'},{value:'compact',label:'Compacte'}] as const;
export type Workspace = typeof WORKSPACES[number]['value'];
export type TableDensity = typeof TABLE_DENSITIES[number]['value'];
export type InterfacePreferences = {workspace:Workspace;density:TableDensity};
export const INTERFACE_DEFAULTS:InterfacePreferences={workspace:'sector',density:'standard'};
export const INTERFACE_KEYS={workspace:'ui.workspace',density:'ui.table_density'} as const;
export const parseWorkspace=(v:unknown):Workspace|undefined=>WORKSPACES.find(o=>o.value===v||o.label===v)?.value;
export const parseTableDensity=(v:unknown):TableDensity|undefined=>TABLE_DENSITIES.find(o=>o.value===v||o.label===v)?.value;

/** Navigation uniquement vers une entrée déjà filtrée par les droits et modules. */
/** Accueil : espace de travail choisi par la personne, sinon page d'accueil de son rôle
 *  principal (refonte Utilisateurs, lot 4), sinon celle du secteur. */
export function workspaceHomeRoute(workspace:Workspace,sectorRoute:string|null|undefined,visibleRoutes:readonly string[],fromLauncher=false,roleRoute?:string|null):string|null{
  if(fromLauncher)return null;
  const candidates=workspace==='sector'?[roleRoute,sectorRoute]:[WORKSPACES.find(w=>w.value===workspace)?.route];
  return candidates.find((home):home is string=>!!home&&home!=='/'&&visibleRoutes.includes(home))??null;
}
