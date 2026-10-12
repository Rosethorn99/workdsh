import * as React from 'react';
import { Icon } from './Icon.js';
import type { PaletteItem } from './types.js';
const categories=[['输入与输出','entry'],['模型与 Agent','task'],['文件与知识','folder'],['流程控制','branch'],['实用程序','tool']] as const;
export function ComponentLibrary({items,readonly,choose}: {items:PaletteItem[];readonly:boolean;choose:(p:PaletteItem)=>void}) {
  const [search,setSearch]=React.useState(''),[closed,setClosed]=React.useState<string[]>([]);
  const searchRef=React.useRef<HTMLInputElement>(null);
  React.useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='/'&&!(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')){e.preventDefault();searchRef.current?.focus();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const shown=items.filter(p=>(p.name+' '+p.description).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <aside className="lf-library" aria-label="节点库"><div className="lf-library-search"><Icon kind="search"/><input ref={searchRef} aria-label="搜索节点" placeholder="搜索组件…" value={search} onChange={e=>setSearch(e.target.value)}/><kbd>/</kbd></div><div className="lf-library-heading">组件<span>{items.length}</span></div><div className="lf-library-scroll">{categories.map(([category,icon])=>{
    const rows=shown.filter(p=>(p.category??'模型与 Agent')===category);if(!rows.length)return null;
    const expanded=!!search||!closed.includes(category);
    return <section key={category}><button className="lf-category" aria-expanded={expanded} onClick={()=>setClosed(v=>v.includes(category)?v.filter(x=>x!==category):[...v,category])}><Icon kind={icon}/><span>{category}</span><span className={expanded?'lf-chevron-open':''}><Icon kind="chevron" size={14}/></span></button>{expanded&&<div className="lf-category-items">{rows.map(item=><button key={item.id} className="wd-ai-palette-item lf-library-item" disabled={readonly||item.disabled} draggable={!readonly&&!item.disabled} onDragStart={e=>{e.dataTransfer.setData('application/workdsh-node',item.id);e.dataTransfer.effectAllowed='copy';}} onClick={()=>choose(item)} title={item.description}><Icon kind={item.id.includes('file')?'file':item.kind}/><span>{item.name}</span><span className="lf-grip" aria-hidden="true">⠿</span></button>)}</div>}</section>;
  })}{!shown.length&&<p className="lf-empty">没有匹配的组件</p>}</div><div className="lf-library-footer"><Icon kind="layers"/>拖入画布或点击添加</div></aside>;
}
