import { describe,it,expect } from 'vitest';
import { resolveInterfacePreferences } from '../services/interface-preferences.js';
import { validateInterfaceData } from '../services/wizard/layer-operations.js';
import { workspaceHomeRoute } from '@ofauria/shared';

describe('Préférences d’interface',()=>{
  it('résout la société puis le compte, sans lire les préférences d’un autre compte',()=>{
    const rows=[{key:'ui.workspace',scope_type:'company' as const,scope_id:'',value:'production'},{key:'ui.workspace',scope_type:'user' as const,scope_id:'a',value:'Ventes'},{key:'ui.table_density',scope_type:'user' as const,scope_id:'b',value:'compact'}];
    expect(resolveInterfacePreferences(rows,'a')).toMatchObject({values:{workspace:'sales',density:'standard'},sources:{workspace:'user',density:'default'}});
    expect(resolveInterfacePreferences(rows,'b')).toMatchObject({values:{workspace:'production',density:'compact'}});
    expect(resolveInterfacePreferences(rows)).toMatchObject({values:{workspace:'production',density:'standard'},personal:{}});
  });
  it('rejette un espace non disponible et les valeurs non reconnues',()=>{
    expect(validateInterfaceData({workspace:'Production',density:'Compacte'},['production'],true)).toEqual([]);
    expect(validateInterfaceData({workspace:'production'},['sales'],true)).toHaveLength(1);
    expect(validateInterfaceData({workspace:'/unknown',density:'x'},[],true)).toHaveLength(2);
    expect(validateInterfaceData({workspace:'direction'},[],false)).toHaveLength(1);
  });
  it('ne redirige jamais vers un écran absent de la navigation autorisée',()=>{
    expect(workspaceHomeRoute('production','/sales',['/sales'])).toBeNull();
    expect(workspaceHomeRoute('sector','/sales',['/production'])).toBeNull();
    expect(workspaceHomeRoute('sector','/sales',['/sales'])).toBe('/sales');
    expect(workspaceHomeRoute('sales',null,['/sales'],true)).toBeNull();
    expect(workspaceHomeRoute('direction','/sales',['/sales'])).toBeNull();
    // Lot 4 de la refonte Utilisateurs : la page d'accueil du rôle passe avant celle du secteur,
    // si elle est visible ; un espace de travail choisi passe avant les deux.
    expect(workspaceHomeRoute('sector','/sales',['/sales','/purchasing'],false,'/purchasing')).toBe('/purchasing');
    expect(workspaceHomeRoute('sector','/sales',['/sales'],false,'/purchasing')).toBe('/sales');
    expect(workspaceHomeRoute('production','/sales',['/sales','/production','/purchasing'],false,'/purchasing')).toBe('/production');
  });
});
