import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({getRun:vi.fn(),fail:vi.fn()}));
vi.mock('workflow/api',()=>({getRun:mocks.getRun}));
vi.mock('./executor',()=>({failOperationJob:mocks.fail}));
import {reconcileOperation} from './recovery';
import type {Operation} from './types';
const row={id:'o',workspace_id:'w',attempt_id:'a',run_id:'run',status:'running',updated_at:new Date(0).toISOString()} as Operation;
beforeEach(()=>{vi.resetAllMocks();});
describe('recovery respects the actual run state',()=>{
  it('leaves live runs alone',async()=>{
    mocks.getRun.mockReturnValue({exists:Promise.resolve(true),status:Promise.resolve('running')});
    await reconcileOperation(row);expect(mocks.fail).not.toHaveBeenCalled();
  });
  it('exposes an interrupted run for manual retry',async()=>{
    mocks.getRun.mockReturnValue({exists:Promise.resolve(true),status:Promise.resolve('failed')});
    await reconcileOperation(row);expect(mocks.fail).toHaveBeenCalledWith({workspaceId:'w',operationId:'o',attemptId:'a'});
  });
  it('does not mistake an API outage for a stopped run',async()=>{
    mocks.getRun.mockImplementation(()=>{throw new Error('status unavailable');});
    await expect(reconcileOperation(row)).rejects.toThrow('status unavailable');expect(mocks.fail).not.toHaveBeenCalled();
  });
  it('gives an unbound start time to claim before exposing failure',async()=>{
    await reconcileOperation({...row,run_id:null,updated_at:new Date(Date.now()-120_000).toISOString()});expect(mocks.fail).not.toHaveBeenCalled();
    await reconcileOperation({...row,run_id:null});expect(mocks.fail).toHaveBeenCalledOnce();
  });
});
