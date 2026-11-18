import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeAiInfo,creationAiSettings,withAiSettings,gameAiInfo,providerOptions,selectedProvider,authorBudgetFor} from '../src/ai-settings.mjs';
import {createGame,applyCommand,botCommand,turn} from '../src/engine.mjs';
import {starter,catalog} from '../src/content.mjs';
import {setCatalog} from '../public/js/lookup.mjs';
import {newGameModal} from '../public/js/ui/modals.mjs';
import {editorHtml} from '../public/js/ui/editor.mjs';
import {opponentSettings} from '../public/js/ai-settings.mjs';
import {createSession} from '../public/js/session.mjs';

const env={DEEPSEEK_API_KEY:'unit-deepseek-secret',OPENROUTER_API_KEY:'unit-openrouter-secret'};
test('shared runtime settings retain explicit provider, default old saves, and isolate keys',()=>{
 assert.equal(gameAiInfo(createGame(starter),env).aiProvider,'deepseek');
 const settings=creationAiSettings({aiProvider:'openrouter',opponent:'ai',authorProvider:'deepseek'},env);
 assert.deepEqual(settings,{aiProvider:'openrouter',authorProvider:'deepseek',opponent:'ai'});
 assert.deepEqual(providerOptions('openrouter',env),{provider:'openrouter',apiKey:env.OPENROUTER_API_KEY});
 assert.equal(providerOptions('openrouter',{}).apiKey,'');
 assert.throws(()=>selectedProvider('https://evil.test'),e=>e.code==='MODEL_PROVIDER');
 assert.throws(()=>creationAiSettings({aiProvider:'openrouter',opponent:'ai'},{}),e=>e.code==='NO_KEY');
 assert.equal(authorBudgetFor('deepseek'),.12);assert.equal(authorBudgetFor('openrouter'),.50);
 let s=withAiSettings(createGame(starter),settings);
 for(let n=0;n<250&&!s.winner;n++){s=applyCommand(s,turn(s),botCommand(s,turn(s)));assert.equal(s.aiProvider,'openrouter');assert.equal(s.opponent,'ai');}
 assert.ok(s.winner);
});
test('model choices keep existing compact controls and expose the selected author budget',()=>{
 setCatalog(catalog);const info=runtimeAiInfo(env),state={info,editor:{text:'',tab:'form',generator:{ruleset:'FS',seed:1,theme:'',provider:'openrouter'}}};
 const html=newGameModal(state,'heroes','ai',{authorProvider:'openrouter',opponent:'openrouter'});
 assert.match(html,/<select id="new-opponent">/);assert.match(html,/<option value="ai">DeepSeek AI<\/option>/);
 assert.match(html,/<option value="openrouter" selected>GPT-6.2 Sol AI<\/option>/);
 assert.match(html,/<select id="new-author-provider">/);assert.match(html,/每次上限 \$0.50/);
 assert.match(editorHtml(state),/id="gen-provider"/);assert.match(editorHtml(state),/每次上限 \$0.50/);
 assert.deepEqual(opponentSettings('openrouter'),{opponent:'ai',aiProvider:'openrouter'});
 assert.deepEqual(opponentSettings('ai'),{opponent:'ai',aiProvider:'deepseek'});
});
test('saved opponent controls auto route and missing credentials never silently switch an AI game to bots',()=>{
 const state={g:{id:'test-game',opponent:'ai',aiProvider:'openrouter',aiConfigured:false},info:{configured:false}};
 const session=createSession({state,api(){},render(){},storage:{getItem:()=> 'bot',setItem(){}}});
 assert.equal(session.aiRoute(),'ai-step');state.g.opponent='bot';assert.equal(session.aiRoute(),'bot-step');
 delete state.g.opponent;state.info.configured=true;assert.equal(session.aiRoute(),'bot-step');
});
