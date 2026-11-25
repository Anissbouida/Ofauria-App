import { describe,it,expect,vi } from 'vitest';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { Response } from 'express';

const {rights}=vi.hoisted(()=>({rights:vi.fn()}));
vi.mock('../services/access-rights.js',()=>({effectiveRights:vi.fn(async()=>[]),rightRow:()=>rights()}));
import { authorizeWizardSettings } from '../middleware/settings-access.middleware.js';

describe('Autorisation multisectorielle',()=>{
  it.each([
    {sections:['company'],view:true,edit:true,allowed:false},
    {sections:['company','production'],view:true,edit:true,allowed:false},
    {sections:['company','production','business'],view:true,edit:false,allowed:false},
    {sections:['company','production','business'],view:false,edit:true,allowed:false},
    {sections:['company','production','business'],view:true,edit:true,allowed:true},
    {sections:[],view:true,edit:true,allowed:true},
  ])('contrôle les sections et les droits : $sections / $view / $edit',async({sections,view,edit,allowed})=>{
    rights.mockReturnValue({can_view:view,can_edit:edit,can_create:false,can_delete:false,config:{sections}});
    const req={user:{role:'manager',userId:'test'}} as AuthRequest;
    const res={status:vi.fn().mockReturnThis(),json:vi.fn()} as unknown as Response;
    const next=vi.fn();
    await authorizeWizardSettings(req,res,next);
    if(allowed){expect(next).toHaveBeenCalledWith();expect(res.status).not.toHaveBeenCalled();}
    else {expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();}
  });
});
