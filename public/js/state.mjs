// The one mutable client state. Screens read it; main.mjs and session.mjs write it and re-render.
const stored=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};

export const state={
 catalog:null,info:null,saves:[],
 page:'home',modal:'',
 g:null,transitionView:null,playback:null,selected:null,peekSeat:null,
 working:false,requestKind:'',auto:false,creating:false,
 syncRequired:false,actionError:'',actionErrorCode:'',advancedRevision:'',
 aiFeed:[],truth:null,banner:null,pendingOutcome:null,
 sideTab:'intel',sideOpen:false,sideWide:false,sheetTool:'no',
 sound:stored('tl-sound','on')!=='off',
 autoPlay:stored('tl-autoplay','on')!=='off',
 speed:stored('tl-speed','1')==='2'?2:1,
 rulesTab:'basics',
 editor:{text:'',report:null,tab:'form',generator:{ruleset:'FS',seed:Date.now()%1000000,theme:''}},
 replay:{data:null,at:0,gameId:null,playing:false,full:false}
};
