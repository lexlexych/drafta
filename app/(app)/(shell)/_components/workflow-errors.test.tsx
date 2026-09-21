// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
import {WorkflowErrors} from './workflow-errors';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('manual Workflow recovery',()=>{
  it('does not repeat a failed auto reply until clicked',async()=>{
    const fetch=vi.fn(async(_url:string,init?:RequestInit)=>Response.json(init?.method==='POST'?{accepted:true}:{operations:[{id:'operation',kind:'auto-reply',status:'failed',subjectId:'message'}]}));vi.stubGlobal('fetch',fetch);
    render(<WorkflowErrors resourceId="conversation"/>);
    const button=await screen.findByRole('button',{name:'Повторить автоответ'});
    expect(fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true);
    fireEvent.click(button);
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/workflow-operations',expect.objectContaining({method:'POST',body:JSON.stringify({operationId:'operation',checked:false})})));
  });
  it('requires a channel check before retrying an uncertain delivery',async()=>{
    const fetch=vi.fn(async()=>Response.json({operations:[{id:'operation',kind:'send-message',status:'uncertain',subjectId:'message'}]}));vi.stubGlobal('fetch',fetch);
    const confirm=vi.fn().mockReturnValue(false);vi.stubGlobal('confirm',confirm);
    render(<WorkflowErrors resourceId="conversation"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Проверил: повторить'}));expect(confirm).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Проверил: повторить'}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/workflow-operations',expect.objectContaining({body:JSON.stringify({operationId:'operation',checked:true})})));
  });
});
