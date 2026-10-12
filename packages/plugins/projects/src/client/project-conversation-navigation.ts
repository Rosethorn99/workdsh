/** Project presentation shares the official selected Session and right Sidebar. */
export interface ProjectConversationLocation {
 readonly projectId:string;
 readonly taskSessionId:string;
 readonly conversationId:string;
}
export interface ProjectConversationHost {
 mount:()=>()=>void;
 writeLocation:(location:ProjectConversationLocation|undefined)=>void;
 openSession:(id:string)=>void;
 showConversation:()=>void;
}
export function createProjectConversationNavigation(host:ProjectConversationHost) {
 let current:ProjectConversationLocation|undefined;
 let dispose:(()=>void)|undefined;
 let selecting=false;
 const leave=()=>{const active=!!current;current=undefined;const release=dispose;dispose=undefined;release?.();host.writeLocation(undefined);return active;};
 return {
  activate(location:ProjectConversationLocation) {
   if(current?.projectId===location.projectId&&current.taskSessionId===location.taskSessionId&&current.conversationId===location.conversationId)return;
   selecting=true;
   try {
    dispose??=host.mount();current=location;host.writeLocation(location);
    host.openSession(location.conversationId);host.showConversation();
   } catch(error) {leave();throw error;} finally {selecting=false;}
  },
  observePanel(id:string|null) {if(current&&!selecting&&id!==null)leave();},
  observeSession(id:string|undefined) {if(current&&!selecting&&id!==undefined&&id!==current.conversationId)leave();},
  leave,
 };
}
