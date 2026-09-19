// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {PublicationPublish,DeletePublication} from "./publication-publish";
const channels=[{id:"ig",name:"Магазин Instagram",platform:"instagram"},{id:"li",name:"Магазин LinkedIn",platform:"linkedin"}];
const result={title:"Post",variants:[{channelId:"ig",body:"Instagram caption"},{channelId:"li",body:"LinkedIn caption"}],assetIds:["image"]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("publishing UI smoke",()=>{
 it.each(["failed","sending","uncertain"])("manually retries or checks only the selected %s destination",async(status)=>{
  const deliveries=[{id:"one",channel_id:"ig",status:"published",error:null},{id:"two",channel_id:"li",status,error:null}];
  const fetch=vi.fn(async()=>Response.json({channels,deliveries}));vi.stubGlobal("fetch",fetch);
  render(<PublicationPublish draftId="draft" kind="image" result={result} beforePublish={async()=>"2"}/>);
  const retry=await screen.findByRole("button",{name:status==="failed"?"Повторить":"Проверить статус"});
  expect(fetch.mock.calls).toHaveLength(1);
  fireEvent.click(retry);
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith("/api/publications/draft/publish",expect.objectContaining({method:"POST",body:JSON.stringify({channelIds:["li"],version:"2"})})));
 });
 it("previews both versions and selects only the failed destination on retry",async()=>{
  const deliveries=[{id:"one",channel_id:"ig",status:"published",published_url:"https://instagram.com/post",error:null},{id:"two",channel_id:"li",status:"failed",published_url:null,error:"Temporary error"}];
  const fetch=vi.fn(async(_url:string,init?:RequestInit)=>Response.json(init?.method==="POST"?{deliveries}:{channels,deliveries:[]}));vi.stubGlobal("fetch",fetch);
  const save=vi.fn().mockResolvedValue("2");render(<PublicationPublish draftId="draft" kind="image" result={result} beforePublish={save}/>);
  await waitFor(()=>expect(fetch).toHaveBeenCalled());fireEvent.click(screen.getByRole("button",{name:"Предпросмотр и публикация"}));
  await screen.findByText("Instagram caption");expect(screen.getByText("LinkedIn caption")).toBeTruthy();expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Опубликовать сейчас"}));await screen.findByRole("link",{name:/Открыть пост/});
  const posts=()=>fetch.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(init!.body as string));expect(posts()[0]).toEqual({channelIds:["ig","li"],version:"2"});
  fireEvent.click(screen.getByRole("button",{name:"Предпросмотр и публикация"}));
  expect((screen.getByRole("checkbox",{name:/Магазин Instagram/}) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Опубликовать сейчас"}));await waitFor(()=>expect(posts()[1]).toEqual({channelIds:["li"],version:"2"}));
 });
 it("keeps text-only Instagram out of destinations",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({channels,deliveries:[]})));
  render(<PublicationPublish draftId="draft" kind="text" result={{...result,assetIds:[]}} beforePublish={async()=>"1"}/>);
  fireEvent.click(screen.getByRole("button",{name:"Предпросмотр и публикация"}));
  await screen.findByRole("checkbox",{name:/Магазин LinkedIn/});expect(screen.queryByRole("checkbox",{name:/Магазин Instagram/})).toBeNull();
 });
 it("requires deletion confirmation and shows a generation conflict without closing the editor",async()=>{
  const fetch=vi.fn(async()=>Response.json({error:"Дождитесь завершения генерации"},{status:409}));vi.stubGlobal("fetch",fetch);const deleted=vi.fn();
  render(<DeletePublication draftId="draft" onDeleted={deleted}/>);fireEvent.click(screen.getByRole("button",{name:"Удалить черновик"}));expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Удалить окончательно"}));await screen.findByText("Дождитесь завершения генерации");expect(deleted).not.toHaveBeenCalled();
 });
});
