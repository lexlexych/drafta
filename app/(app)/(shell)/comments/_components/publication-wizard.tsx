"use client";
/* eslint-disable @next/next/no-img-element -- Media is served by the authenticated workspace proxy. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_AUTHORING, EMPTY_IDEA, IDEA_FIELDS, generationIssue, ideaContextKey, type AuthoringInput, type AuthoringJob, type AuthoringResult, type AuthoringState, type ChannelChoice, type PostIdea, type RevisionRequest } from "@/lib/publications/authoring";
import { MAX_UPLOAD_BYTES } from "@/lib/publications/types";
import {PublicationPublish, DeletePublication} from "./publication-publish";
import styles from "./publication-wizard.module.css";

type WizardData = { state: AuthoringState; channels: ChannelChoice[]; categories: { id: string; name: string }[]; configured: boolean; job: AuthoringJob | null; draft: { title: string; asset_ids: string[]; status: string } };
const STAGES: Record<string,string> = { queued: "Генерация в очереди…", ideas: "Подбираем три идеи…", text: "Готовим тексты для выбранных каналов…", image: "Создаём картинку…", ready: "Готово" };
const PLATFORMS: Record<string,string> = { instagram: "Instagram", facebook: "Facebook", telegram: "Telegram", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" }); const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить изменения."); return data;
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
  async function perform(work:()=>Promise<void>){setBusy(true);setError("");try{await work();}catch(e){setError(e instanceof Error?e.message:"Не удалось выполнить действие.");}finally{setBusy(false);}}
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
  async function uploadResult(file:File,index?:number){
    if(!result)return;
    if(file.size>MAX_UPLOAD_BYTES)throw new Error("Выберите PNG, JPEG или WebP до 4 МБ.");
    const asset=await api(`/api/publications/${draftId}/assets?purpose=authoring`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});
    setResult({...result,assetIds:index===undefined?[...result.assetIds,asset.id]:result.assetIds.map((id,i)=>i===index?asset.id:id)});resultDirty.current=true;
  }
  function moveAsset(index:number,offset:number){if(!result)return;const ids=[...result.assetIds];[ids[index],ids[index+offset]]=[ids[index+offset],ids[index]];setResult({...result,assetIds:ids});resultDirty.current=true;}
  async function revise(){
    if(!revisionTarget||!instruction.trim())return;
    const request:RevisionRequest={instruction:instruction.trim(),...(revisionTarget.kind==="image"?{assetId:revisionTarget.assetId}:{channelId:selectedVariant?.channelId})};
    await saveResult();await go(5);await generate(revisionTarget.kind,request);setRevisionTarget(null);setInstruction("");
  }
  async function saveResult(){
    if(!result)return;await flush();
    await post({action:"edit",revision:revision.current,result});resultDirty.current=false;resultKey.current="";await refresh();
    window.dispatchEvent(new Event("publication-changed"));setMessage("Черновик сохранён");
  }
  const proposal=!!data?.job && data.job.status==="ready" && !["ideas","outline"].includes(data.job.kind) && data.job.input_revision===data.state.revision;
  const showResult=!!result && !active && (currentStep===6 || (currentStep===5 && proposal));
  const steps=[{id:1,label:"Настройки"},{id:2,label:"Идеи",optional:true},{id:3,label:"Содержание"},...(["image","carousel"].includes(input.kind)?[{id:4,label:input.kind==="carousel"?"Слайды":"Картинка"}]:[]),{id:5,label:"Проверка"}];
  const selectedVariant=result?.variants.find(v=>v.channelId===channelTab)||result?.variants[0];
  if(!data)return <div className={styles.wizard}><p role="status">{error||"Загружаем черновик…"}</p><button onClick={onClose}>Закрыть</button></div>;
  return <section className={styles.wizard} aria-label="Создание публикации через Drafta">
    <header className={styles.header}><div><span className={styles.eyebrow}>ПУБЛИКАЦИИ / DRAFTA</span><h2>{input.kind==="video"?"Сценарий видео":showResult?"Черновик публикации":"Создать публикацию"}</h2></div>
      <button className={styles.secondary} disabled={busy||saving} onClick={()=>void perform(async()=>{await flush();if(resultDirty.current&&!locked)await saveResult();onClose();})}>Закрыть</button></header>
    {error&&<p className={styles.error} role="alert">{error} <button onClick={()=>void perform(async()=>{await flush();await refresh();setError("");})}>Повторить сохранение</button></p>}
    {!data.configured&&<p className={styles.notice}>Генерация Drafta ещё не настроена. Вводные можно сохранить; пока доступно создание через ChatGPT.</p>}
    <div className={styles.layout}>
      <nav aria-label="Шаги создания публикации" className={styles.steps}><ol>{steps.map(step=><li key={step.id}><button disabled={frozen||showResult||step.id>currentStep} aria-current={!showResult&&step.id===currentStep?"step":undefined} onClick={()=>void perform(()=>go(step.id))}><span>{step.id}</span><div>{step.label}{step.optional&&<small>Необязательно</small>}</div></button></li>)}</ol>
        <p className={styles.saveStatus} role="status">{saving?"Сохраняем…":message||"Вводные сохраняются автоматически"}</p>
      </nav>
      <div className={styles.content}>
      {active&&<div className={styles.progress} role="status"><span className={styles.spinner}/><div><strong>{STAGES[data.job?.stage||"queued"]||"Генерируем…"}</strong><p>Можно закрыть мастер и вернуться позже. Результат сохранится здесь.</p></div></div>}
      {data.job?.status==="error"&&<div className={styles.notice} role="alert"><p>{data.job.error}</p><button className={styles.secondary} disabled={frozen||saving||data.job.input_revision!==data.state.revision} onClick={()=>void perform(async()=>{await flush();await post({action:"retry",revision:revision.current,jobId:data.job!.id});await refresh();})}>Повторить незавершённые этапы</button></div>}
      {showResult&&result ? <div className={styles.form}>
        <p className={styles.notice}>{locked?"Материал отправлен. Статусы соцсетей показаны ниже.":input.kind==="video"?"Сценарий для самостоятельной съёмки. Сохраните или скопируйте его.":proposal?"Проверьте предложенный результат и сохраните черновик. Предыдущая сохранённая версия пока не изменена.":"Черновик сохранён. Публикация в каналы ещё не отправлена."}</p>
        <fieldset disabled={frozen} className={styles.form}><label>Название черновика<input maxLength={200} value={result.title} onChange={e=>{setResult({...result,title:e.target.value});resultDirty.current=true;}}/></label>
        <div className={styles.tabs} role="tablist" aria-label="Версии каналов">{result.variants.map(v=><button key={v.channelId} role="tab" aria-selected={selectedVariant?.channelId===v.channelId} onClick={()=>setChannelTab(v.channelId)}>{data.channels.find(c=>c.id===v.channelId)?.name||"Отключённый канал"}</button>)}</div>
        {selectedVariant&&<label>{input.kind==="video"?"Сценарий: сцены, реплики и хронометраж":"Текст публикации"}<textarea rows={12} maxLength={20000} value={selectedVariant.body} onChange={e=>{setResult({...result,variants:result.variants.map(v=>v.channelId===selectedVariant.channelId?{...v,body:e.target.value}:v)});resultDirty.current=true;}}/></label>}
        <div className={styles.slideGrid}>{result.assetIds.map((id,index)=><article key={id} className={styles.slideCard}>
          <strong>{input.kind==="carousel"?`Слайд ${index+1}`:"Изображение"}</strong><img className={styles.resultImage} src={`/api/publications/assets/${id}`} alt={`Изображение ${index+1}`}/>
          <button className={styles.secondary} onClick={()=>{setRevisionTarget({kind:"image",assetId:id});setInstruction("");}}>Изменить изображение с AI</button>
          <label>Заменить своим<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void perform(()=>uploadResult(file,index));e.target.value="";}}/></label>
          {input.kind==="carousel"&&<div className={styles.actions}><button disabled={index===0} aria-label={`Слайд ${index+1} влево`} onClick={()=>moveAsset(index,-1)}>←</button><button disabled={index===result.assetIds.length-1} aria-label={`Слайд ${index+1} вправо`} onClick={()=>moveAsset(index,1)}>→</button><button disabled={result.assetIds.length<=2} onClick={()=>{setResult({...result,assetIds:result.assetIds.filter(a=>a!==id)});resultDirty.current=true;}}>Удалить слайд</button></div>}
        </article>)}</div>
        {input.kind==="carousel"&&result.assetIds.length<10&&<label>Добавить свой слайд<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void perform(()=>uploadResult(file));e.target.value="";}}/></label>}
        {revisionTarget&&<div className={styles.revisionForm}><label>Что изменить?<textarea autoFocus rows={3} maxLength={2000} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder={revisionTarget.kind==="image"?"Сделай фон светлее, сохрани товар":"Сократи текст и убери рекламный тон. Для сценария можно указать номер сцены."}/></label><div className={styles.actions}><button className={styles.primary} disabled={!instruction.trim()||frozen} onClick={()=>void perform(revise)}>Предложить изменения</button><button className={styles.secondary} onClick={()=>setRevisionTarget(null)}>Отмена</button></div></div>}
        <div className={styles.actions}><button className={styles.primary} disabled={frozen} onClick={()=>void perform(saveResult)}>Сохранить черновик</button>
          <button className={styles.secondary} disabled={frozen} onClick={()=>{setRevisionTarget({kind:"text"});setInstruction("");}}>Изменить текст с AI</button>
          
          <button className={styles.secondary} disabled={frozen} onClick={()=>void perform(async()=>{if(resultDirty.current)await saveResult();await go(3);})}>Изменить вводные</button>
        </div></fieldset>
        {proposal&&<button className={styles.secondary} disabled={busy||active} onClick={()=>void perform(async()=>{await post({action:"discard",revision:revision.current});resultDirty.current=false;resultKey.current="";await refresh();})}>Отклонить предложение AI</button>}
        {input.kind==="video"&&<button className={styles.secondary} onClick={()=>void perform(async()=>{await navigator.clipboard.writeText(selectedVariant?.body||"");setMessage("Сценарий скопирован");})}>Скопировать сценарий</button>}
        {locked&&<p className={styles.notice}>Содержимое зафиксировано при отправке. Статус каждой соцсети показан ниже.</p>}
        <PublicationPublish draftId={draftId} kind={input.kind} result={result} onLockedChange={setLocked} beforePublish={async()=>{if(!locked)await saveResult();return String(revision.current);}}/>
      </div> : <>
      <fieldset className={styles.form} disabled={frozen}>
      {currentStep===1&&<>
        <div><h3>Куда готовим публикацию?</h3><p className={styles.muted}>Выберите один или несколько подключённых каналов.</p>
          {!data.channels.length&&<p>Сначала <Link href="/settings/channels">подключите канал</Link>.</p>}
          <div className={styles.cards}>{data.channels.filter(c=>["instagram","linkedin"].includes(c.platform)).map(channel=><label key={channel.id} className={styles.choice} data-selected={input.channelIds.includes(channel.id)}><input type="checkbox" checked={input.channelIds.includes(channel.id)} onChange={()=>toggle("channelIds",channel.id)}/><span><strong>{channel.name}</strong><small>{PLATFORMS[channel.platform]||channel.platform}</small></span></label>)}</div>
          {input.channelIds.some(id=>!data.channels.some(c=>c.id===id))&&<p className={styles.error}>Есть отключённый канал. <button onClick={()=>change({...input,channelIds:input.channelIds.filter(id=>data.channels.some(c=>c.id===id))})}>Убрать из выбора</button></p>}
        </div>
        <div><h3>Какие знания использовать?</h3><p className={styles.muted}>В генерацию попадут только выбранные элементы.</p><div className={styles.knowledge}>{data.categories.map(category=><label className={styles.check} key={category.id}><input type="checkbox" checked={input.kbIds.includes(category.id)} onChange={()=>toggle("kbIds",category.id)}/>{category.name}</label>)}</div>
          {!data.categories.length&&<p className={styles.muted}>База знаний пока пуста. Можно описать бизнес на шаге содержания.</p>}
          {input.kbIds.some(id=>!data.categories.some(c=>c.id===id))&&<button onClick={()=>change({...input,kbIds:input.kbIds.filter(id=>data.categories.some(c=>c.id===id))})}>Убрать недоступные знания</button>}
        </div>
        <div><h3>Тип публикации</h3><div className={styles.cards}>{[{id:"image",name:"Текст + картинка",description:"Один визуал и текст поста"},{id:"carousel",name:"Текст + карусель",description:"Серия слайдов в едином стиле"},{id:"text",name:"Только текст",description:"Публикация без изображения"},{id:"video",name:"Сценарий для видео",description:"Для самостоятельной съёмки"}].map(type=><label key={type.id} className={styles.choice} data-selected={input.kind===type.id}><input type="radio" name="publication-kind" checked={input.kind===type.id} onChange={()=>change({...input,kind:type.id as AuthoringInput["kind"],...(type.id==="carousel"?{slides:input.slides??Array(5).fill(""),image:{...input.image,source:"generate"}}:{}),...(type.id==="video"?{video:input.video??{duration:60,format:"Разговор в кадре"}}:{})})}/><span><strong>{type.name}</strong><small>{type.description}</small></span></label>)}</div></div>
        {input.kind==="text"&&input.channelIds.some(id=>data.channels.find(c=>c.id===id)?.platform==="instagram")&&<p className={styles.notice}>Instagram требует изображение. Текстовый черновик можно подготовить, но опубликовать без картинки получится только в LinkedIn.</p>}
        <label>Язык поста<select value={input.language} onChange={e=>change({...input,language:e.target.value})}>{["Русский","Deutsch","English","Українська"].map(language=><option key={language}>{language}</option>)}</select></label>
        {!input.kbIds.length&&<p className={styles.muted}>Без базы знаний идеи будут общими. Добавьте факты о бизнесе на следующем шаге.</p>}
        <div className={styles.actions}><button className={styles.secondary} disabled={!input.channelIds.length||!data.configured} onClick={()=>void perform(ideas)}>Предложить идеи</button><button className={styles.primary} disabled={!input.channelIds.length} onClick={()=>void perform(()=>go(3))}>Далее</button></div>
      </>}
      {currentStep===2&&<>
        <div><h3>Выберите идею для поста</h3><p className={styles.muted}>Каждую идею можно отредактировать на следующем шаге.</p></div>
        {data.state.ideas.length>0&&data.state.ideas_key!==ideaContextKey(input)&&<p className={styles.notice}>Эти идеи подготовлены по предыдущим настройкам. Новые предложения учтут текущий выбор.</p>}
        <div className={styles.ideas}>{data.state.ideas.map((idea,index)=><article key={index} className={styles.idea}><span className={styles.eyebrow}>ИДЕЯ {index+1}</span><h4>{idea.topic}</h4><p>{idea.description}</p><details><summary>Цель, аудитория и подача</summary><dl>{IDEA_FIELDS.filter(f=>!["topic","description"].includes(f.key)).map(f=><div key={f.key}><dt>{f.label}</dt><dd>{idea[f.key]||"Не задано"}</dd></div>)}</dl></details><button className={styles.secondary} onClick={()=>void perform(()=>choose(idea))}>Выбрать идею {index+1}</button></article>)}</div>
        <div className={styles.actions}><button className={styles.secondary} disabled={data.state.ideas.length>=12||!data.configured} onClick={()=>void perform(()=>generate("ideas"))}>{data.state.ideas.length>=12?"Показаны все 12 идей":`Ещё идеи · ${data.state.ideas.length} из 12`}</button><button className={styles.primary} onClick={()=>void perform(()=>choose(input.brief.topic?input.brief:EMPTY_IDEA))}>Своя идея</button></div>
      </>}
      {currentStep===3&&<>
        <div><h3>Идея и содержание</h3><p className={styles.muted}>Расскажите, что важно. Все предложенные формулировки можно изменить.</p></div>
        {IDEA_FIELDS.map(f=><label key={f.key}>{f.label}{f.key==="cta"&&<small className={styles.muted}>Необязательно</small>}{f.key==="description"?<textarea rows={5} maxLength={f.limit} value={input.brief[f.key]} onChange={e=>brief(f.key,e.target.value)} placeholder="Факты, подробности, ограничения и пожелания к посту"/>:<input maxLength={f.limit} value={input.brief[f.key]} onChange={e=>brief(f.key,e.target.value)} required={f.key==="topic"||f.key==="goal"}/>}</label>)}
        {["image","carousel"].includes(input.kind)&&<label>Формат картинки<select value={input.aspectRatio} onChange={e=>change({...input,aspectRatio:e.target.value as AuthoringInput["aspectRatio"]})}><option value="1:1">1:1 · Квадрат</option><option value="4:5">4:5 · Вертикальный</option><option value="9:16">9:16 · В полный рост</option></select></label>}
        {input.kind==="video"&&<><label>Длительность, секунд<input type="number" min={15} max={600} value={input.video?.duration??60} onChange={e=>change({...input,video:{duration:Number(e.target.value),format:input.video?.format??"Разговор в кадре"}})}/></label><label>Формат съёмки<input maxLength={500} value={input.video?.format??"Разговор в кадре"} onChange={e=>change({...input,video:{duration:input.video?.duration??60,format:e.target.value}})}/></label></>}
        <div className={styles.actions}><button className={styles.secondary} onClick={()=>void perform(()=>go(data.state.ideas.length?2:1))}>Назад</button><button className={styles.primary} disabled={!input.brief.topic.trim()||!input.brief.goal.trim()} onClick={()=>void perform(()=>go(["image","carousel"].includes(input.kind)?4:5))}>Далее</button></div>
      </>}
      {currentStep===4&&<>
        <div><h3>Картинка для публикации</h3><p className={styles.muted}>Формат {input.aspectRatio}. {input.kind==="carousel"?"Единый формат для всех слайдов.":"Одна картинка для выбранных каналов."}</p></div>
        {input.kind==="carousel"&&<div className={styles.form}><h3>Структура карусели</h3><label>Количество слайдов<select value={input.slides?.length??5} onChange={e=>change({...input,slides:Array.from({length:Number(e.target.value)},(_,i)=>input.slides?.[i]??"")})}>{Array.from({length:9},(_,i)=><option key={i} value={i+2}>{i+2}</option>)}</select></label><button className={styles.secondary} disabled={!data.configured} onClick={()=>void perform(()=>generate("outline"))}>Предложить структуру слайдов</button>{(input.slides??Array(5).fill("")).map((slide,index)=><label key={index}>Слайд {index+1}: текст и визуал<textarea rows={3} maxLength={2000} value={slide} onChange={e=>change({...input,slides:(input.slides??Array(5).fill("")).map((v,i)=>i===index?e.target.value:v)})}/></label>)}<p className={styles.muted}>Проверьте содержание до генерации изображений. Стиль и цвета ниже применяются ко всем слайдам.</p></div>}
        {input.kind!=="carousel"&&<label>Источник картинки<select value={input.image.source} onChange={e=>change({...input,image:{...input.image,source:e.target.value as "generate"|"upload"}})}><option value="generate">Сгенерировать AI</option><option value="upload">Загрузить свою</option></select></label>}
        {input.image.source==="upload"?<label>Готовая картинка · PNG, JPEG, WebP до 4 МБ<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void perform(()=>upload(file,"assetId"));e.target.value="";}}/>{input.image.assetId&&<img className={styles.thumb} src={`/api/publications/assets/${input.image.assetId}`} alt="Загруженная картинка"/>}<small className={styles.muted}>Используем оригинал. AI не изменяет загруженную картинку.</small></label>:<>
          <label>Что изобразить?<textarea rows={4} maxLength={4000} value={input.image.description} onChange={e=>change({...input,image:{...input.image,description:e.target.value}})} placeholder="Оставьте пустым, чтобы Drafta предложила визуал по содержанию поста"/></label>
          <label>Визуальный стиль<input maxLength={500} value={input.image.style} onChange={e=>change({...input,image:{...input.image,style:e.target.value}})} list="publication-styles"/><datalist id="publication-styles"><option>Современная фотография</option><option>Минималистичная иллюстрация</option><option>Яркая графика</option><option>Тёплая предметная фотография</option></datalist></label>
          <details className={styles.extra}><summary>Цвета, надпись и референс</summary><label>Цвета<input maxLength={500} value={input.image.colors} onChange={e=>change({...input,image:{...input.image,colors:e.target.value}})}/></label><label>Надпись на картинке · необязательно<input maxLength={500} value={input.image.caption} onChange={e=>change({...input,image:{...input.image,caption:e.target.value}})}/></label><label>Визуальный референс · до 4 МБ<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void perform(()=>upload(file,"referenceId"));e.target.value="";}}/></label>{input.image.referenceId&&<div><img className={styles.thumb} src={`/api/publications/assets/${input.image.referenceId}`} alt="Визуальный референс"/><button className={styles.secondary} onClick={()=>change({...input,image:{...input.image,referenceId:null}})}>Убрать референс</button></div>}</details>
        </>}
        <div className={styles.actions}><button className={styles.secondary} onClick={()=>void perform(()=>go(3))}>Назад</button><button className={styles.primary} disabled={input.image.source==="upload"&&!input.image.assetId} onClick={()=>void perform(()=>go(5))}>Далее</button></div>
      </>}
      {(currentStep===5||currentStep===6)&&<>
        <div><h3>Всё готово к генерации</h3><p className={styles.muted}>Проверьте вводные. Сначала создадим черновик для вашей проверки.</p></div>
        <dl className={styles.summary}><div><dt>Каналы</dt><dd>{input.channelIds.map(id=>data.channels.find(c=>c.id===id)?.name||"Отключённый канал").join(", ")}</dd></div><div><dt>База знаний</dt><dd>{input.kbIds.map(id=>data.categories.find(c=>c.id===id)?.name||"Недоступный элемент").join(", ")||"Без базы знаний"}</dd></div><div><dt>Тип и язык</dt><dd>{{image:"Текст + картинка",text:"Только текст",carousel:"Текст + карусель",video:"Сценарий видео"}[input.kind]} · {input.language}</dd></div>{IDEA_FIELDS.map(f=><div key={f.key}><dt>{f.label}</dt><dd>{input.brief[f.key]||"Не задано"}</dd></div>)}{input.kind==="image"&&<div><dt>Картинка</dt><dd>{input.aspectRatio} · {input.image.source==="upload"?"Своя картинка":input.image.style}</dd></div>}</dl>
        <p className={styles.muted}>Используем выбранные знания и вводные через OpenAI API. Изображения генерируются только после нажатия кнопки.</p>
        <div className={styles.actions}><button className={styles.secondary} onClick={()=>void perform(()=>go(["image","carousel"].includes(input.kind)?4:3))}>Назад</button><button className={styles.primary} disabled={!data.configured} onClick={()=>void perform(()=>generate("post"))}>{input.kind==="video"?"Создать сценарий":input.kind==="carousel"?"Создать текст и слайды":"Сгенерировать пост"}</button></div>
      </>}
      </fieldset></>}
      </div>
    </div>
    <DeletePublication draftId={draftId} onDeleted={onClose} disabled={busy||active}/>
  </section>;
}
