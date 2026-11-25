import { describe,it,expect,beforeAll,afterAll } from 'vitest';
import { hasTestDb,testPool,closeTestPool,importRepositories } from './helpers.js';
import { requiredModules,effectiveModules } from '@ofauria/shared';

describe.skipIf(!hasTestDb)('Activités complémentaires — union et restauration',()=>{
  let repos:Awaited<ReturnType<typeof importRepositories>>;
  let sectors:typeof import('../../repositories/sector.repository.js')['sectorRepository'];
  let withTransaction:typeof import('../../config/database.js')['withTransaction'];
  beforeAll(async()=>{repos=await importRepositories();({sectorRepository:sectors}=await import('../../repositories/sector.repository.js'));({withTransaction}=await import('../../config/database.js'))});
  afterAll(async()=>{await repos?.db.pool.end();await closeTestPool()});
  it('ajoute une activité, versionne le choix et sait restaurer le profil précédent',async()=>{
    const rollback=new Error('test rollback');
    const before=await testPool().query('SELECT sector_code,is_primary FROM company_sectors ORDER BY sector_code');
    try {
      await withTransaction(async()=>{
        sectors.invalidate(); const current=await sectors.activation();
        const other=(await sectors.list()).find(p=>p.code!==current.sector.code&&!(current.sector.secondarySectors??[]).includes(p.code))!;
        await sectors.recordVersion('Avant activité complémentaire');
        const original=(await repos.db.query('SELECT max(id)::int AS id FROM config_versions')).rows[0].id;
        const selected=effectiveModules([...current.modules,...other.modules],{});
        for(const m of [...selected])for(const dep of requiredModules(m))selected.add(dep);
        const secondary=[...(current.sector.secondarySectors??[]),other.code];
        const target=await sectors.planWizardSelection(current.sector.code,secondary,[...selected]);
        await sectors.commit(target.current,target.target,null,'Ajouter activité complémentaire');
        const active=await sectors.current();expect(active.secondarySectors).toContain(other.code);expect(active.code).toBe(current.sector.code);
        expect(new Set(active.modules)).toEqual(new Set([...current.sector.modules,...other.modules]));
        const saved=(await repos.db.query('SELECT snapshot FROM config_versions ORDER BY id DESC LIMIT 1')).rows[0].snapshot;
        expect(saved.secondarySectors).toContain(other.code);
        const restored=await sectors.restoreVersion(original);expect('activation' in restored).toBe(true);
        expect((await sectors.current()).secondarySectors).toEqual(current.sector.secondarySectors);
        throw rollback;
      });
    }catch(e){if(e!==rollback)throw e}finally{sectors.invalidate()}
    expect((await testPool().query('SELECT sector_code,is_primary FROM company_sectors ORDER BY sector_code')).rows).toEqual(before.rows);
  },60000);
});
