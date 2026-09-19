// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationWizard } from "./publication-wizard";
import { DEFAULT_AUTHORING, type AuthoringState, type PostIdea } from "@/lib/publications/authoring";
const channel="a1000000-0000-4000-8000-000000000001";
let savedAssets:string[]=[];
let state:AuthoringState; let fetchMock:ReturnType<typeof vi.fn>;let job:unknown;
const idea=(index:number):PostIdea=>({topic:`Идея ${index}`,goal:"Записи на обслуживание",cta:"Написать нам",audience:"Владельцы велосипедов",tone:"Экспертный",description:`Подробности ${index}`});
beforeEach(()=>{
  state={input:structuredClone(DEFAULT_AUTHORING),revision:0,step:1,ideas:[],ideas_key:"",active_job_id:null,variants:[]};job=null;savedAssets=[];
  fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
    if(_url.endsWith("/publish"))return Response.json({channels:[],deliveries:[]});
    if(init?.method==="POST"){
      const body=JSON.parse(init.body as string);
      if(body.action==="save"){state={...state,input:body.input,step:body.step,revision:state.revision+1};return Response.json(state);}
      if(body.action==="start"&&body.kind==="ideas"){
        state.ideas=[...state.ideas,...Array.from({length:3},(_,i)=>idea(state.ideas.length+i+1))];
        return Response.json({id:"job",status:"ready"});
      }
      if(body.action==="start"){
        job={id:"job",status:"ready",kind:body.kind,input_revision:state.revision,result:{title:"Готовый пост",variants:[{channelId:channel,body:"Готовый текст"}],assetIds:state.input.kind==="image"?[channel]:[]}};
        return Response.json(job);
      }
      if(body.action==="edit"){savedAssets=body.result.assetIds;state.variants=body.result.variants;state.step=6;state.revision++;return Response.json(state);}
    }
    return Response.json({state,channels:[{id:channel,name:"Мастерская",platform:"instagram"}],categories:[],configured:true,job,draft:{title:"Черновик",asset_ids:savedAssets,status:"waiting"}});
  });vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function start(){render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);await screen.findByText("Куда готовим публикацию?");fireEvent.click(screen.getByRole("checkbox",{name:/Мастерская/}));}
const actions=()=>fetchMock.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(init!.body as string));
describe("native publication wizard smoke",()=>{
  it("offers manual resume for stalled generation without automatically dispatching",async()=>{
    state.active_job_id="job";
    job={id:"job",kind:"ideas",status:"pending",stage:"queued",input_revision:0,updated_at:new Date(Date.now()-660000).toISOString()};
    render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);
    await screen.findByText(/Генерация давно не обновлялась/);
    expect(actions()).toEqual([]);
    fireEvent.click(screen.getByRole("button",{name:"Повторить запуск"}));
    await waitFor(()=>expect(actions()).toContainEqual({action:"retry",revision:0,jobId:"job"}));
  });
  it("retries failed generation using its existing job",async()=>{
    job={id:"job",kind:"ideas",status:"error",error:"Сервис недоступен",input_revision:0};
    render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);
    await screen.findByText("Сервис недоступен");
    fireEvent.click(screen.getByRole("button",{name:"Повторить незавершённые этапы"}));
    await waitFor(()=>expect(actions()).toContainEqual({action:"retry",revision:0,jobId:"job"}));
  });
  it("shows only connected channels and enables all four formats",async()=>{
    await start();expect(screen.getByRole("radio",{name:/Текст \+ карусель/}).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("radio",{name:/Сценарий для видео/}).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("Facebook")).toBeNull();
  });
  it("skips ideas and image settings for text, generates and saves the edited result",async()=>{
    await start();fireEvent.click(screen.getByRole("radio",{name:/Только текст/}));fireEvent.click(screen.getByRole("button",{name:"Далее"}));
    await screen.findByText("Идея и содержание");expect(actions().some(p=>p.action==="start")).toBe(false);
    expect(screen.queryByLabelText("Формат картинки")).toBeNull();
    fireEvent.change(screen.getByLabelText("О чём пост?"),{target:{value:"Осеннее обслуживание"}});
    fireEvent.change(screen.getByLabelText("Какой результат нужен?"),{target:{value:"Записи"}});
    fireEvent.click(screen.getByRole("button",{name:"Далее"}));await screen.findByText("Всё готово к генерации");
    fireEvent.click(screen.getByRole("button",{name:"Сгенерировать пост"}));
    const text=await screen.findByLabelText("Текст публикации");fireEvent.change(text,{target:{value:"Моя правка"}});
    fireEvent.click(screen.getByRole("button",{name:"Сохранить черновик"}));
    await waitFor(()=>expect(state.variants[0]?.body).toBe("Моя правка"));
  });
  it("appends ideas to twelve and transfers the selected idea to editable fields",async()=>{
    await start();fireEvent.click(screen.getByRole("button",{name:"Предложить идеи"}));
    await screen.findByRole("button",{name:"Выбрать идею 3"});
    for(const total of [6,9,12]){fireEvent.click(screen.getByRole("button",{name:/Ещё идеи/}));await screen.findByRole("button",{name:`Выбрать идею ${total}`});}
    expect(screen.getByRole("button",{name:"Показаны все 12 идей"}).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Выбрать идею 8"}));
    await screen.findByText("Идея и содержание");expect((screen.getByLabelText("О чём пост?") as HTMLInputElement).value).toBe("Идея 8");
    expect(screen.getByLabelText("Формат картинки")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Далее"}));await screen.findByText("Картинка для публикации");
  });
  it("restores saved inputs and never regenerates saved ideas on mount",async()=>{
    state.step=3;state.input.brief=idea(5);state.ideas=[idea(1),idea(2),idea(3)];
    render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);
    await screen.findByText("Идея и содержание");expect((screen.getByLabelText("О чём пост?") as HTMLInputElement).value).toBe("Идея 5");
    expect(actions()).toHaveLength(0);
  });
});

