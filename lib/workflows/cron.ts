import 'server-only';
import {timingSafeEqual} from 'node:crypto';
export function authorizedCron(request:Request):boolean {
  const secret=process.env.CRON_SECRET;
  if(!secret)return false;
  const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(request.headers.get('authorization')??'');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
