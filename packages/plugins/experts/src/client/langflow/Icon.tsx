import * as React from 'react';
const paths: Record<string, React.ReactNode> = {
  task: <><rect x="4" y="6" width="16" height="13" rx="4"/><path d="M12 2v4M8 11h.01M16 11h.01M9 15h6M2 10v5M22 10v5"/></>,
  branch: <><path d="M8 3v5c0 4 8 4 8 8v5M8 8c0 4-4 4-4 8v5M4 18l-3 3M4 21l3-3M16 18l-3 3M16 21l3-3"/></>,
  approval: <><circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3M9 17l2 2 4-4"/></>,
  check: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 12 3 3 5-6"/></>,
  end: <><circle cx="12" cy="12" r="9"/><rect x="8" y="8" width="8" height="8" rx="1"/></>,
  entry: <path d="m8 4 12 8-12 8V4Z"/>,
  file: <><path d="M14 2H5v20h14V7Z M14 2v6h5M8 12h8M8 16h8"/></>,
  note: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h5"/></>,
  folder: <path d="M2 6h8l2 3h10v12H2V6Z"/>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/></>,
  search: <><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,
  layers: <><path d="m12 2 10 6-10 6L2 8l10-6ZM2 13l10 6 10-6M2 18l10 6 10-6"/></>,
  tool: <><path d="m14 5 5-3-1 6-5 4-8 9-3-3 9-9V4l3 1Z"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
};
export function Icon({kind, size=17}: {kind: string; size?: number}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[kind] ?? paths.task}</svg>;
}
export function NodeIcon({kind,color}: {kind: string; color?: string}) {
  return <span className="wd-ai-icon" style={{color}}><Icon kind={kind}/></span>;
}
