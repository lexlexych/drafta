"use client";
/* eslint-disable @next/next/no-img-element -- Workspace-authenticated media previews. */
import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import type {AuthoringResult,ChannelChoice} from "@/lib/publications/authoring";
import {Modal} from "../../_components/modal";
import {ExternalIcon,EyeIcon,TrashIcon} from "../../_components/icons";
import styles from "./publication-wizard.module.css";
type Delivery={id:string;channel_id:string;status:string;published_url:string|null;error:string|null};
const LABELS:Record<string,string>={pending:"В очереди",sending:"Ожидает подтверждения — проверьте статус",published:"Опубликовано",failed:"Ошибка отправки",uncertain:"Требуется проверка статуса"};
async function api(url:string,init?:RequestInit){const response=await fetch(url,{...init,cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Не удалось выполнить действие.");return data;}

/**
 * Удаление материала с подтверждением в модальном окне.
 * `button` — прежняя кнопка, `icon` — корзина для строки списка, `none` — без
 * своей кнопки: окно открывает родитель (пункт меню «⋯») через `open`.
 */
export function DeletePublication({draftId,onDeleted,disabled=false,variant="button",open,onOpenChange}:{draftId:string;onDeleted:()=>void;disabled?:boolean;variant?:"button"|"icon"|"none";open?:boolean;onOpenChange?:(open:boolean)=>void}){
  const [localOpen,setLocalOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const isOpen=open??localOpen;
  const setOpen=(next:boolean)=>{setLocalOpen(next);onOpenChange?.(next);if(!next)setError("");};
  const remove=()=>{setBusy(true);setError("");void api(`/api/publications/${draftId}`,{method:"DELETE"}).then(()=>{window.dispatchEvent(new Event("publication-changed"));setOpen(false);onDeleted();}).catch(e=>setError(e.message)).finally(()=>setBusy(false));};
  return <>
    {variant==="button"&&<button className={styles.btn} disabled={disabled} onClick={()=>setOpen(true)}><TrashIcon/>Удалить черновик</button>}
    {variant==="icon"&&<button className={styles.iconBtn} data-delete disabled={disabled} aria-label="Удалить черновик" title="Удалить черновик" onClick={e=>{e.preventDefault();e.stopPropagation();setOpen(true);}}><TrashIcon/></button>}
    {isOpen&&<Modal title="Удалить черновик?" onClose={()=>!busy&&setOpen(false)} footer={<><button className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={()=>setOpen(false)}>Отмена</button><button className={`${styles.btn} ${styles.btnDanger}`} disabled={busy||disabled} onClick={remove}>Удалить окончательно</button></>}>
      <p>Материал удалится из Drafta. Уже опубликованные посты в соцсетях останутся.</p>
      {error&&<p role="alert" className={styles.error}>{error}</p>}
    </Modal>}
  </>;
}

export function PublicationPublish({draftId,kind,result,beforePublish,onLockedChange,statusTarget,primary=true}:{draftId:string;kind:string;result:AuthoringResult;beforePublish:()=>Promise<string>;onLockedChange?:(locked:boolean)=>void;
  /** Куда вывести статусы отправки; без него статусы идут перед кнопкой. */
  statusTarget?:HTMLElement|null;primary?:boolean}){
  const [channels,setChannels]=useState<ChannelChoice[]>([]);const [deliveries,setDeliveries]=useState<Delivery[]>([]);
  const [selected,setSelected]=useState<string[]>([]);const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{let active=true;const refresh=()=>void api(`/api/publications/${draftId}/publish`).then(data=>{if(active){setChannels(data.channels??[]);setDeliveries(data.deliveries??[]);}}).catch(e=>{if(active)setError(e.message);});refresh();const timer=setInterval(refresh,4000);return()=>{active=false;clearInterval(timer);};},[draftId]);
  useEffect(()=>{onLockedChange?.(deliveries.length>0);},[deliveries.length,onLockedChange]);
  const eligible=channels.filter(c=>result.variants.some(v=>v.channelId===c.id||v.channelId==="legacy") && !(kind==="text"&&c.platform==="instagram"));
  function body(id:string){return result.variants.find(v=>v.channelId===id||v.channelId==="legacy")?.body||"";}
  const limitOf=(id:string)=>channels.find(c=>c.id===id)?.platform==="instagram"?2200:3000;
  const mediaIssue=kind==="image"?result.assetIds.length!==1:kind==="carousel"?result.assetIds.length<2||result.assetIds.length>10:result.assetIds.length!==0;
  const issue=selected.some(id=>Array.from(body(id)).length>limitOf(id)||!body(id).trim());
  async function publish(){setBusy(true);setError("");try{const version=await beforePublish();const data=await api(`/api/publications/${draftId}/publish`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channelIds:selected,version})});setDeliveries(data.deliveries);window.dispatchEvent(new Event("publication-changed"));setOpen(false);}catch(e){setError(e instanceof Error?e.message:"Ошибка отправки.");}finally{setBusy(false);}}
  async function retry(delivery:Delivery){setBusy(true);setError("");try{const version=await beforePublish();const data=await api(`/api/publications/${draftId}/publish`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channelIds:[delivery.channel_id],version})});setDeliveries(data.deliveries);window.dispatchEvent(new Event("publication-changed"));}catch(e){setError(e instanceof Error?e.message:"Ошибка отправки.");}finally{setBusy(false);}}
  if(kind==="video")return null;

  const statuses=(deliveries.length>0||(error&&!open))&&<div className={styles.section}>
    {deliveries.length>0&&<div className={styles.deliveries} role="status" aria-label="Статусы отправки">{deliveries.map(d=>{const channel=channels.find(c=>c.id===d.channel_id);return <div key={d.id} className={styles.delivery}>
      <span className={styles.dot} data-platform={channel?.platform}/><strong>{channel?.name||"Канал"}</strong><span className={styles.status} data-status={d.status}>{LABELS[d.status]}</span>
      {d.published_url?.startsWith("https://")&&<a href={d.published_url} target="_blank" rel="noopener noreferrer">Открыть пост <ExternalIcon/></a>}
      {d.error&&<p>{d.error}</p>}
      {d.status!=="published"&&<button className={styles.btn} disabled={busy} onClick={()=>void retry(d)}>{d.status==="failed"||d.error?"Повторить":"Проверить статус"}</button>}
    </div>;})}</div>}
    {error&&!open&&<p role="alert" className={styles.error}>{error}</p>}
  </div>;
  const trigger=<button className={`${styles.btn} ${primary?styles.btnPrimary:""}`} onClick={()=>{setError("");setSelected(eligible.filter(c=>!deliveries.some(d=>d.channel_id===c.id&&d.status!=="failed")).map(c=>c.id));setOpen(true);}}><EyeIcon/>Предпросмотр и публикация</button>;
  const modal=open&&<Modal size="lg" title="Проверьте публикацию" onClose={()=>!busy&&setOpen(false)} footer={<>
    <button className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={()=>setOpen(false)}>Вернуться к редактированию</button>
    <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy||!selected.length||issue||mediaIssue} onClick={()=>void publish()}>{busy?"Отправляем…":"Опубликовать сейчас"}</button>
  </>}>
    <div className={styles.preview}>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Куда отправить</span>
        {eligible.length?<div className={styles.pills}>{eligible.map(c=>{const sent=deliveries.find(d=>d.channel_id===c.id);return <label className={styles.pill} key={c.id}><input type="checkbox" checked={selected.includes(c.id)} disabled={busy||!!sent&&!["failed","uncertain"].includes(sent.status)} onChange={e=>setSelected(e.target.checked?[...selected,c.id]:selected.filter(id=>id!==c.id))}/><span><span className={styles.dot} data-platform={c.platform}/>{c.name} · {c.platform==="instagram"?"Instagram":"LinkedIn"}{sent&&<small>{LABELS[sent.status]}</small>}</span></label>;})}</div>
          :<p className={styles.muted}>Нет подходящего подключённого канала. Проверьте настройки и версии текста.</p>}
        {kind==="text"&&<p className={styles.muted}>Для Instagram добавьте изображение. Текст можно отправить в LinkedIn.</p>}
      </div>
      {selected.length>0&&<div className={styles.previewPosts}>{selected.map(id=>{const channel=channels.find(c=>c.id===id);const length=Array.from(body(id)).length;return <article key={id} className={styles.previewPost}>
        <div className={styles.previewHead}><span className={styles.dot} data-platform={channel?.platform}/><strong>{channel?.name}</strong><small>{channel?.platform==="instagram"?"Instagram":"LinkedIn"}</small></div>
        {result.assetIds.length>0&&<div className={styles.previewImages} data-many={result.assetIds.length>1}>{result.assetIds.map((asset,index)=><img key={asset} src={`/api/publications/assets/${asset}`} alt={`Слайд ${index+1}`} />)}</div>}
        <p className={styles.previewText}>{body(id)}</p>
        <span className={styles.previewMeta} data-over={length>limitOf(id)}>{length} / {limitOf(id)}{kind==="carousel"&&channel?.platform==="linkedin"?" · слайды уйдут листаемым PDF":""}</span>
      </article>;})}</div>}
      <p className={styles.muted}>Изображения сохраняются целиком; при необходимости добавим белые поля для совместимого формата. Публикация появится сразу после отправки.</p>
      {mediaIssue&&<div className={styles.banner} data-tone="error"><span>Добавьте одно изображение для поста или от 2 до 10 слайдов для карусели.</span></div>}
      {issue&&<div className={styles.banner} data-tone="error"><span>Текст пустой или превышает лимит соцсети. Исправьте его в редакторе.</span></div>}
      {error&&<p role="alert" className={styles.error}>{error}</p>}
    </div>
  </Modal>;

  if(statusTarget!==undefined)return <>{statusTarget&&statuses?createPortal(statuses,statusTarget):null}{trigger}{modal}</>;
  return <section className={styles.section} aria-label="Публикация в соцсетях">{statuses}<div className={styles.actions}>{trigger}</div>{modal}</section>;
}
