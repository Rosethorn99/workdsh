import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectConversationNavigation } from '../src/client/project-conversation-navigation.ts';
function fixture() {
 const calls=[]; let route; let selected; let mounted=false;
 const navigation=createProjectConversationNavigation({
  mount:()=>{mounted=true;calls.push('mount');return()=>{mounted=false;calls.push('dispose');};},
  writeLocation:value=>{route=value;calls.push('route');},
  openSession:id=>{assert.equal(mounted,true);selected=id;calls.push('session:'+id);},
  showConversation:()=>{assert.equal(mounted,true);calls.push('conversation');},
 });
 return {navigation,calls,get route(){return route;},get selected(){return selected;},get mounted(){return mounted;}};
}
test('project task and teammate select the official Session without losing the project task',()=>{
 const f=fixture();
 f.navigation.activate({projectId:'mes',taskSessionId:'lead',conversationId:'lead'});
 assert.deepEqual(f.calls,['mount','route','session:lead','conversation']);
 f.navigation.activate({projectId:'mes',taskSessionId:'lead',conversationId:'reviewer'});
 assert.equal(f.calls.filter(x=>x==='mount').length,1);
 assert.equal(f.route.taskSessionId,'lead');assert.equal(f.selected,'reviewer');
 f.navigation.observeSession('reviewer');assert.equal(f.mounted,true);
 // A transient absence during native reference replacement must not destroy the project shell.
 f.navigation.observeSession(undefined);assert.equal(f.mounted,true);
});
test('ordinary session and global panel restore the official conversation once',()=>{
 const f=fixture();const value={projectId:'mes',taskSessionId:'lead',conversationId:'lead'};
 assert.equal(f.navigation.leave(),false); // Cold restoration has no project Session to leave.
 f.navigation.activate(value);f.navigation.observePanel(null);assert.equal(f.mounted,true);
 f.navigation.observeSession('ordinary');assert.equal(f.mounted,false);assert.equal(f.route,undefined);
 assert.equal(f.navigation.leave(),false);assert.equal(f.calls.filter(x=>x==='dispose').length,1);
 f.navigation.activate(value);f.navigation.observePanel('settings');assert.equal(f.mounted,false);
 f.navigation.activate(value);assert.equal(f.navigation.leave(),true);
});
test('activation failure removes a half-mounted project surface',()=>{
 let disposed=0;let route;
 const f=createProjectConversationNavigation({mount:()=>()=>disposed++,writeLocation:v=>route=v,
  openSession:()=>{throw Error('session unavailable');},showConversation:()=>assert.fail('must not show a failed session')});
 assert.throws(()=>f.activate({projectId:'mes',taskSessionId:'lead',conversationId:'missing'}),/unavailable/);
 assert.equal(disposed,1);assert.equal(route,undefined);
});
