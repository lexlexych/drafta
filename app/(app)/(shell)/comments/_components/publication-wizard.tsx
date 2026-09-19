"use client";
/* eslint-disable @next/next/no-img-element -- Media is served by the authenticated workspace proxy. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_AUTHORING, EMPTY_IDEA, IDEA_FIELDS, generationIssue, ideaContextKey, type AuthoringInput, type AuthoringJob, type AuthoringResult, type AuthoringState, type ChannelChoice, type PostIdea, type RevisionRequest } from "@/lib/publications/authoring";
import { MAX_UPLOAD_BYTES } from "@/lib/publications/types";
import { generationStalled } from "@/lib/publications/progress";
import { ActionMenu } from "../../_components/action-menu";
import { ArrowLeftIcon, BackIcon, CarouselIcon, CheckIcon, CopyIcon, LightbulbIcon, PictureIcon, SparkIcon, TextIcon, TrashIcon, UploadIcon, VideoIcon, WandIcon } from "../../_components/icons";
import {PublicationPublish, DeletePublication} from "./publication-publish";
import { SlideBoard } from "./slide-board";
import styles from "./publication-wizard.module.css";

type WizardData = { state: AuthoringState; channels: ChannelChoice[]; categories: { id: string; name: string }[]; configured: boolean; job: AuthoringJob | null; draft: { title: string; asset_ids: string[]; status: string } };
const STAGES: Record<string,string> = { queued: "Генерация в очереди…", ideas: "Подбираем три идеи…", text: "Готовим тексты для выбранных каналов…", image: "Создаём картинку…", ready: "Готово" };
const PLATFORMS: Record<string,string> = { instagram: "Instagram", facebook: "Facebook", telegram: "Telegram", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
const KINDS: { id: AuthoringInput["kind"]; name: string; description: string; icon: ReactNode }[] = [
  { id: "image", name: "Текст + картинка", description: "Один визуал и текст поста", icon: <PictureIcon size={16} /> },
  { id: "carousel", name: "Текст + карусель", description: "Серия слайдов в едином стиле", icon: <CarouselIcon /> },
  { id: "text", name: "Только текст", description: "Публикация без изображения", icon: <TextIcon /> },
  { id: "video", name: "Сценарий для видео", description: "Для самостоятельной съёмки", icon: <VideoIcon /> },
];
const KIND_LABELS: Record<AuthoringInput["kind"], string> = { image: "Текст + картинка", text: "Только текст", carousel: "Текст + карусель", video: "Сценарий видео" };
const LANGUAGES = ["Русский", "Deutsch", "English", "Українська"];
const RATIOS: { id: AuthoringInput["aspectRatio"]; name: string; height: number }[] = [
  { id: "1:1", name: "Квадрат", height: 12 }, { id: "4:5", name: "Вертикальный", height: 15 }, { id: "9:16", name: "В полный рост", height: 20 },
];
const STYLES = ["Современная фотография", "Минималистичная иллюстрация", "Яркая графика", "Тёплая предметная фотография"];
const TEXT_LIMITS: Record<string, number> = { instagram: 2200, linkedin: 3000 };
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" }); const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить изменения."); return data;
}

function Pill({ type, name, checked, disabled, onChange, children }: { type: "checkbox" | "radio"; name?: string; checked: boolean; disabled?: boolean; onChange: () => void; children: ReactNode }) {
  return <label className={styles.pill}><input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange}/><span>{children}</span></label>;
}
function Lead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className={styles.lead}><h3>{title}</h3>{children&&<p>{children}</p>}</div>;
}
function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return <div className={styles.section}><div className={styles.sectionHead}><span className={styles.sectionLabel}>{label}</span>{aside}</div>{children}</div>;
}
function Dropzone({ title, hint, onFile }: { title: string; hint: string; onFile: (file: File) => void }) {
  return <label className={styles.dropzone}><input type="file" accept="image/png,image/jpeg,image/webp" aria-label={title} onChange={e=>{const file=e.target.files?.[0];if(file)onFile(file);e.target.value="";}}/><span className={styles.dropIcon}><UploadIcon/></span><span><strong>{title}</strong>{hint}</span></label>;
}

export function PublicationWizard({ draftId, onClose }: { draftId: string; onClose: () => void }) {
  const endpoint = `/api/publications/${draftId}/authoring`;
  const [data,setData] = useState<WizardData | null>(null);
  const [input,setInput] = useState<AuthoringInput>(()=>structuredClone(DEFAULT_AUTHORING));
  const [currentStep,setStep] = useState(1);
  const [error,setError] = useState(""); const [message,setMessage] = useState(""); const [busy,setBusy] = useState(false); const [saving,setSaving] = useState(false);
  const [result,setResult] = useState<AuthoringResult | null>(null); const [channelTab,setChannelTab] = useState("");
  const inputRef = useRef(input); const stepRef = useRef(currentStep); const revision = useRef(0); const dirty = useRef(false);
  const savingPromise = useRef<Promise<void> | null>(null); const resultDirty = useRef(false); const resultKey = useRef("");
  const [locked,setLocked]=useState(false);
  const [revisionTarget,setRevisionTarget]=useState<{kind:"text"|"image";assetId?:string}|null>(null);
  const [instruction,setInstruction]=useState("");
  const [edited,setEdited]=useState(false);
  const [deleteOpen,setDeleteOpen]=useState(false);
  const [allKnowledge,setAllKnowledge]=useState(false);
  const [statusTarget,setStatusTarget]=useState<HTMLDivElement|null>(null);
  const active = !!data?.state.active_job_id; const frozen = busy || active || locked;
  const post = useCallback((payload: Record<string,unknown>)=>api(endpoint,{ method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload) }),[endpoint]);
  const refresh = useCallback(async () => {
    const next: WizardData = await api(endpoint);
    setData(next);
    if (!dirty.current && !savingPromise.current && next.state.revision>=revision.current) {
      revision.current=next.state.revision; inputRef.current=next.state.input; stepRef.current=next.state.step;
      setInput(next.state.input); setStep(next.state.step);
    }
    const proposal = next.job?.status==="ready" && !["ideas","outline"].includes(next.job.kind) && next.job.input_revision===next.state.revision ? next.job.result : null;
    const key = proposal ? next.job!.id : `saved:${next.state.revision}`;
    if (!resultDirty.current && key!==resultKey.current && !dirty.current) {
      resultKey.current=key;
      setResult(proposal || (next.state.variants.length ? { title:next.draft.title,variants:next.state.variants,assetIds:next.draft.asset_ids } : null));
    }
  },[endpoint]);
  const flush = useCallback(async () => {
    if (savingPromise.current) { await savingPromise.current; }
    if (!dirty.current) return;
    const run = async () => {
      setSaving(true);
      try {
        while (dirty.current) {
          const snapshot=inputRef.current; const step=stepRef.current;
          const state: AuthoringState = await post({ action:"save",revision:revision.current,input:snapshot,step });
          revision.current=state.revision;
          if (snapshot===inputRef.current && step===stepRef.current) dirty.current=false;
        }
        setMessage("Изменения сохранены");
      } finally { setSaving(false); }
    };
    const promise=run(); savingPromise.current=promise;
    try { await promise; } finally { if(savingPromise.current===promise) savingPromise.current=null; }
  },[post]);
  useEffect(()=>{
    let mounted=true;
    const poll=()=>{ if(mounted) void refresh().catch(e=>{ if(mounted) setError(e.message); }); };
    poll(); const timer=setInterval(poll,4000);
    return ()=>{mounted=false;clearInterval(timer);};
  },[refresh]);
  useEffect(()=>{
    if (!dirty.current || frozen) return;
    const timer=setTimeout(()=>{void flush().catch(e=>setError(e.message));},700);
    return ()=>clearTimeout(timer);
  },[input,currentStep,flush,frozen]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(dirty.current || resultDirty.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[]);
  function change(next:AuthoringInput){inputRef.current=next;setInput(next);dirty.current=true;setMessage("");setError("");}
  function brief(key:keyof PostIdea,value:string){change({...input,brief:{...input.brief,[key]:value}});}
  async function perform(work:()=>Promise<void>){setBusy(true);setError("");try{await work();}catch(e){setError(e instanceof Error?e.message:"Не удалось выполнить действие.");await refresh().catch(()=>{});}finally{setBusy(false);}}
  async function go(step:number){stepRef.current=step;setStep(step);dirty.current=true;await flush();await refresh();}
  function toggle(key:"channelIds"|"kbIds",id:string){change({...input,[key]:input[key].includes(id)?input[key].filter(v=>v!==id):[...input[key],id]});}
  async function generate(kind:AuthoringJob["kind"],revisionRequest?:RevisionRequest){
    const issue=generationIssue(inputRef.current,kind);if(issue)throw new Error(issue);
    if(resultDirty.current)throw new Error("Сначала сохраните изменения текста.");
    await flush();
    await post({action:"start",kind,revision:revision.current,requestId:crypto.randomUUID(),revisionRequest});await refresh();
  }
  async function ideas(){await go(2);if(!data?.state.ideas.length)await generate("ideas");}
  async function choose(idea:PostIdea){change({...inputRef.current,brief:{...idea}});await go(3);}
  async function upload(file:File,key:"assetId"|"referenceId"){
    if(file.size>MAX_UPLOAD_BYTES)throw new Error("Выберите PNG, JPEG или WebP до 4 МБ.");
    const asset=await api(`/api/publications/${draftId}/assets?purpose=authoring`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});
    change({...inputRef.current,image:{...inputRef.current.image,[key]:asset.id}});await flush();
  }
  function edit(next:AuthoringResult){setResult(next);resultDirty.current=true;setEdited(true);}
  async function uploadResult(file:File,index?:number){
    if(!result)return;
    if(file.size>MAX_UPLOAD_BYTES)throw new Error("Выберите PNG, JPEG или WebP до 4 МБ.");
    const asset=await api(`/api/publications/${draftId}/assets?purpose=authoring`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});
    edit({...result,assetIds:index===undefined?[...result.assetIds,asset.id]:result.assetIds.map((id,i)=>i===index?asset.id:id)});
  }
  async function revise(){
    if(!revisionTarget||!instruction.trim())return;
    const request:RevisionRequest={instruction:instruction.trim(),...(revisionTarget.kind==="image"?{assetId:revisionTarget.assetId}:{channelId:selectedVariant?.channelId})};
    await saveResult();await go(5);await generate(revisionTarget.kind,request);setRevisionTarget(null);setInstruction("");
  }
  async function saveResult(){
    if(!result)return;await flush();
    await post({action:"edit",revision:revision.current,result});resultDirty.current=false;setEdited(false);resultKey.current="";await refresh();
    window.dispatchEvent(new Event("publication-changed"));setMessage("Черновик сохранён");
  }
  function openRevision(target:{kind:"text"|"image";assetId?:string}){setRevisionTarget(target);setInstruction("");}
  const proposal=!!data?.job && data.job.status==="ready" && !["ideas","outline"].includes(data.job.kind) && data.job.input_revision===data.state.revision;
  const showResult=!!result && !active && (currentStep===6 || (currentStep===5 && proposal));
  const steps=[{id:1,label:"Настройки"},{id:2,label:"Идеи",optional:true},{id:3,label:"Содержание"},...(["image","carousel"].includes(input.kind)?[{id:4,label:input.kind==="carousel"?"Слайды":"Картинка"}]:[]),{id:5,label:"Проверка"}];
  const selectedVariant=result?.variants.find(v=>v.channelId===channelTab)||result?.variants[0];
  const withImage=["image","carousel"].includes(input.kind);
  const channelOf=(id:string)=>data?.channels.find(c=>c.id===id);
  const stepperRef=useRef<HTMLOListElement|null>(null);
  const loaded=!!data;
  // На узком экране степпер прокручивается: держим текущий шаг в поле зрения.
  useEffect(()=>{const ol=stepperRef.current;const li=ol?.querySelector<HTMLElement>('[data-current="true"]');if(ol&&li&&ol.scrollWidth>ol.clientWidth)ol.scrollLeft=li.offsetLeft-ol.offsetLeft-16;},[currentStep,showResult,loaded]);

  if(!data)return <div className={styles.wizard}><div className={styles.content}><p role="status" className={styles.muted}>{error||"Загружаем черновик…"}</p><button className={styles.btn} onClick={onClose}>Закрыть</button></div></div>;

  const close=()=>void perform(async()=>{await flush();if(resultDirty.current&&!locked)await saveResult();onClose();});
  const back=(step:number)=><button className={styles.btn} disabled={frozen} onClick={()=>void perform(()=>go(step))}><ArrowLeftIcon/>Назад</button>;
  const limit=selectedVariant&&input.kind!=="video"?TEXT_LIMITS[channelOf(selectedVariant.channelId)?.platform||""]:undefined;
  const length=selectedVariant?Array.from(selectedVariant.body).length:0;

  const revisionBox=revisionTarget&&<div className={styles.revision}>
    <div className={styles.revisionHead}>{revisionTarget.kind==="image"&&revisionTarget.assetId&&<img src={`/api/publications/assets/${revisionTarget.assetId}`} alt=""/>}<WandIcon/>{revisionTarget.kind==="image"?"Изменить изображение с AI":"Изменить текст с AI"}</div>
    <label className={styles.field}><span className={styles.fieldLabel}>Что изменить?</span><textarea className={styles.input} autoFocus rows={2} maxLength={2000} value={instruction} onChange={e=>setInstruction(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&instruction.trim()&&!frozen){e.preventDefault();void perform(revise);}}} placeholder={revisionTarget.kind==="image"?"Сделай фон светлее, сохрани товар":"Сократи текст и убери рекламный тон. Для сценария можно указать номер сцены."}/></label>
    <div className={styles.actions}><button className={`${styles.btn} ${styles.btnGhost}`} onClick={()=>setRevisionTarget(null)}>Отмена</button><button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!instruction.trim()||frozen} onClick={()=>void perform(revise)}><SparkIcon/>Предложить изменения</button></div>
  </div>;

  let footer: ReactNode = null;
  if(showResult&&result){
    footer=<>
      {!locked&&<button className={`${styles.btn} ${styles.btnGhost}`} disabled={frozen} onClick={()=>void perform(async()=>{if(resultDirty.current)await saveResult();await go(3);})}><ArrowLeftIcon/>Изменить вводные</button>}
      <span className={styles.spacer}/>
      {input.kind==="video"&&<button className={styles.btn} onClick={()=>void perform(async()=>{await navigator.clipboard.writeText(selectedVariant?.body||"");setMessage("Сценарий скопирован");})}><CopyIcon/>Скопировать сценарий</button>}
      {!locked&&<button className={`${styles.btn} ${edited||proposal?styles.btnPrimary:""}`} disabled={frozen} onClick={()=>void perform(saveResult)}>Сохранить черновик</button>}
      <PublicationPublish draftId={draftId} kind={input.kind} result={result} statusTarget={statusTarget} primary={!(edited||proposal)||locked} onLockedChange={setLocked} beforePublish={async()=>{if(!locked)await saveResult();return String(revision.current);}}/>
    </>;
  } else if(currentStep===1){
    footer=<><button className={`${styles.btn} ${styles.btnGhost}`} disabled={frozen||!input.channelIds.length||!data.configured} onClick={()=>void perform(ideas)}><LightbulbIcon/>Предложить идеи</button><span className={styles.spacer}/><button className={`${styles.btn} ${styles.btnPrimary}`} disabled={frozen||!input.channelIds.length} onClick={()=>void perform(()=>go(3))}>Далее</button></>;
  } else if(currentStep===2){
    footer=<>{back(1)}<span className={styles.spacer}/><button className={styles.btn} disabled={frozen||data.state.ideas.length>=12||!data.configured} onClick={()=>void perform(()=>generate("ideas"))}>{data.state.ideas.length>=12?"Показаны все 12 идей":`Ещё идеи · ${data.state.ideas.length} из 12`}</button><button className={`${styles.btn} ${styles.btnPrimary}`} disabled={frozen} onClick={()=>void perform(()=>choose(input.brief.topic?input.brief:EMPTY_IDEA))}>Своя идея</button></>;
  } else if(currentStep===3){
    footer=<>{back(data.state.ideas.length?2:1)}<span className={styles.spacer}/><button className={`${styles.btn} ${styles.btnPrimary}`} disabled={frozen||!input.brief.topic.trim()||!input.brief.goal.trim()} onClick={()=>void perform(()=>go(withImage?4:5))}>Далее</button></>;
  } else if(currentStep===4){
    footer=<>{back(3)}<span className={styles.spacer}/><button className={`${styles.btn} ${styles.btnPrimary}`} disabled={frozen||(input.image.source==="upload"&&!input.image.assetId)} onClick={()=>void perform(()=>go(5))}>Далее</button></>;
  } else if(currentStep===5||currentStep===6){
    footer=<>{back(withImage?4:3)}<span className={styles.spacer}/><button className={`${styles.btn} ${styles.btnPrimary}`} disabled={frozen||!data.configured} onClick={()=>void perform(()=>generate("post"))}><SparkIcon/>{input.kind==="video"?"Создать сценарий":input.kind==="carousel"?"Создать текст и слайды":"Сгенерировать пост"}</button></>;
  }

  return <section className={styles.wizard} aria-label="Создание публикации через Drafta">
    <header className={styles.header}>
      <button className={styles.iconBtn} aria-label="Закрыть" title="Закрыть" disabled={busy||saving} onClick={close}><BackIcon size={18}/></button>
      <div className={styles.headerMain}>
        <div className={styles.titleRow}>
          <h2>{input.kind==="video"?"Сценарий видео":showResult?"Черновик публикации":"Создать публикацию"}</h2>
          {showResult
            ?(edited||message)&&<span className={styles.saveStatus} role="status" data-saving={edited}>{edited?"Есть несохранённые изменения":message}</span>
            :<span className={styles.saveStatus} role="status" data-saving={saving}>{saving?"Сохраняем…":message||"Сохраняется автоматически"}</span>}
          <ActionMenu label="Действия с черновиком" items={[{label:"Удалить черновик",icon:<TrashIcon/>,danger:true,disabled:busy||active,onSelect:()=>setDeleteOpen(true)}]}/>
        </div>
        <nav aria-label="Шаги создания публикации">
          <ol ref={stepperRef} className={styles.stepper}>
            {steps.map(step=>{const current=!showResult&&step.id===currentStep;const done=showResult||step.id<currentStep;return <li key={step.id} data-done={done&&!current} data-current={current}>
              <button disabled={frozen||showResult||step.id>currentStep} aria-current={current?"step":undefined} onClick={()=>void perform(()=>go(step.id))}>
                <span className={styles.stepNum}>{done&&!current?<CheckIcon size={11}/>:steps.indexOf(step)+1}</span><span className={styles.stepLabel}>{step.label}</span>{step.optional&&<span className={styles.stepOptional}>· необязательно</span>}
              </button></li>;})}
            {showResult&&<li data-current="true"><button disabled aria-current="step"><span className={styles.stepNum}>{steps.length+1}</span><span className={styles.stepLabel}>Черновик</span></button></li>}
          </ol>
        </nav>
      </div>
    </header>

    <div className={styles.scroll}>
      <div className={styles.content}>
        {error&&<div className={styles.banner} data-tone="error" role="alert"><span>{error}</span><button className={`${styles.btn} ${styles.btnSm}`} onClick={()=>void perform(async()=>{await flush();await refresh();setError("");})}>Повторить сохранение</button></div>}
        {!data.configured&&<div className={styles.banner} data-tone="draft"><span>Генерация Drafta ещё не настроена. Вводные можно сохранить, генерация станет доступна после настройки.</span></div>}
        {active&&!generationStalled(data.job)&&<div className={`${styles.banner} ${styles.progress}`} data-tone="draft" role="status"><span><span className={styles.spinner}/><span><strong>{STAGES[data.job?.stage||"queued"]||"Генерируем…"}</strong>Можно закрыть мастер и вернуться позже — результат сохранится здесь.</span></span></div>}
        {active&&generationStalled(data.job)&&<div className={styles.banner} data-tone="error" role="alert"><span>{data.job?.error || "Генерация давно не обновлялась. Можно повторить запуск незавершённых этапов."}</span><button className={`${styles.btn} ${styles.btnSm}`} disabled={busy||saving} onClick={()=>void perform(async()=>{await post({action:"retry",revision:revision.current,jobId:data.job!.id});await refresh();})}>Повторить запуск</button></div>}
        {data.job?.status==="error"&&<div className={styles.banner} data-tone="error" role="alert"><span>{data.job.error}</span><button className={`${styles.btn} ${styles.btnSm}`} disabled={frozen||saving||data.job.input_revision!==data.state.revision} onClick={()=>void perform(async()=>{await flush();await post({action:"retry",revision:revision.current,jobId:data.job!.id});await refresh();})}>Повторить незавершённые этапы</button></div>}

        {showResult&&result ? <>
          {locked?<div className={styles.banner} data-tone="ok"><span><CheckIcon/>Материал отправлен. Содержимое зафиксировано, статусы соцсетей — ниже.</span></div>
          :proposal?<div className={styles.banner} data-tone="draft"><span><SparkIcon/>Предложение AI. Проверьте и сохраните черновик — прежняя версия пока не изменена.</span><button className={`${styles.btn} ${styles.btnSm}`} disabled={busy||active} onClick={()=>void perform(async()=>{await post({action:"discard",revision:revision.current});resultDirty.current=false;setEdited(false);resultKey.current="";await refresh();})} aria-label="Отклонить предложение AI">Отклонить</button></div>
          :input.kind==="video"?<div className={styles.banner} data-tone="ok"><span><CheckIcon/>Сценарий для самостоятельной съёмки. Сохраните или скопируйте его.</span></div>
          :<div className={styles.banner} data-tone="ok"><span><CheckIcon/>Черновик сохранён. В соцсети ещё не отправлен.</span></div>}
          <div ref={setStatusTarget} className={styles.statusSlot}/>

          <fieldset disabled={frozen} className={styles.form}>
            <label className={styles.field}><span className={styles.srOnly}>Название черновика</span><input className={styles.titleInput} maxLength={200} value={result.title} placeholder="Название черновика" onChange={e=>edit({...result,title:e.target.value})}/></label>

            {result.assetIds.length>0&&<Section label={input.kind==="carousel"?`Слайды · ${result.assetIds.length}`:"Изображение"} aside={input.kind==="carousel"&&!locked&&<span className={styles.muted}>Перетащите, чтобы изменить порядок</span>}>
              <SlideBoard assetIds={result.assetIds} carousel={input.kind==="carousel"} aspectRatio={input.aspectRatio} disabled={frozen} readOnly={locked}
                onReorder={ids=>edit({...result,assetIds:ids})}
                onReplace={(index,file)=>void perform(()=>uploadResult(file,index))}
                onAdd={file=>void perform(()=>uploadResult(file))}
                onRemove={id=>edit({...result,assetIds:result.assetIds.filter(a=>a!==id)})}
                onRevise={id=>openRevision({kind:"image",assetId:id})}/>
              {revisionTarget?.kind==="image"&&revisionBox}
            </Section>}

            {selectedVariant&&<Section label={input.kind==="video"?"Сценарий":"Текст публикации"}>
              <div className={styles.editor}>
                <div className={styles.editorBar}>
                  <div className={styles.tabs} role="tablist" aria-label="Версии каналов">{result.variants.map(v=>{const channel=channelOf(v.channelId);return <button key={v.channelId} type="button" role="tab" aria-selected={selectedVariant.channelId===v.channelId} onClick={()=>setChannelTab(v.channelId)}><span className={styles.dot} data-platform={channel?.platform}/>{channel?.name||"Отключённый канал"}</button>;})}</div>
                  {!locked&&<button type="button" className={`${styles.btn} ${styles.btnAi} ${styles.btnSm}`} aria-label="Изменить текст с AI" onClick={()=>openRevision({kind:"text"})}><WandIcon/>Изменить с AI</button>}
                </div>
                <label><span className={styles.srOnly}>{input.kind==="video"?"Сценарий: сцены, реплики и хронометраж":"Текст публикации"}</span><textarea className={styles.editorText} rows={10} maxLength={20000} value={selectedVariant.body} onChange={e=>edit({...result,variants:result.variants.map(v=>v.channelId===selectedVariant.channelId?{...v,body:e.target.value}:v)})}/></label>
                <div className={styles.editorFoot} data-over={!!limit&&length>limit}>{limit?`${length} / ${limit}`:`${length} символов`}</div>
              </div>
              {revisionTarget?.kind==="text"&&revisionBox}
            </Section>}
          </fieldset>
        </> : <fieldset className={styles.form} disabled={frozen}>
          {currentStep===1&&<>
            <Lead title="Куда готовим публикацию?">Выберите каналы, тип публикации и знания, на которые опирается Drafta.</Lead>
            <Section label="Каналы">
              {!data.channels.length&&<p className={styles.muted}>Сначала <Link className={styles.linkBtn} href="/settings/channels">подключите канал</Link>.</p>}
              <div className={styles.pills}>{data.channels.filter(c=>["instagram","linkedin"].includes(c.platform)).map(channel=><Pill key={channel.id} type="checkbox" checked={input.channelIds.includes(channel.id)} onChange={()=>toggle("channelIds",channel.id)}><span className={styles.dot} data-platform={channel.platform}/>{channel.name}<small>{PLATFORMS[channel.platform]||channel.platform}</small></Pill>)}</div>
              {input.channelIds.some(id=>!data.channels.some(c=>c.id===id))&&<p className={styles.error}>Есть отключённый канал. <button className={styles.linkBtn} onClick={()=>change({...input,channelIds:input.channelIds.filter(id=>data.channels.some(c=>c.id===id))})}>Убрать из выбора</button></p>}
            </Section>
            <Section label="Тип публикации">
              <div className={styles.typeGrid}>{KINDS.map(type=><label key={type.id} className={styles.typeCard}><input type="radio" name="publication-kind" checked={input.kind===type.id} onChange={()=>change({...input,kind:type.id,...(type.id==="carousel"?{slides:input.slides??Array(5).fill(""),image:{...input.image,source:"generate"}}:{}),...(type.id==="video"?{video:input.video??{duration:60,format:"Разговор в кадре"}}:{})})}/><span><span className={styles.typeIcon}>{type.icon}</span><strong>{type.name}</strong><small>{type.description}</small></span></label>)}</div>
              {input.kind==="text"&&input.channelIds.some(id=>channelOf(id)?.platform==="instagram")&&<div className={styles.banner} data-tone="draft"><span>Instagram требует изображение. Текстовый черновик можно подготовить, но опубликовать без картинки получится только в LinkedIn.</span></div>}
            </Section>
            <Section label="Язык поста">
              <div className={styles.pills} role="radiogroup" aria-label="Язык поста">{LANGUAGES.map(language=><Pill key={language} type="radio" name="publication-language" checked={input.language===language} onChange={()=>change({...input,language})}>{language}</Pill>)}</div>
            </Section>
            <Section label="База знаний" aside={data.categories.length>12&&<button className={styles.linkBtn} onClick={()=>setAllKnowledge(v=>!v)}>{allKnowledge?"Свернуть":`Показать все · ${data.categories.length}`}</button>}>
              {data.categories.length>0?<div className={`${styles.pills} ${styles.knowledge}`} data-expanded={allKnowledge}>{data.categories.map(category=><Pill key={category.id} type="checkbox" checked={input.kbIds.includes(category.id)} onChange={()=>toggle("kbIds",category.id)}>{category.name}</Pill>)}</div>
                :<p className={styles.muted}>База знаний пока пуста. Можно описать бизнес на шаге содержания.</p>}
              {data.categories.length>0&&!input.kbIds.length&&<p className={styles.muted}>Без базы знаний идеи будут общими. Добавьте факты о бизнесе на шаге содержания.</p>}
              {input.kbIds.some(id=>!data.categories.some(c=>c.id===id))&&<p><button className={styles.linkBtn} onClick={()=>change({...input,kbIds:input.kbIds.filter(id=>data.categories.some(c=>c.id===id))})}>Убрать недоступные знания</button></p>}
            </Section>
          </>}

          {currentStep===2&&<>
            <Lead title="Выберите идею для поста">Каждую идею можно отредактировать на следующем шаге.</Lead>
            {data.state.ideas.length>0&&data.state.ideas_key!==ideaContextKey(input)&&<div className={styles.banner} data-tone="draft"><span>Эти идеи подготовлены по предыдущим настройкам. Новые предложения учтут текущий выбор.</span></div>}
            <div className={styles.ideas}>{data.state.ideas.map((idea,index)=><article key={index} className={styles.idea}>
              <span className={styles.ideaNum}>{index+1}</span>
              <h4>{idea.topic}</h4><p>{idea.description}</p>
              <details><summary>Цель, аудитория и подача</summary><dl>{IDEA_FIELDS.filter(f=>!["topic","description"].includes(f.key)).map(f=><div key={f.key}><dt>{f.label}</dt><dd>{idea[f.key]||"Не задано"}</dd></div>)}</dl></details>
              <button className={`${styles.btn} ${styles.btnSm}`} aria-label={`Выбрать идею ${index+1}`} onClick={()=>void perform(()=>choose(idea))}>Выбрать</button>
            </article>)}</div>
          </>}

          {currentStep===3&&<>
            <Lead title="Идея и содержание">Расскажите, что важно. Все предложенные формулировки можно изменить.</Lead>
            <div className={styles.grid2}>{IDEA_FIELDS.map(f=><label key={f.key} className={`${styles.field} ${["topic","description"].includes(f.key)?styles.wide:""}`}>
              <span className={styles.fieldLabel}>{f.label}{f.key==="cta"&&<small>необязательно</small>}</span>
              {f.key==="description"?<textarea className={styles.input} rows={5} maxLength={f.limit} value={input.brief[f.key]} onChange={e=>brief(f.key,e.target.value)} placeholder="Факты, подробности, ограничения и пожелания к посту"/>:<input className={styles.input} maxLength={f.limit} value={input.brief[f.key]} onChange={e=>brief(f.key,e.target.value)} required={f.key==="topic"||f.key==="goal"}/>}
            </label>)}</div>
            {withImage&&<Section label="Формат картинки"><div className={styles.pills} role="radiogroup" aria-label="Формат картинки">{RATIOS.map(ratio=><Pill key={ratio.id} type="radio" name="publication-ratio" checked={input.aspectRatio===ratio.id} onChange={()=>change({...input,aspectRatio:ratio.id})}><span className={styles.ratio} style={{height:ratio.height}}/>{ratio.id}<small>{ratio.name}</small></Pill>)}</div></Section>}
            {input.kind==="video"&&<div className={styles.grid2}>
              <label className={styles.field}><span className={styles.fieldLabel}>Длительность, секунд</span><input className={styles.input} type="number" min={15} max={600} value={input.video?.duration??60} onChange={e=>change({...input,video:{duration:Number(e.target.value),format:input.video?.format??"Разговор в кадре"}})}/></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Формат съёмки</span><input className={styles.input} maxLength={500} value={input.video?.format??"Разговор в кадре"} onChange={e=>change({...input,video:{duration:input.video?.duration??60,format:e.target.value}})}/></label>
            </div>}
          </>}

          {currentStep===4&&<>
            <Lead title="Картинка для публикации">Формат {input.aspectRatio}. {input.kind==="carousel"?"Единый формат и стиль для всех слайдов.":"Одна картинка для выбранных каналов."}</Lead>
            {input.kind==="carousel"&&<Section label="Структура карусели" aside={<button className={styles.linkBtn} disabled={!data.configured} onClick={()=>void perform(()=>generate("outline"))}><SparkIcon/> Предложить структуру слайдов</button>}>
              <div className={styles.actions}><span className={styles.fieldLabel}>Количество слайдов</span><div className={styles.counter}>
                {(()=>{const count=input.slides?.length??5;const setCount=(n:number)=>change({...input,slides:Array.from({length:n},(_,i)=>input.slides?.[i]??"")});return <><button type="button" aria-label="Меньше слайдов" disabled={count<=2} onClick={()=>setCount(count-1)}>−</button><output aria-label="Количество слайдов">{count}</output><button type="button" aria-label="Больше слайдов" disabled={count>=10} onClick={()=>setCount(count+1)}>+</button></>;})()}
              </div></div>
              <div className={styles.slideOutline}>{(input.slides??Array(5).fill("")).map((slide,index)=><div key={index} className={styles.slideOutlineItem}><span className={styles.ideaNum}>{index+1}</span><label className={styles.field}><span className={styles.srOnly}>Слайд {index+1}: текст и визуал</span><textarea className={styles.input} rows={2} maxLength={2000} value={slide} placeholder={index===0?"Обложка: цепляющий заголовок":"Текст и визуал слайда"} onChange={e=>change({...input,slides:(input.slides??Array(5).fill("")).map((v,i)=>i===index?e.target.value:v)})}/></label></div>)}</div>
            </Section>}
            {input.kind!=="carousel"&&<Section label="Источник картинки"><div className={styles.pills} role="radiogroup" aria-label="Источник картинки">
              <Pill type="radio" name="publication-image-source" checked={input.image.source==="generate"} onChange={()=>change({...input,image:{...input.image,source:"generate"}})}><SparkIcon/>Сгенерировать AI</Pill>
              <Pill type="radio" name="publication-image-source" checked={input.image.source==="upload"} onChange={()=>change({...input,image:{...input.image,source:"upload"}})}><UploadIcon/>Загрузить свою</Pill>
            </div></Section>}
            {input.image.source==="upload"?<Section label="Готовая картинка">
              {input.image.assetId?<div className={styles.thumbRow}><img className={styles.thumb} src={`/api/publications/assets/${input.image.assetId}`} alt="Загруженная картинка"/><Dropzone title="Заменить картинку" hint="PNG, JPEG, WebP до 4 МБ" onFile={file=>void perform(()=>upload(file,"assetId"))}/></div>
                :<Dropzone title="Загрузить картинку" hint="PNG, JPEG, WebP до 4 МБ" onFile={file=>void perform(()=>upload(file,"assetId"))}/>}
              <p className={styles.muted}>Используем оригинал. AI не изменяет загруженную картинку.</p>
            </Section>:<>
              <label className={styles.field}><span className={styles.fieldLabel}>Что изобразить?</span><textarea className={styles.input} rows={3} maxLength={4000} value={input.image.description} onChange={e=>change({...input,image:{...input.image,description:e.target.value}})} placeholder="Оставьте пустым, чтобы Drafta предложила визуал по содержанию поста"/></label>
              <Section label="Визуальный стиль">
                <div className={styles.pills}>{STYLES.map(style=><Pill key={style} type="radio" name="publication-style" checked={input.image.style===style} onChange={()=>change({...input,image:{...input.image,style}})}>{style}</Pill>)}</div>
                <input className={styles.input} aria-label="Визуальный стиль" maxLength={500} value={STYLES.includes(input.image.style)?"":input.image.style} placeholder="Или опишите свой стиль" onChange={e=>change({...input,image:{...input.image,style:e.target.value}})}/>
              </Section>
              <details className={styles.extra}><summary>Цвета, надпись и референс</summary><div>
                <div className={styles.grid2}>
                  <label className={styles.field}><span className={styles.fieldLabel}>Цвета</span><input className={styles.input} maxLength={500} value={input.image.colors} onChange={e=>change({...input,image:{...input.image,colors:e.target.value}})}/></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Надпись на картинке<small>необязательно</small></span><input className={styles.input} maxLength={500} value={input.image.caption} onChange={e=>change({...input,image:{...input.image,caption:e.target.value}})}/></label>
                </div>
                {input.image.referenceId?<div className={styles.thumbRow}><img className={styles.thumb} src={`/api/publications/assets/${input.image.referenceId}`} alt="Визуальный референс"/><button className={`${styles.btn} ${styles.btnSm}`} onClick={()=>change({...input,image:{...input.image,referenceId:null}})}>Убрать референс</button></div>
                  :<Dropzone title="Визуальный референс" hint="Необязательно · до 4 МБ" onFile={file=>void perform(()=>upload(file,"referenceId"))}/>}
              </div></details>
            </>}
          </>}

          {(currentStep===5||currentStep===6)&&<>
            <Lead title="Всё готово к генерации">Проверьте вводные. Сначала создадим черновик для вашей проверки — в соцсети ничего не уйдёт.</Lead>
            <div className={styles.summary}>
              <div className={styles.summaryGroup}><dl>
                <dt>Каналы</dt><dd>{input.channelIds.map(id=>channelOf(id)?.name||"Отключённый канал").join(", ")}</dd>
                <dt>База знаний</dt><dd>{input.kbIds.map(id=>data.categories.find(c=>c.id===id)?.name||"Недоступный элемент").join(", ")||"Без базы знаний"}</dd>
                <dt>Тип и язык</dt><dd>{KIND_LABELS[input.kind]} · {input.language}</dd>
              </dl><button className={styles.linkBtn} onClick={()=>void perform(()=>go(1))}>Изменить</button></div>
              <div className={styles.summaryGroup}><dl>{IDEA_FIELDS.map(f=><SummaryRow key={f.key} label={f.label} value={input.brief[f.key]||"Не задано"}/>)}</dl><button className={styles.linkBtn} onClick={()=>void perform(()=>go(3))}>Изменить</button></div>
              {withImage&&<div className={styles.summaryGroup}><dl>
                <dt>Картинка</dt><dd>{input.aspectRatio} · {input.kind==="carousel"?`${input.slides?.length??5} слайдов · ${input.image.style}`:input.image.source==="upload"?"Своя картинка":input.image.style}</dd>
              </dl><button className={styles.linkBtn} onClick={()=>void perform(()=>go(4))}>Изменить</button></div>}
            </div>
            <p className={styles.muted}>Используем выбранные знания и вводные через OpenAI API. Изображения генерируются только после нажатия кнопки.</p>
          </>}
        </fieldset>}
      </div>
    </div>

    {footer&&<footer className={styles.footer}><div className={styles.footerInner}>{footer}</div></footer>}
    <DeletePublication draftId={draftId} variant="none" open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onClose} disabled={busy||active}/>
  </section>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd>{value}</dd></>;
}
