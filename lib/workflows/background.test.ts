import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('workflow',()=>({FatalError:class extends Error{},RetryableError:class extends Error{}}));
const mocks=vi.hoisted(()=>({active:vi.fn(),checkpoint:vi.fn(),load:vi.fn(),send:vi.fn(),prune:vi.fn()}));
vi.mock('./store',()=>({assertActive:mocks.active,checkpoint:mocks.checkpoint}));
vi.mock('@/lib/jobs/send-push-pipeline',()=>({sendPushDependencies:{loadContext:mocks.load,send:mocks.send,prune:mocks.prune},buildPushPayload:()=>({title:'private'})}));
import {sendPushRecipient} from './push-steps';
import {cleanAiLogs,cleanPublicationAssets} from './cleanup-steps';
import {authorizedCron} from './cron';
const input={workspaceId:'w',operationId:'o',attemptId:'a'};
let checkpoints:Record<string,unknown>;
beforeEach(()=>{
  vi.resetAllMocks();checkpoints={};
  mocks.active.mockImplementation(async()=>({checkpoints,created_at:new Date().toISOString(),input:{workspaceId:'w',conversationId:'c',messageId:'m'}}));
  mocks.checkpoint.mockImplementation(async(_input:unknown,key:string,value:unknown)=>{checkpoints[key]=value;});
  mocks.load.mockResolvedValue({status:'ok',context:{recipients:[{id:'one',endpoint:'PRIVATE-ENDPOINT',p256dh:'KEY',authKey:'SECRET'},{id:'two'}]}});
  mocks.send.mockResolvedValue({status:'sent'});
});
describe('background retry and cron boundary',()=>{
  it('limits the three approved background steps to two retries',()=>{
    expect([sendPushRecipient.maxRetries,cleanAiLogs.maxRetries,cleanPublicationAssets.maxRetries]).toEqual([2,2,2]);
  });
  it('skips successful recipients when another recipient fails',async()=>{
    await sendPushRecipient(input,'one');
    mocks.send.mockResolvedValueOnce({status:'error',retryable:true});
    await expect(sendPushRecipient(input,'two')).rejects.toThrow('push_temporarily_unavailable');
    await sendPushRecipient(input,'one');await sendPushRecipient(input,'two');
    expect(mocks.send).toHaveBeenCalledTimes(3);expect(checkpoints).toEqual({'push:one':true,'push:two':true});
  });
  it('prunes expired subscriptions without retrying delivery',async()=>{
    mocks.send.mockResolvedValue({status:'expired'});
    await sendPushRecipient(input,'one');await sendPushRecipient(input,'one');
    expect(mocks.prune).toHaveBeenCalledWith('one');expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('never stores provider error text in durable step errors',async()=>{
    mocks.load.mockRejectedValue(new Error('PRIVATE-ENDPOINT SECRET'));
    await expect(sendPushRecipient(input,'one')).rejects.toThrow('push_step_failed');
  });
  it('rejects absent, incorrect and differently sized cron credentials',()=>{
    vi.stubEnv('CRON_SECRET','cron-test-secret');
    try {
      for(const value of ['', 'Bearer wrong', 'cron-test-secret'])expect(authorizedCron(new Request('https://test/api/cron',{headers:{authorization:value}}))).toBe(false);
      expect(authorizedCron(new Request('https://test/api/cron',{headers:{authorization:'Bearer cron-test-secret'}}))).toBe(true);
    } finally {vi.unstubAllEnvs();}
  });
});
