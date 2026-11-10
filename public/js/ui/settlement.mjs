import {esc} from '../html.mjs';

// Use persisted, viewer-filtered logs so fast animation and reloads cannot hide a result.
export function settlementHtml(v){
 const log=v.log||[],start=log.findLastIndex(e=>['ability','refused','incident'].includes(e.type));
 const phase=log.findLast(e=>e.type==='phase');
 if(start<0&&!phase)return '';
 const first=start>=0?log[start]:phase,following=start>=0?log.slice(start+1):[];
 const stop=following.findIndex(e=>['placed','cards','day','loop'].includes(e.type));
 const lines=[first,...(stop<0?following:following.slice(0,stop))];
 return `<details class="settlement" aria-label="最近能力与事件结算"><summary><b>最近结算</b><span>第 ${first.loop} 轮回 · 第 ${first.day} 日 · ${esc(first.text)}</span></summary><ol>${lines.map(e=>`<li>${esc(e.text)}</li>`).join('')}</ol></details>`;
}
