'use client';
import {useCallback,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import styles from './ui.module.css';
type FailedOperation={id:string;kind:string;status:string;subjectId:string};
const labels:Record<string,string>={
  'auto-reply':'Автоответ не выполнен','generate-draft':'Черновик не создан',
  'send-message':'Сообщение не отправлено','send-comment':'Ответ на комментарий не отправлен',
  'send-comment-private-reply':'Личное сообщение не отправлено',
  'contact-avatar':'Не удалось обновить фото','post-thumbnail':'Не удалось загрузить миниатюру',
};
export function WorkflowErrors({resourceId}:{resourceId:string}) {
  const [rows,setRows]=useState<FailedOperation[]>([]),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
  const router=useRouter();
  const refresh=useCallback(async()=>{
    try {const response=await fetch(`/api/workflow-operations?resource=${encodeURIComponent(resourceId)}`,{cache:'no-store'});
      if(response.ok){const data=await response.json();setRows((data.operations??[]).filter((r:FailedOperation)=>labels[r.kind]));}
    }catch{/* A temporary status outage must not clear known failures. */}
  },[resourceId]);
  useEffect(()=>{const first=setTimeout(()=>void refresh(),0);const timer=setInterval(()=>void refresh(),5000);return()=>{clearTimeout(first);clearInterval(timer);};},[refresh]);
  async function retry(row:FailedOperation) {
    const checked=row.status==='uncertain';
    if(checked&&!window.confirm('Проверьте переписку в исходном канале. Вы подтверждаете, что сообщение НЕ было отправлено? Повтор может создать дубль, если оно уже доставлено.'))return;
    setBusy(row.id);setError('');
    try {
      const response=await fetch('/api/workflow-operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:row.id,checked})});
      if(!response.ok)throw new Error('Не удалось повторить. Обновите страницу и проверьте подключение канала.');
      await refresh();router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'Не удалось повторить.');}finally{setBusy(null);}
  }
  if(!rows.length&&!error)return null;
  return <div aria-live="polite">{rows.map(row=><div key={row.id} role="alert" style={{padding:'8px 16px'}}>
    <span>{row.status==='uncertain'?'Результат отправки неизвестен. Проверьте исходный канал.':labels[row.kind]}</span>{' '}
    <button type="button" className={`${styles.button} ${styles.buttonSmall} ${styles.buttonSecondary}`} disabled={busy!==null} onClick={()=>void retry(row)}>
      {busy===row.id?'Запускается…':row.status==='uncertain'?'Проверил: повторить':row.kind==='auto-reply'?'Повторить автоответ':'Повторить'}
    </button>
  </div>)}{error&&<p role="alert">{error}</p>}</div>;
}
