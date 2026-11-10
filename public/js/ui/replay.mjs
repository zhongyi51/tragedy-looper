import {icon,btn,iconBtn} from '../html.mjs';

export function replayIntroHtml(state){
 return `<main class="wrap replay-intro">
  <div class="page-intro"><div><div class="eyebrow">REPLAY ARCHIVE</div><h1>每一步，都留下回声。</h1></div><p class="lead">回放只读取已保存的观察快照，不请求模型。公开回放不会显示当时尚未获知的秘密。</p></div>
  <div class="toolbar">${state.g?btn(icon('film')+'打开当前对局回放','open-replay','primary big'):''}<label class="btn big file">导入回放 JSON<input id="replay-file" type="file" accept=".json,application/json"></label></div>
  <p class="hint">选择一段回放，重新审视那些被忽略的细节。对局结束后，还可以从任意一步创建“如果当时……”的分支。</p>
 </main>`;
}

export function replayBarHtml(state){
 const {data,at,gameId,playing,full}=state.replay,last=data.frames.length-1,own=state.g&&gameId===state.g.id;
 const canBranch=own&&state.g.phaseId==='over',canFull=own&&(state.g.phaseId==='over'||state.g.mode==='mastermind');
 return `<div class="replay-bar">
  <div class="replay-controls">${iconBtn('prev','replay-prev','上一步','',at<=0?'disabled':'')}${iconBtn(playing?'pause':'play','replay-play',playing?'暂停':'自动播放','primary')}${iconBtn('next','replay-next','下一步','',at>=last?'disabled':'')}
   <label class="sr-only" for="replay-range">回放进度</label><input id="replay-range" type="range" min="0" max="${last}" value="${at}"><span id="replay-position">${at+1} / ${last+1}</span></div>
  <div class="row">${canFull?btn(icon(full?'users':'mask')+(full?'公开视角':'全知视角'),'replay-full','small',`title="${full?'只显示当时公开的信息':'显示全部角色、犯人与牌面'}"`):''}${canBranch?btn('从此处创建分支','branch','small'):''}${btn(icon('download')+'离线 HTML','offline-replay','small')}<label class="btn small file">导入<input id="replay-file" type="file" accept=".json,application/json"></label>${btn('关闭回放','close-replay','small ghost')}</div>
 </div>`;
}
