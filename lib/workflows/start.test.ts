import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({start:vi.fn(),update:vi.fn(),rpc:vi.fn(),result:{data:[{id:'operation'}],error:null as unknown}}));
vi.mock('workflow/api',()=>({start:mocks.start,getRun:vi.fn()}));
vi.mock('./registry',()=>({workflows:{'send-message':async()=>{}}}));
vi.mock('@/lib/db/admin',()=>({createAdminSupabaseClient:()=>({rpc:mocks.rpc,from:()=>{
  const q={update:mocks.update,eq:()=>q,is:()=>q,select:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(mocks.result).then(resolve)};
  mocks.update.mockReturnValue(q);return q;
}})}));
import {launchOperation,requestJob,validateJobInput} from './start';
import type {Operation} from './types';
const row={id:'operation',workspace_id:'workspace',attempt_id:'attempt',kind:'send-message'} as Operation;
beforeEach(()=>{vi.clearAllMocks();mocks.result={data:[{id:'operation'}],error:null};mocks.start.mockResolvedValue({runId:'run'});});
describe('Workflow launch',()=>{
  it('rejects non-ID input before persisting or starting anything',async()=>{
    expect(()=>validateJobInput({workspaceId:'10000000-0000-4000-8000-000000000001',text:'private'})).toThrow('invalid_workflow_ids');
    expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
  });
  it('starts with only operation IDs in fra1 with immediate payload expiry',async()=>{
    await launchOperation(row);expect(mocks.start).toHaveBeenCalledWith(expect.any(Function),[{workspaceId:'workspace',operationId:'operation',attemptId:'attempt'}],{region:'fra1',experimental_retention:0});
  });
  it('does not compensate a running worker after a lost start acknowledgement',async()=>{
    mocks.start.mockRejectedValue(new Error('network'));mocks.result.data=[];
    await expect(launchOperation(row)).resolves.toBeUndefined();
  });
  it('reports an unclaimed failed launch for manual retry',async()=>{
    mocks.start.mockRejectedValue(new Error('network'));
    await expect(launchOperation(row)).rejects.toThrow('workflow_start_failed');expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({status:'failed'}));
  });
  it('does not start a second run for an existing owner',async()=>{
    mocks.rpc.mockResolvedValue({data:{...row,status:'running',run_id:'existing'},error:null});
    await requestJob('send-message',{workspaceId:'10000000-0000-4000-8000-000000000001',messageId:'20000000-0000-4000-8000-000000000001',conversationId:'30000000-0000-4000-8000-000000000001'});
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
