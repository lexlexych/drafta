"use client";
/* eslint-disable @next/next/no-img-element -- Workspace-authenticated media previews. */
import {useEffect,useState} from "react";
import type {AuthoringResult,ChannelChoice} from "@/lib/publications/authoring";
import styles from "./publication-wizard.module.css";
type Delivery={id:string;channel_id:string;status:string;published_url:string|null;error:string|null};
const LABELS:Record<string,string>={pending:"В очереди",sending:"Публикуем…",published:"Опубликовано",failed:"Ошибка отправки",uncertain:"Требуется проверка статуса"};
async function api(url:string,init?:RequestInit){const response=await fetch(url,{...init,cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось выполнить действие.");return data;}
export function DeletePublication({draftId,onDeleted,disabled=false}:{draftId:string;onDeleted:()=>void;disabled?:boolean}){
  const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  return <div>{confirm?<div className={styles.notice} role="alert"><p>Удалить этот материал из Drafta? Опубликованные посты в соцсетях останутся.</p>
    <button disabled={busy||disabled} onClick={()=>{setBusy(true);void api(`/api/publications/${draftId}`,{method:"DELETE"}).then(()=>{window.dispatchEvent(new Event("publication-changed"));onDeleted();}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Удалить окончательно</button> <button disabled={busy} onClick={()=>setConfirm(false)}>Отмена</button></div>:<button className={styles.secondary} disabled={disabled} onClick={()=>setConfirm(true)}>Удалить черновик</button>}{error&&<p role="alert" className={styles.error}>{error}</p>}</div>;
}
export function PublicationPublish({draftId,kind,result,beforePublish,onLockedChange}:{draftId:string;kind:string;result:AuthoringResult;beforePublish:()=>Promise<string>;onLockedChange?:(locked:boolean)=>void}){
  const [channels,setChannels]=useState<ChannelChoice[]>([]);const [deliveries,setDeliveries]=useState<Delivery[]>([]);
  const [selected,setSelected]=useState<string[]>([]);const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{let active=true;const refresh=()=>void api(`/api/publications/${draftId}/publish`).then(data=>{if(active){setChannels(data.channels??[]);setDeliveries(data.deliveries??[]);}}).catch(e=>{if(active)setError(e.message);});refresh();const timer=setInterval(refresh,4000);return()=>{active=false;clearInterval(timer);};},[draftId]);
  useEffect(()=>{onLockedChange?.(deliveries.length>0);},[deliveries.length,onLockedChange]);
  const eligible=channels.filter(c=>result.variants.some(v=>v.channelId===c.id||v.channelId==="legacy") && !(kind==="text"&&c.platform==="instagram"));
  function body(id:string){return result.variants.find(v=>v.channelId===id||v.channelId==="legacy")?.body||"";}
  const mediaIssue=kind==="image"?result.assetIds.length!==1:kind==="carousel"?result.assetIds.length<2||result.assetIds.length>10:result.assetIds.length!==0;
  const issue=selected.some(id=>Array.from(body(id)).length>(channels.find(c=>c.id===id)?.platform==="instagram"?2200:3000)||!body(id).trim());
  async function publish(){setBusy(true);setError("");try{const version=await beforePublish();const data=await api(`/api/publications/${draftId}/publish`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channelIds:selected,version})});setDeliveries(data.deliveries);window.dispatchEvent(new Event("publication-changed"));setOpen(false);}catch(e){setError(e instanceof Error?e.message:"Ошибка отправки.");}finally{setBusy(false);}}
  if(kind==="video")return null;
  return <section className={styles.form} aria-label="Публикация в соцсетях">
    {deliveries.map(d=><div key={d.id} className={styles.notice} role="status"><strong>{channels.find(c=>c.id===d.channel_id)?.name||"Канал"}: {LABELS[d.status]}</strong>{d.published_url?.startsWith("https://")&&<> · <a href={d.published_url} target="_blank" rel="noopener noreferrer">Открыть пост ↗</a></>}{d.error&&<p>{d.error}</p>}</div>)}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {open?<div className={styles.preview}>
      <h3>Проверьте публикацию</h3><p>Выберите соцсети. Публикация появится сразу после отправки.</p>
      {eligible.map(c=>{const sent=deliveries.find(d=>d.channel_id===c.id);return <label className={styles.check} key={c.id}><input type="checkbox" checked={selected.includes(c.id)} disabled={busy||!!sent&&!["failed","uncertain"].includes(sent.status)} onChange={e=>setSelected(e.target.checked?[...selected,c.id]:selected.filter(id=>id!==c.id))}/>{c.name} · {c.platform==="instagram"?"Instagram":"LinkedIn"}{sent?` · ${LABELS[sent.status]}`:""}</label>;})}
      {!eligible.length&&<p>Нет подходящего подключённого канала. Проверьте настройки и версии текста.</p>}
      {kind==="text"&&<p className={styles.muted}>Для Instagram добавьте изображение. Текст можно отправить в LinkedIn.</p>}
      {selected.map(id=><article key={id}><h4>{channels.find(c=>c.id===id)?.name}</h4><p style={{whiteSpace:"pre-wrap"}}>{body(id)}</p><small>{Array.from(body(id)).length} / {channels.find(c=>c.id===id)?.platform==="instagram"?2200:3000}</small><div className={styles.previewImages}>{result.assetIds.map((asset,index)=><img key={asset} src={`/api/publications/assets/${asset}`} alt={`Слайд ${index+1}`} />)}</div>{kind==="carousel"&&channels.find(c=>c.id===id)?.platform==="linkedin"&&<p>Слайды будут опубликованы как листаемый PDF.</p>}</article>)}
      <p className={styles.muted}>Изображения сохраняются целиком; при необходимости добавим белые поля для совместимого формата.</p>
      {mediaIssue&&<p className={styles.error}>Добавьте одно изображение для поста или от 2 до 10 слайдов для карусели.</p>}
      {issue&&<p className={styles.error}>Текст пустой или превышает лимит соцсети. Исправьте его в редакторе.</p>}
      <div className={styles.actions}><button className={styles.primary} disabled={busy||!selected.length||issue||mediaIssue} onClick={()=>void publish()}>Опубликовать сейчас</button><button className={styles.secondary} disabled={busy} onClick={()=>setOpen(false)}>Вернуться к редактированию</button></div>
    </div>:<button className={styles.primary} onClick={()=>{setSelected(eligible.filter(c=>!deliveries.some(d=>d.channel_id===c.id&&d.status!=="failed")).map(c=>c.id));setOpen(true);}}>Предпросмотр и публикация</button>}
  </section>;
}
