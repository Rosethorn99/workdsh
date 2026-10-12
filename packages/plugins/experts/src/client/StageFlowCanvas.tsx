import * as React from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Panel, MarkerType, applyNodeChanges,
  type Node, type Edge, type Connection, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import flowCss from '@xyflow/react/dist/style.css';
import { graphEdges, type GraphEdge } from '../workflows/graph-operations.js';
import { defaultCanvasLayout, entryNodeId } from '../workflows/canvas-operations.js';
import { effectiveExecution, type WorkflowManifest, type WorkflowStage, type CapabilityCatalog } from '../workflows/authoring.js';
import { NodeCard } from './langflow/NodeCard.js';
import { ComponentLibrary } from './langflow/ComponentLibrary.js';
import { NoteCard, type NoteData } from './langflow/NoteCard.js';
import { ConnectionLine } from './langflow/ConnectionLine.js';
import { getHelperLines, getSnapPosition, type HelperLinesState } from './langflow/upstream/helper-lines.js';
import { MIN_ZOOM, MAX_ZOOM, FIT_VIEW_OPTIONS } from './langflow/upstream/fit-view-options.js';
import { langflowCss } from './langflow/styles.js';
import type { CardData, PaletteItem, CanvasNote } from './langflow/types.js';
export { NodeIcon } from './langflow/Icon.js';
export type { PaletteItem } from './langflow/types.js';
export const stageEditorCss=flowCss+langflowCss;
const colors={task:'#7154f0',branch:'#a057d3',approval:'#c99532',check:'#459b83',end:'#92929f'};
const nodeTypes={workflow:NodeCard,note:NoteCard};
const emptyNotes:CanvasNote[]=[];
type CanvasNode=Node<CardData>|Node<NoteData>;
export function StageCanvas({manifest,layout,readonly,selected,select,insert,moved,names={},states={},connect,disconnect,remove,duplicate,positionsChanged,palette=[],add,error,valid,selectionToken,patchStage,inspectNode,catalog,notes=emptyNotes,noteChanged,noteRemoved,viewChanged,removeSelection}: {
  selectionToken?:{ids:string[];version:number};manifest:WorkflowManifest;layout:any;readonly:boolean;selected:string;select:(id:string)=>void;
  insert:(edge:GraphEdge)=>void;moved:(id:string,p:{x:number;y:number})=>void;
  names?:Record<string,string>;states?:Record<string,string>;scale?:number;setScale?:(v:number)=>void;place?:(edge:GraphEdge)=>void;
  connect?:(edge:GraphEdge,previous?:GraphEdge)=>void;disconnect?:(edge:GraphEdge)=>void;
  remove?:(ids:string[])=>void;duplicate?:(ids:string[])=>void;positionsChanged?:(p:Record<string,{x:number;y:number}>,notes?:Record<string,{x:number;y:number}>)=>void;
  removeSelection?:(stageIds:string[],noteIds:string[])=>void;
  palette?:PaletteItem[];add?:(item:PaletteItem,p:{x:number;y:number})=>void;error?:(message:string)=>void;valid?:(edge:GraphEdge,previous?:GraphEdge)=>boolean;
  patchStage?:(id:string,values:Partial<WorkflowStage>)=>void;inspectNode?:(id:string,tab?:'basic'|'capabilities'|'outputs')=>void;catalog?:CapabilityCatalog;
  notes?:CanvasNote[];noteChanged?:(id:string,values:Partial<CanvasNote>)=>void;noteRemoved?:(id:string)=>void;viewChanged?:(v:Viewport)=>void;
}) {
  const [flow,setFlow]=React.useState<ReactFlowInstance<CanvasNode,Edge>>(),[edgeId,setEdgeId]=React.useState<string>(),[selection,setSelection]=React.useState<string[]>([]),[guides,setGuides]=React.useState<HelperLinesState>({}),[view,setView]=React.useState<Viewport>({x:0,y:0,zoom:1});
  const viewRequested=React.useRef(false),clickSelection=React.useRef<string[]>([]),viewport=React.useRef<HTMLDivElement>(null),dragging=React.useRef(false),reconnecting=React.useRef<GraphEdge|undefined>(undefined),auto=defaultCanvasLayout(manifest);
  const sourceNodes=():CanvasNode[]=>[
    {id:entryNodeId,type:'workflow',zIndex:1,position:layout?.mode==='manual'&&layout.stages?.[entryNodeId]||auto[entryNodeId],data:{name:'开始',entry:true,readonly,state:states[manifest.start??'']==='执行中'?'已启动':'流程入口'}},
    ...(manifest.stages??[]).map(n=>{let effective=n.execution;try{effective=effectiveExecution(manifest,n);}catch{}return {id:n.id,type:'workflow',zIndex:1,position:layout?.mode==='manual'&&layout.stages?.[n.id]||auto[n.id],data:{stage:n,effective,name:n.name,readonly,catalog,state:states[n.id]??(n.kind==='task'&&!n.prompt?.trim()?'待配置':'未运行'),executor:effective?.executor&&effective.executor.kind!=='workflow'?names[effective.executor.expertId+'|'+effective.executor.revisionId]:undefined,patch:patchStage,inspect:inspectNode??select,duplicate,remove}};}),
    ...notes.map(n=>({id:n.id,type:'note',zIndex:0,position:{x:n.x,y:n.y},style:{width:n.width??380,height:n.height??260},data:{note:n,readonly,change:(id:string,v:Partial<CanvasNote>)=>noteChanged?.(id,v),remove:(id:string)=>noteRemoved?.(id)}}))
  ];
  const [nodes,setNodes]=React.useState<CanvasNode[]>(sourceNodes);
  React.useEffect(()=>{if(!dragging.current)setNodes(current=>sourceNodes().map(n=>({...current.find(c=>c.id===n.id),...n,selected:!!current.find(c=>c.id===n.id)?.selected})));},[manifest,layout,selected,readonly,catalog,JSON.stringify(names),JSON.stringify(states),notes]);
  React.useEffect(()=>{if(selectionToken){setNodes(current=>current.map(n=>({...n,selected:selectionToken.ids.includes(n.id)})));setSelection(selectionToken.ids);}},[selectionToken?.version]);
  const autoFitKey=layout?.mode==='auto'&&!layout?.viewport?JSON.stringify(auto):'';
  React.useEffect(()=>{if(!flow||!autoFitKey)return;viewRequested.current=false;let frame=0;const first=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{void flow.fitView({minZoom:FIT_VIEW_OPTIONS.minZoom,maxZoom:FIT_VIEW_OPTIONS.maxZoom,padding:FIT_VIEW_OPTIONS.padding});});});return()=>{cancelAnimationFrame(first);cancelAnimationFrame(frame);};},[flow,autoFitKey]);
  const allEdges=[...(manifest.start?[{from:entryNodeId,port:'next' as const,target:manifest.start}]:[]),...graphEdges(manifest)].filter(e=>e.target);
  const edges:Edge[]=allEdges.map(e=>({id:e.from+':'+e.port,source:e.from,target:e.target,sourceHandle:e.port,targetHandle:'in',type:'default',label:e.port==='next'?undefined:e.port==='whenTrue'?'是':'否',selected:edgeId===e.from+':'+e.port,animated:states[e.from]==='执行中',reconnectable:!readonly,style:{stroke:states[e.from]==='已验收'?'#459b83':edgeId===e.from+':'+e.port?'#7154f0':'#9c9ca7',strokeWidth:1.5},markerEnd:{type:MarkerType.ArrowClosed,width:12,height:12,color:'#9c9ca7'},labelStyle:{fontSize:10,fill:'#777785'},labelBgStyle:{fill:'var(--dsw-alias-bg-layer-2,#f5f5f7)'},data:{edge:e}}));
  const toEdge=(c:Connection):GraphEdge=>({from:c.source,port:(c.sourceHandle??'next') as GraphEdge['port'],target:c.target});
  const selectedEdge=allEdges.find(e=>e.from+':'+e.port===edgeId),taskIds=selection.filter(id=>id!==entryNodeId&&!notes.some(n=>n.id===id));
  const center=()=>{const box=viewport.current?.getBoundingClientRect();return flow?.screenToFlowPosition({x:(box?.left??0)+(box?.width??800)/2,y:(box?.top??0)+(box?.height??600)/2})??{x:360,y:200};};
  const choose=(item:PaletteItem,p=center())=>{if(!readonly&&!item.disabled)add?.(item,{x:p.x-152,y:p.y-80});};
  const deleteSelection=()=>{const noteIds=selection.filter(id=>notes.some(n=>n.id===id));if(removeSelection)removeSelection(taskIds,noteIds);else {if(taskIds.length)remove?.(taskIds);noteIds.forEach(id=>noteRemoved?.(id));}};
  return <div className="wd-stage-canvas">{!readonly&&<ComponentLibrary items={palette} readonly={readonly} choose={choose}/>}<div ref={viewport} className="wd-stage-viewport" tabIndex={0} aria-label="AI 流程画布" onPointerDownCapture={e=>{viewRequested.current=!!(e.target as Element).closest('.react-flow__controls,.wd-stage-outline');clickSelection.current=nodes.filter(n=>n.selected).map(n=>n.id);}} onKeyDown={e=>{if((e.target as Element).closest('input,textarea,select,[contenteditable=true]'))return;if(!readonly&&(e.key==='Delete'||e.key==='Backspace')&&selection.length){e.preventDefault();deleteSelection();}if(!readonly&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'&&taskIds.length){e.preventDefault();duplicate?.(taskIds);}if(e.key==='Escape'){select('');setEdgeId(undefined);}}} onDragOver={e=>{if(!readonly){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={e=>{e.preventDefault();const item=palette.find(p=>p.id===e.dataTransfer.getData('application/workdsh-node'));if(item&&flow)choose(item,flow.screenToFlowPosition({x:e.clientX,y:e.clientY}));}}>
    <ReactFlow<CanvasNode,Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlow} fitView={!layout?.viewport} defaultViewport={layout?.viewport??{x:48,y:50,zoom:.8}} fitViewOptions={FIT_VIEW_OPTIONS} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} nodesDraggable={!readonly} nodesConnectable={!readonly} edgesReconnectable={!readonly} deleteKeyCode={null} panOnDrag={[0,1,2]} panOnScroll zoomOnScroll selectionKeyCode="Shift" multiSelectionKeyCode="Shift" connectionRadius={24} snapToGrid snapGrid={[8,8]} connectionLineComponent={ConnectionLine}
      onNodesChange={changes=>setNodes(current=>applyNodeChanges(changes,current))}
      onNodeDragStart={()=>{dragging.current=true;}} onNodeDrag={(_,node,list)=>{if(list.length<=1){const rest=nodes.filter(n=>n.id!==node.id),snapped=getSnapPosition(node,rest,304,300);setNodes(current=>current.map(n=>n.id===node.id?{...n,position:snapped}:n));setGuides(getHelperLines({...node,position:snapped},rest,304,300));}}}
      onNodeDragStop={(_,node,list)=>{dragging.current=false;setGuides({});const changed=list.length>1?list:[{...node,position:getSnapPosition(node,nodes.filter(n=>n.id!==node.id),304,300)}],updates=Object.fromEntries(changed.filter(n=>n.type!=='note').map(n=>[n.id,n.position])),noteUpdates=Object.fromEntries(changed.filter(n=>n.type==='note').map(n=>[n.id,n.position]));if(positionsChanged)positionsChanged(updates,noteUpdates);else {Object.entries(updates).forEach(([id,p])=>moved(id,p));Object.entries(noteUpdates).forEach(([id,p])=>noteChanged?.(id,p));}}}
      onMove={(_,v)=>setView(v)} onMoveEnd={(event,v)=>{setView(v);if(!readonly&&(event||viewRequested.current)){viewRequested.current=false;viewChanged?.(v);}}}
      onSelectionChange={({nodes})=>setSelection(nodes.map(n=>n.id))} onNodeClick={(event,n)=>{const ids=new Set(event.shiftKey?clickSelection.current:[]);if(event.shiftKey&&ids.has(n.id))ids.delete(n.id);else ids.add(n.id);setNodes(current=>current.map(node=>({...node,selected:ids.has(node.id)})));setSelection([...ids]);if(n.type!=='note')select(n.id);setEdgeId(undefined);}}
      onPaneClick={()=>{setNodes(current=>current.map(n=>({...n,selected:false})));setSelection([]);select('');setEdgeId(undefined);}} onEdgeClick={(_,edge)=>{setEdgeId(edge.id);select('');}}
      onConnect={c=>connect?.(toEdge(c))} onReconnect={(old,c)=>connect?.(toEdge(c),old.data?.edge as GraphEdge)} onReconnectStart={(_,edge)=>{reconnecting.current=edge.data?.edge as GraphEdge;}} onReconnectEnd={()=>{reconnecting.current=undefined;}} isValidConnection={c=>valid?.(toEdge(c as Connection),reconnecting.current)??true}
      onConnectEnd={(_,state)=>{if(!state.isValid&&state.toNode)error?.('此连接无效：不能连接到开始节点、形成循环或使用错误端口。');}} ariaLabelConfig={{'controls.zoomIn.ariaLabel':'放大画布','controls.zoomOut.ariaLabel':'缩小画布','controls.fitView.ariaLabel':'适应画布','controls.interactive.ariaLabel':'切换交互'}}>
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#b8b8c6" style={{zIndex:0}}/>
      {guides.horizontal&&<div style={{position:'absolute',pointerEvents:'none',zIndex:4,left:0,right:0,top:guides.horizontal.position*view.zoom+view.y,borderTop:'1px dashed #a78cef'}}/>}
      {guides.vertical&&<div style={{position:'absolute',pointerEvents:'none',zIndex:4,top:0,bottom:0,left:guides.vertical.position*view.zoom+view.x,borderLeft:'1px dashed #a78cef'}}/>}
      {selectedEdge&&!readonly&&<Panel position="top-center"><div className="wd-ai-edgebar"><span>已选中连线</span>{selectedEdge.from!==entryNodeId&&<button onClick={()=>insert(selectedEdge)}>＋ 在线上插入</button>}<button onClick={()=>{disconnect?.(selectedEdge);setEdgeId(undefined);}}>断开连接</button></div></Panel>}
      {taskIds.length>1&&!readonly&&<Panel position="bottom-center"><div className="wd-ai-selectionbar"><span>已选 {taskIds.length} 个节点</span><button onClick={()=>duplicate?.(taskIds)}>复制 Ctrl D</button><button onClick={deleteSelection}>删除</button></div></Panel>}
      <Panel position="top-right"><details><summary style={{fontSize:11,opacity:.65,cursor:'pointer'}}>节点导航 · {manifest.stages?.length??0}</summary><div className="wd-stage-outline">{(manifest.stages??[]).map(n=><button key={n.id} onClick={()=>{setNodes(current=>current.map(v=>({...v,selected:v.id===n.id})));setSelection([n.id]);select(n.id);const p=flow?.getNode(n.id)?.position;if(p)void flow?.setCenter(p.x+152,p.y+140,{zoom:.9,duration:250});}}>{n.name}</button>)}</div></details></Panel>
      <Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={n=>n.type==='note'?'#b5d3f3':colors[(n.data.stage as WorkflowStage)?.kind??'task']} maskColor="#aaaabb17" style={{width:140,height:88}}/>
    </ReactFlow>
  </div></div>;
}
