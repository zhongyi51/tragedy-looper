import {btn,icon} from '../html.mjs';
import {hudHtml} from './hud.mjs';
import {boardHtml} from './board.mjs';
import {dockHtml} from './dock.mjs';
import {sideTabsHtml,sideBodyHtml} from './side.mjs';

// The table is a fixed frame of regions; each is re-rendered only when its HTML changes.
export const TABLE_SKELETON=`<div class="table">
 <div class="r-hud" data-region="hud"></div>
 <div class="stage"><div class="board-wrap" data-region="board"></div><div class="r-dock" data-region="dock"></div></div>
 <aside class="side" aria-label="情报与记录"><div data-region="tabs"></div><div class="r-sidebody" data-region="side"></div></aside>
 <button type="button" class="scrim" data-do="toggle-side" aria-label="关闭侧栏" tabindex="-1"></button>
</div>`;

export const emptyGameHtml=()=>`<main class="wrap empty-game"><div class="eyebrow">NO ACTIVE LOOP</div><h1>棋盘尚未展开</h1><p class="lead">开始新轮回，或从档案室继续存档。</p><div class="row">${btn(icon('plus')+'开启新轮回','new','primary big')}${btn('返回档案室','nav-home','big')}</div></main>`;

export function placementTargets(v,state){
 if(!state.selected||state.working||state.syncRequired)return null;
 return new Set(v.actions?.filter(a=>a.command.type==='place'&&a.command.card===state.selected).map(a=>a.command.target));
}

// extra: {sheet, readOnly, dock}; `dock` replaces the turn dock (the replay bar does this).
export function tableRegions(v,state,{sheet={},readOnly=false,dock}={}){
 const targets=readOnly?null:placementTargets(v,state),tab=readOnly&&state.sideTab==='sheet'?'intel':state.sideTab;
 return {
  hud:hudHtml(v,{autoPlay:state.autoPlay,readOnly}),
  board:boardHtml(v,{selected:targets?state.selected:null,targets}),
  dock:dock??dockHtml(v,state),
  tabs:sideTabsHtml(v,{tab,readOnly}),
  side:sideBodyHtml(v,{tab,aiFeed:state.aiFeed,sheet,readOnly})
 };
}
