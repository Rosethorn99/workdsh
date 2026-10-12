import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-experimental-agent-team';
import type { StageCapabilityLock } from './authoring.js';

/** Read-only views of official Team state. No roster, task or mailbox is persisted here. */
export interface StageTeamRuntime {
  sessionId: string; members: {id:string;name:string;role:string;status:string}[];
  tasks: {id:string;subject:string;status:string;ownerName?:string;blockedBy:string[]}[];
  waiting?: string; failure?: string;
}
export async function readStageTeam(ctx: Context, sessionId: string, lock: StageCapabilityLock | undefined, signal: AbortSignal): Promise<StageTeamRuntime> {
  const root = ctx.agents?.get(sessionId as any);
  let members: StageTeamRuntime['members'] = [], tasks: StageTeamRuntime['tasks'] = [];
  if (root && ctx.agentTeams?.tryMembership(root)) {
    members = ctx.agentTeams.listMembers(root).map(m=>({id:String(m.id),name:m.name,role:m.role,status:m.status}));
    tasks = ctx.agentTeams.listTasks(root).map(t=>({id:t.id,subject:t.subject,status:t.status,ownerName:t.ownerName,blockedBy:[...t.blockedBy]}));
  } else {
    const inspection = await ctx.workdshSessionAccess.inspect(sessionId as any, signal);
    const roster = new Map<string, any>(), board = new Map<string, any>();
    for (const event of inspection.events) {
      if (event.type === 'team/member') roster.set(event.data.member.name, event.data.member);
      if (event.type === 'team/task') board.set(event.data.task.id, event.data.task);
    }
    for (const member of roster.values()) {
      let status = member.phase === 'failed' ? 'failed' : member.phase === 'provisioning' ? 'provisioning' : 'inactive';
      if (member.phase === 'active') {
        try { const child = await ctx.workdshSessionAccess.inspect(member.id, signal); const last=[...child.events].reverse().find(e=>e.type==='turn/start'||e.type==='turn/end');
          status = !last ? 'provisioning' : last.type === 'turn/start' ? 'running' : last.data.reason.kind === 'completed' ? 'inactive' : 'failed';
        } catch { signal.throwIfAborted(); status='unavailable'; }
      }
      members.push({id:member.id,name:member.name,role:'teammate',status});
    }
    tasks = [...board.values()].map(t=>({id:t.id,subject:t.subject,status:t.status,blockedBy:t.blockedBy??[],ownerName:members.find(m=>m.id===t.ownerId)?.name}));
  }
  // An inactive official member is not proof of a successful turn.
  for(const member of members) if(member.role==='teammate'&&member.status==='inactive') {
    try {const inspection=await ctx.workdshSessionAccess.inspect(member.id as any,signal);const boundary=[...inspection.events].reverse().find(e=>e.type==='turn/start'||e.type==='turn/end');
      member.status=!boundary?'provisioning':boundary.type==='turn/start'?'running':boundary.data.reason.kind==='completed'?'inactive':'failed';
    }catch{signal.throwIfAborted();member.status='unavailable';}
  }
  const view: StageTeamRuntime = {sessionId,members,tasks};
  const failed=members.find(m=>m.status==='failed'); if(failed) view.failure='成员执行失败：'+failed.name;
  if (lock?.team) {
    const missing=lock.team.members.find(m=>!members.some(a=>a.name===m.key));
    const busy=members.find(m=>!['inactive'].includes(m.status));
    const pending=tasks.find(t=>!['completed','deleted'].includes(t.status));
    const unassigned=lock.team.members.find(m=>!tasks.some(t=>t.ownerName===m.key&&t.status==='completed'));
    // The official task board owns dependency enforcement; do not accept a sequential
    // configuration when its corresponding dependency chain was never established.
    const predecessors=(id:string,seen=new Set<string>()):Set<string>=>{if(seen.has(id))return seen;seen.add(id);for(const prior of tasks.find(t=>t.id===id)?.blockedBy??[])predecessors(prior,seen);return seen;};
    const unordered=lock.team.strategy==='sequential'?lock.team.members.find((member,index)=>index>0&&!tasks.some(task=>task.ownerName===member.key&&task.status==='completed'&&tasks.some(prior=>prior.ownerName===lock.team!.members[index-1].key&&prior.status==='completed'&&predecessors(task.id).has(prior.id)))):undefined;
    view.waiting=missing?'等待创建配置成员：'+missing.key:busy?'等待成员结束：'+busy.name:pending?'等待团队任务完成：'+pending.subject:unassigned?'等待成员完成任务：'+unassigned.key:unordered?'缺少官方任务前置依赖：'+unordered.key:undefined;
  } else if (lock?.executor?.kind==='team') {
    const busy=members.find(m=>m.status!=='inactive'), pending=tasks.find(t=>!['completed','deleted'].includes(t.status));
    view.waiting=busy?'等待成员结束：'+busy.name:pending?'等待团队任务完成：'+pending.subject:undefined;
  }
  return view;
}