it("opens an instruction field and revises only the selected carousel slide",async()=>{
  state.step=6;state.input.kind="carousel";state.input.slides=["Hook","Conclusion"];state.input.channelIds=[channel];state.input.brief=idea(1);state.variants=[{channelId:channel,body:"Saved caption"}];savedAssets=[channel,"a1000000-0000-4000-8000-000000000002"];
  render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Действия: слайд 2"}));fireEvent.click(screen.getByRole("menuitem",{name:"Изменить с AI"}));
  expect(actions().filter(p=>p.action==="start")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Что изменить?"),{target:{value:"Сделай фон светлее"}});fireEvent.click(screen.getByRole("button",{name:"Предложить изменения"}));
  await waitFor(()=>expect(actions().find(p=>p.action==="start"&&p.kind==="image")?.revisionRequest).toEqual({instruction:"Сделай фон светлее",assetId:"a1000000-0000-4000-8000-000000000002"}));
});
it("reorders and removes carousel slides from the slide menu and saves the new order",async()=>{
  const second="a1000000-0000-4000-8000-000000000002";const third="a1000000-0000-4000-8000-000000000003";
  state.step=6;state.input.kind="carousel";state.input.slides=["Hook","Body","End"];state.input.channelIds=[channel];state.input.brief=idea(1);state.variants=[{channelId:channel,body:"Saved caption"}];savedAssets=[channel,second,third];
  render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Действия: слайд 1"}));
  expect(screen.getByRole("menuitem",{name:"Сдвинуть влево"}).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("menuitem",{name:"Сдвинуть вправо"}));
  fireEvent.click(screen.getByRole("button",{name:"Действия: слайд 3"}));fireEvent.click(screen.getByRole("menuitem",{name:"Удалить слайд"}));
  expect(screen.queryByRole("button",{name:"Действия: слайд 3"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Сохранить черновик"}));
  await waitFor(()=>expect(savedAssets).toEqual([second,channel]));
});
it("closes the slide menu with Escape and deletes the draft only after confirmation",async()=>{
  state.step=6;state.input.kind="carousel";state.input.slides=["Hook","End"];state.input.channelIds=[channel];state.input.brief=idea(1);state.variants=[{channelId:channel,body:"Saved caption"}];savedAssets=[channel,"a1000000-0000-4000-8000-000000000002"];
  render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Действия: слайд 1"}));
  expect(screen.getByRole("menu")).toBeTruthy();fireEvent.keyDown(document,{key:"Escape"});expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Действия с черновиком"}));fireEvent.click(screen.getByRole("menuitem",{name:"Удалить черновик"}));
  expect(screen.getByRole("dialog",{name:"Удалить черновик?"})).toBeTruthy();
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==="DELETE")).toBe(false);
});
it("keeps video scripts separate from publication controls",async()=>{
  state.step=6;state.input.kind="video";state.input.channelIds=[channel];state.variants=[{channelId:channel,body:"Сцена 1: вступление"}];
  render(<PublicationWizard draftId={channel} onClose={()=>{}}/>);
  await screen.findByRole("button",{name:"Скопировать сценарий"});expect(screen.queryByRole("button",{name:"Предпросмотр и публикация"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Изменить текст с AI"}));expect(screen.getByLabelText("Что изменить?")).toBeTruthy();
});
