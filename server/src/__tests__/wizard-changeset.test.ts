import { describe,it,expect,vi } from 'vitest';
vi.mock('../config/database.js',()=>({db:{query:vi.fn()},withTransaction:vi.fn()}));
vi.mock('../repositories/sector.repository.js',()=>({sectorRepository:{}}));
vi.mock('../services/wizard/catalog.js',()=>({wizardCatalog:vi.fn(),validateWizardCatalog:vi.fn()}));
import { compileChangeSet, compilationIssues, technicalSimulationAvailable } from '../services/wizard/change-set.js';
import { WIZARD_PARAMETERS } from '../services/wizard/parameter-definitions.js';
import { prepareParameterChanges } from '../services/wizard/parameter-operations.js';

describe('Compilation explicite du brouillon',()=>{
  it('distingue les opérations raccordées de celles en attente, sans ignorer les choix',()=>{
    const answers={sector:{data:{primary:'test',secondary:['second']},reviewed:true},modules:{data:{selected:['dashboard']},reviewed:true},company:{data:{name:'Test',sites:'2'},reviewed:true}};
    const ops=compileChangeSet(answers);
    expect(ops.map(o=>[o.step,o.execution])).toEqual([['company','company_context'],['company','pending'],['sector','sector_modules'],['modules','sector_modules']]);
    expect(compilationIssues(answers,'quick',ops).some(i=>i.severity==='blocking')).toBe(true);
  });
  it('la simulation technique n’est jamais activable en production',()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('KALUM_WIZARD_SIMULATION_ENABLED','true');
    try{expect(technicalSimulationAvailable()).toBe(false)}finally{vi.unstubAllEnvs()}
  });
  it('réutilise les métadonnées et préserve les champs non modifiés',()=>{
    const catalog=WIZARD_PARAMETERS.map(({step,module,def})=>({step,module,key:def.key,label:def.label,help:def.help,fields:def.fields,value:def.defaults}));
    const answers={modules:{data:{selected:['stock','production']}},operations:{data:{'stock.negative_policy:ingredient':'block','production.mrp_horizon:days':'22',tracking:'Lots'}},rules:{data:{'quality.auto_release:enabled':false}}};
    const result=prepareParameterChanges(answers,catalog);
    expect(result.issues).toEqual([]);
    expect(result.changes).toEqual(expect.arrayContaining([expect.objectContaining({key:'stock.negative_policy',value:{...catalog.find(p=>p.key==='stock.negative_policy')!.value,ingredient:'block'}}),expect.objectContaining({key:'production.mrp_horizon',value:{days:22}}),expect.objectContaining({key:'quality.auto_release',value:{enabled:false}})]));
    expect(compileChangeSet(answers).filter(o=>o.step==='operations').map(o=>o.execution)).toEqual(['parameters','pending']);
    expect(prepareParameterChanges({...answers,operations:{data:{'production.mrp_horizon:days':'61'}}},catalog).issues).toHaveLength(1);
    expect(prepareParameterChanges({...answers,modules:{data:{selected:[]}}},catalog).issues).toHaveLength(3);
  });
});
