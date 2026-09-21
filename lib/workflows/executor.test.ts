import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({active:vi.fn(),checkpoint:vi.fn(),rpc:vi.fn(),send:vi.fn(),sent:vi.fn()}));
vi.mock('./store',()=>({assertActive:mocks.active,checkpoint:mocks.checkpoint,assertDb:(e:unknown)=>{if(e)throw new Error('storage_failed');}}));
vi.mock('@/lib/db/admin',()=>({createAdminSupabaseClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/jobs/send-pipeline',()=>({runSendMessagePipeline:async(_input:unknown,steps:{run:(name:string,callback:()=>Promise<unknown>)=>Promise<unknown>})=>{
  await steps.run('load-context',async()=>({text:'PRIVATE MESSAGE',token:'SECRET'}));
  const id=await steps.run('send-via-adapter',mocks.send);
  await steps.run('mark-sent',()=>mocks.sent(id));
  return {status:'sent'};
}}));
import {runOperationJob} from './executor';
const input={workspaceId:'w',operationId:'o',attemptId:'a'};
let checkpoints:Record<string,unknown>,started:boolean;
beforeEach(()=>{
  vi.resetAllMocks();checkpoints={};started=false;
  mocks.active.mockImplementation(async()=>({kind:'send-message',input:{workspaceId:'w',conversationId:'c',messageId:'m'},checkpoints}));
  mocks.rpc.mockImplementation(async()=>{const accepted=!started;started=true;return {data:accepted,error:null};});
  mocks.checkpoint.mockImplementation(async(_input:unknown,key:string,result:unknown)=>{checkpoints[key]=result;});
  mocks.send.mockResolvedValue('remote-id');mocks.sent.mockResolvedValue(undefined);
});
describe('durable delivery boundary',()=>{
  it('checkpoints only the delivery identifier, never loaded content',async()=>{
    await runOperationJob(input,'all');expect(checkpoints).toEqual({'send-via-adapter':'remote-id'});
  });
  it('finishes a saved send after a database failure without another external call',async()=>{
    mocks.sent.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runOperationJob(input,'all')).rejects.toThrow();
    await runOperationJob(input,'all');expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.sent).toHaveBeenLastCalledWith('remote-id');
  });
  it('blocks another send when the provider response was lost',async()=>{
    mocks.send.mockRejectedValueOnce(new Error('timeout'));
    await expect(runOperationJob(input,'all')).rejects.toThrow('timeout');
    await expect(runOperationJob(input,'all')).rejects.toThrow('workflow_delivery_uncertain');expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('records a definitive rejection for a manual retry',async()=>{
    mocks.send.mockRejectedValue(Object.assign(new Error('PRIVATE ERROR'),{status:422}));
    await expect(runOperationJob(input,'all')).rejects.toThrow();expect(checkpoints).toEqual({rejected:true});
  });
  it('does not send after cancellation invalidated the attempt',async()=>{
    mocks.active.mockRejectedValue(new Error('workflow_attempt_stale'));
    await expect(runOperationJob(input,'all')).rejects.toThrow('workflow_attempt_stale');expect(mocks.send).not.toHaveBeenCalled();
  });
});
