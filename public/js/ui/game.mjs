import {btn,icon} from '../html.mjs';
import {hudHtml} from './hud.mjs';
import {boardHtml} from './board.mjs';
import {dockHtml} from './dock.mjs';
import {sideTabsHtml,sideBodyHtml} from './side.mjs';
import {analyze} from '../deduce.mjs';

// The table is a fixed frame of regions; each is re-rendered only when its HTML changes.
export const TABLE_SKELETON=`<div class="table">
 <div class="r-hud" data-region="hud"></div>
 <div class="stage"><div class="board-wrap" data-region="board"></div><div class="r-dock" data-region="dock"></div></div>
 <aside class="side" aria-label="情报与推理"><div data-region="tabs"></div><div class="r-sidebody" data-region="side"></div></aside>
 <button type="button" class="scrim" data-do="toggle-side" aria-label="关闭侧栏" tabindex="-1"></button>
</div>`;

export const emptyGameHtml=()=>`<main class="wrap empty-game"><h1>还没有对局</h1><div class="row">${btn(icon('plus')+'新对局','new','primary big')}${btn('返回首页','nav-home','big')}</div></main>`;

export function placementTargets(v,state){
 if(!state.selected||state.working||state.syncRequired)return null;
 return new Set(v.actions?.filter(a=>a.command.type==='place'&&a.command.card===state.selected).map(a=>a.command.target));
}

// extra: {marks, readOnly, dock}; `dock` replaces the turn dock (the replay bar does this).
// The deduction sheet is for whoever still has something to deduce: not replays, not the mastermind.
export function tableRegions(v,state,{marks,readOnly=false,dock}={}){
 const targets=readOnly?null:placementTargets(v,state),analysis=readOnly||v.secret?null:analyze(v,marks);
 const tab=state.sideTab==='sheet'&&!analysis?'intel':state.sideTab;
 return {
  hud:hudHtml(v,{autoPlay:state.autoPlay,readOnly}),
  board:boardHtml(v,{selected:targets?state.selected:null,targets,spot:state.playback?.spot,sheet:analysis}),
  dock:dock??dockHtml(v,state,analysis),
  tabs:sideTabsHtml(v,{tab,sheet:Boolean(analysis)}),
  side:sideBodyHtml(v,{tab,aiFeed:state.aiFeed,analysis,tool:state.sheetTool,wide:state.sideWide,readOnly})
 };
}
