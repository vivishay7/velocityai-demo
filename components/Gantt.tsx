'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'

export type Task = {
  id: string
  name: string
  project: string
  assignees: string[]
  start: string // ISO
  due: string   // ISO
  baselineDays: number
  slackDays: number
  codPerDay: number
  mvi: number
  status: 'open'|'closed'
  allocatedMinutes?: number
  capability?: boolean
  dependsOn?: string[] // dependency task IDs
}

export type CapEvent = { dayOffset: number; label: string; hours: number; project?: string }

type Row = Task & {
  offsetDays:number
  durationDays:number
  startWeek:number
  spanWeeks:number
  rowIndex:number
}

type Props = {
  tasks: Task[] | undefined
  capacity: CapEvent[]                   // dayOffset relative to first visible day
  onAllocate: (taskId:string, hours:number)=>void
  onComplete: (taskId:string, actualCloseISO:string)=>void
  onView?: (taskId:string)=>void
}

// Hydration‑safe date format (fixed locale + timezone)
const dtf = new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', timeZone:'UTC' })
function fmt(d: Date){ return dtf.format(d) }
function daysBetween(a: Date, b: Date){ return Math.max(1, Math.round((b.getTime()-a.getTime())/86400000)) }

export default function Gantt({tasks, capacity, onAllocate, onComplete, onView}:Props){
  const wrapRef = useRef<HTMLDivElement>(null)
  const [gridW, setGridW] = useState<number | null>(null) // null until measured (avoid hydration mismatches)

  // constants for layout (weekly view)
  const LEFT_COL = 240
  const RIGHT_COL = 260
  const ROW_H = 36
  const HEADER_H = 30
  const CAP_ROW_H = 36

  // measure container width (for column widths) after mount
  useEffect(()=>{
    const el = wrapRef.current
    if(!el) return
    const measure = () => setGridW(el.clientWidth)
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return ()=> obs.disconnect()
  },[])

  const { start, spanWeeks, rows, capByWeek } = useMemo(()=>{
    const open = (tasks ?? []).filter(t=>t.status==='open')

    let minStart = new Date()
    let maxDue = new Date()
    if(open.length>0){
      minStart = new Date(Math.min(...open.map(t=>new Date(t.start).getTime())))
      maxDue   = new Date(Math.max(...open.map(t=>new Date(t.due).getTime())))
    }
    const start = new Date(minStart); start.setDate(start.getDate()-1) // pad
    const end   = new Date(maxDue);   end.setDate(end.getDate()+1)

    const spanDays = Math.max(1, daysBetween(start, end))
    const spanWeeks = Math.max(1, Math.ceil(spanDays/7))

    const rows: Row[] = open.map((t,idx)=>{
      const s = new Date(t.start), d = new Date(t.due)
      const offsetDays = daysBetween(start, s)
      const durationDays = daysBetween(s, d)
      const startWeek = Math.floor(offsetDays/7)
      const spanW = Math.max(1, Math.ceil(durationDays/7))
      return { ...t, offsetDays, durationDays, startWeek, spanWeeks: spanW, rowIndex: idx }
    })

    const capByWeek: Record<number, {hours:number; labels:string[]}> = {}
    capacity.forEach(ev=>{
      const wk = Math.max(0, Math.floor(ev.dayOffset/7))
      if(!capByWeek[wk]) capByWeek[wk] = {hours:0, labels:[]}
      capByWeek[wk].hours += ev.hours
      if(capByWeek[wk].labels.length < 3) capByWeek[wk].labels.push(ev.label)
    })

    return { start, spanWeeks, rows, capByWeek }
  },[tasks, capacity])

  // header labels (by week)
  const headerWeeks = Array.from({length: spanWeeks}, (_,i)=>{
    const d = new Date(start); d.setDate(d.getDate()+i*7)
    return <div key={i} className="cell">{fmt(d)}</div>
  })

  // we’ll attach a ref to each task bar so arrows anchor exactly to bars
  const barRefs = useRef<Record<string, HTMLDivElement|null>>({})
  const setBarRef = (id:string) => (el:HTMLDivElement|null) => { barRefs.current[id] = el }

  // Build elbow paths using DOM positions (no math drift)
  const [paths, setPaths] = useState<string[]>([])
  useEffect(()=>{
    if(gridW === null || !wrapRef.current) return
    const wrapRect = wrapRef.current.getBoundingClientRect()
    const p:string[] = []
    rows.forEach(r=>{
      r.dependsOn?.forEach(dep=>{
        const from = barRefs.current[dep]
        const to   = barRefs.current[r.id]
        if(!from || !to) return
        const a = from.getBoundingClientRect()
        const b = to.getBoundingClientRect()
        const x1 = a.right - wrapRect.left
        const y1 = a.top + a.height/2 - wrapRect.top
        const x2 = b.left - wrapRect.left
        const y2 = b.top + b.height/2 - wrapRect.top
        const midX = x1 + (x2 - x1) * 0.5
        p.push(`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`)
      })
    })
    setPaths(p)
  },[rows, gridW])

  return (
    <div className="gantt" ref={wrapRef}>
      {/* Legend */}
      <div className="legend">
        <span className="dot red"></span> Critical (0 slack)
        <span className="dot amber" style={{marginLeft:16}}></span> Near (&le; 1 week slack)
        <span className="dot green" style={{marginLeft:16}}></span> On track (&gt; 1 week)
      </div>

      {/* SVG arrows (after measured) */}
      {gridW !== null && (
        <svg className="depsSvg" width="100%" height={HEADER_H + CAP_ROW_H + rows.length * ROW_H}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,3 L0,6 Z" fill="#6aa7ff" />
            </marker>
          </defs>
          {paths.map((d,i)=>(
            <path key={i} d={d} fill="none" stroke="#6aa7ff" strokeWidth="2" markerEnd="url(#arrow)" />
          ))}
        </svg>
      )}

      {/* Grid */}
      <div className="ganttGrid" style={{gridTemplateColumns: `240px repeat(${spanWeeks}, 1fr) 260px`}}>
        <div className="ganttHeader">
          <div className="cell headT">Task</div>
          {headerWeeks}
          <div className="cell headA">Actions</div>
        </div>

        {/* Weekly capacity row */}
        <div className="taskCell">Freed capacity (weekly)</div>
        {Array.from({length: spanWeeks}).map((_,i)=>{
          const wk = capByWeek[i]
          return <div key={i} className="dayCell">
            {wk && <div className="capPill">+{wk.hours}h freed</div>}
          </div>
        })}
        <div className="actionCell"><span className="small">Weekly totals (tool details in the table below)</span></div>

        {/* Task rows */}
        {rows.map(r=>{
          const allocHrs = Math.round(((r.allocatedMinutes||0)/60)*10)/10
          const slackW = r.slackDays/7
          const state = slackW<=0 ? 'hot' : (slackW<=1 ? 'amber' : 'ok')
          const label = state==='hot' ? 'Critical' : state==='amber' ? 'Near' : 'On‑track'
          return (
            <div key={r.id} className="ganttRow">
              <div className="taskCell">
                <div className="tName">{r.name}</div>
                <div className="small">
                  {r.project} • Baseline {r.baselineDays}d • CoD ${r.codPerDay.toLocaleString()}
                  {r.capability ? ' • Capability' : ''}
                </div>
              </div>

              {Array.from({length: spanWeeks}).map((_,i)=>{
                const isStart = i===r.startWeek
                return <div key={i} className="dayCell">
                  {isStart && (
                    <div ref={setBarRef(r.id)} className={`bar ${state}`} style={{left:0, width:`calc(${r.spanWeeks}00% / ${spanWeeks})`}}>
                      <span>{label}</span>
                      {allocHrs>0 && <span className="allocPill">{allocHrs}h allocated</span>}
                    </div>
                  )}
                </div>
              })}

              <div className="actionCell">
                <input className="input" style={{width:90}} type="number" min={1} defaultValue={8} id={`alloc-${r.id}`} />
                <button className="btn" onClick={()=>{
                  const el = document.getElementById(`alloc-${r.id}`) as HTMLInputElement|null
                  const v = (el?.valueAsNumber ?? 0) || 4
                  onAllocate(r.id, v)
                }}>Allocate</button>
                <button className="btn secondary" onClick={()=>{
                  const val = prompt('Actual close date (YYYY-MM-DD):', new Date().toISOString().slice(0,10))
                  if(val){ onComplete(r.id, new Date(val).toISOString()) }
                }}>Mark complete</button>
                {onView && <button className="btn ghost" onClick={()=>onView(r.id)}>View</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
