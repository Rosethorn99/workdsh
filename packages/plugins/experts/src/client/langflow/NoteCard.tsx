// Adapted from Langflow NoteNode; WorkDSH stores notes in layout.json, outside executable stages.
// Copyright (c) 2024 Langflow. MIT; see resources/langflow/LICENSE.
import * as React from 'react';
import { NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CanvasNote } from './types.js';
export interface NoteData extends Record<string,unknown> { note:CanvasNote;readonly:boolean;change:(id:string,values:Partial<CanvasNote>)=>void;remove:(id:string)=>void }
export function NoteCard({data,selected}:NodeProps<Node<NoteData>>) {
  return <div className="lf-note" style={{background:data.note.color}} aria-label="画布注释"><NodeResizer isVisible={selected&&!data.readonly} minWidth={280} minHeight={180} maxWidth={1600} maxHeight={1200} onResizeEnd={(_,p)=>data.change(data.note.id,{x:p.x,y:p.y,width:p.width,height:p.height})}/><NodeToolbar isVisible={selected&&!data.readonly} position={Position.Top}><div className="lf-node-toolbar nodrag">{['#c0ddff','#fef0ba','#d3eedb','#eadcff'].map(color=><button key={color} aria-label={'注释颜色 '+color} style={{background:color,width:24}} onClick={()=>data.change(data.note.id,{color})}>●</button>)}<button onClick={()=>data.remove(data.note.id)}>删除注释</button></div></NodeToolbar><textarea className="nodrag nowheel" aria-label="注释内容" disabled={data.readonly} value={data.note.text} maxLength={5000} onChange={e=>data.change(data.note.id,{text:e.target.value})} placeholder="写下流程说明、步骤或注意事项…"/></div>;
}
