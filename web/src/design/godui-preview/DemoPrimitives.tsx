import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Plus, Search, X } from "lucide-react";

export function DemoButton({children,onClick,quiet=false,disabled=false}:{children:ReactNode;onClick?:()=>void;quiet?:boolean;disabled?:boolean}){return <button type="button" className={`dm-button ${quiet?"is-quiet":""}`} onClick={onClick} disabled={disabled}>{children}</button>;}
export function DemoPanel({title,eyebrow,children,action,className=""}:{title?:string;eyebrow?:string;children:ReactNode;action?:ReactNode;className?:string}){return <section className={`dm-panel ${className}`}>{(title||action)&&<header>{eyebrow&&<span className="dm-eyebrow">{eyebrow}</span>}<div>{title&&<h2>{title}</h2>}{action}</div></header>}{children}</section>;}
export function DemoTabs({items,value,onChange,label="View"}:{items:readonly string[];value:string;onChange:(v:string)=>void;label?:string}){return <div className="dm-tabs" role="group" aria-label={label}>{items.map(i=><button key={i} aria-pressed={value===i} onClick={()=>onChange(i)}>{i}</button>)}</div>;}
export function DemoSearch({value,onChange,placeholder="Search"}:{value:string;onChange:(s:string)=>void;placeholder?:string}){return <label className="dm-search"><Search size={16}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)}/><kbd>/</kbd></label>;}
export function DemoEmpty({title="Nothing here yet",body="Create something to make this space yours.",action}:{title?:string;body?:string;action?:ReactNode}){return <div className="dm-empty"><span className="dm-empty-mark">✧</span><h3>{title}</h3><p>{body}</p>{action}</div>;}
export function DemoModal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();return()=>{if(previous instanceof HTMLElement)previous.focus();};},[]);
  return <dialog ref={ref} className="dm-modal" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><header><h2>{title}</h2><button onClick={onClose} aria-label="Close dialog"><X size={20}/></button></header>{children}</dialog>;
}
export function DemoField({label,children}:{label:string;children:ReactNode}){return <label className="dm-field"><span>{label}</span>{children}</label>;}
export function DemoBadge({children,tone="silver"}:{children:ReactNode;tone?:"silver"|"green"|"amber"}){return <span className={`dm-badge dm-${tone}`}>{children}</span>;}
export function DemoRow({title,meta,children,onClick}:{title:string;meta?:string;children?:ReactNode;onClick?:()=>void}){return <div className="dm-row">{onClick?<button className="dm-row-open" onClick={onClick}><span><strong>{title}</strong>{meta&&<small>{meta}</small>}</span><ArrowUpRight size={16}/></button>:<span className="dm-row-title"><strong>{title}</strong>{meta&&<small>{meta}</small>}</span>}{children}</div>;}
export function AddLabel({children}:{children:ReactNode}){return <><Plus size={15}/>{children}</>;}
