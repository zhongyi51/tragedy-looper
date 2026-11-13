import {icon,btn,iconBtn} from '../html.mjs';

export function replayIntroHtml(state){
 return `<main class="wrap replay-intro">
  <div class="page-intro"><div><h1>回放</h1></div><p class="lead">一步一步重看整局。公开视角不含任何秘密。</p></div>
  <div class="toolbar">${state.g?btn(icon('film')+'回放当前对局','open-replay','primary big'):''}<label class="btn big file">导入回放<input id="replay-file" type="file" accept=".json,application/json"></label></div>
 </main>`;
}

export function replayBarHtml(state){
 const {data,at,gameId,playing,full}=state.replay,last=data.frames.length-1,own=state.g&&gameId===state.g.id;
 const canBranch=own&&state.g.phaseId==='over',canFull=own&&(state.g.phaseId==='over'||state.g.mode==='mastermind');
 return `<div class="replay-bar">
  <div class="replay-controls">${iconBtn('prev','replay-prev','上一步','',at<=0?'disabled':'')}${iconBtn(playing?'pause':'play','replay-play',playing?'暂停':'播放','primary')}${iconBtn('next','replay-next','下一步','',at>=last?'disabled':'')}
   <label class="sr-only" for="replay-range">回放进度</label><input id="replay-range" type="range" min="0" max="${last}" value="${at}"><span id="replay-position">${at+1} / ${last+1}</span></div>
  <div class="row">${canFull?btn(icon(full?'users':'mask')+(full?'公开视角':'显示真相'),'replay-full','small'):''}${canBranch?btn('从这里重玩','branch','small'):''}${btn(icon('download')+'导出','offline-replay','small','title="导出为离线网页"')}<label class="btn small file">导入<input id="replay-file" type="file" accept=".json,application/json"></label>${btn('关闭','close-replay','small ghost')}</div>
 </div>`;
}
