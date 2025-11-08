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
  capacity: CapEvent[]                   // dayOffset is relative to first visible day
  onAllocate: (taskId:string, hours:number)=>void
  onComplete: (taskId:string, actualCloseISO:string)=>void
  onView?: (taskId:string)=>void
}

// Hydration-safe date format (fixed locale + timezone)
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

    // determine overall date range
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

    // rows with weekly positions
    const rows: Row[] = open.map((t,idx)=>{
      const s = new Date(t.start), d = new Date(t.due)
      const offsetDays = daysBetween(start, s)
      const durationDays = daysBetween(s, d)
      const startWeek = Math.floor(offsetDays/7)
      const spanW = Math.max(1, Math.ceil(durationDays/7))
      return { ...t, offsetDays, durationDays, startWeek, spanWeeks: spanW, rowIndex: idx }
    })

    // capacity aggregated by week
    const capByWeek: Record<number, {hours:number; labels:string[]}> = {}
    capacity.forEach(ev=>{
      const wk = Math.max(0, Math.floor(ev.dayOffset/7))
      if(!capByWeek[wk]) capByWeek[wk] = {hours:0, labels:[]}
      capByWeek[wk].hours += ev.hours
      if(capByWeek[wk].labels.length < 3) capByWeek[wk].labels.push(ev.label) // keep it short
    })

    return { start, spanWeeks, rows, capByWeek }
  },[tasks, capacity])

  // header labels (by week)
  const headerWeeks = Array.from({length: spanWeeks}, (_,i)=>{
    const d = new Date(start); d.setDate(d.getDate()+i*7)
    return <div key={i} className="cell">{fmt(d)}</div>
  })

  // simple dependency arrows (weekly granularity), only after measured
  const colW = gridW
    ? Math.max(40, (gridW - LEFT_COL - RIGHT_COL) / Math.max(1, spanWeeks))
    : 80 // fallback before measurement
  const svgH = HEADER_H + CAP_ROW_H + rows.length * ROW_H

  const deps: {x1:number;y1:number;x2:number;y2:number}[] = []
  const indexById: Record<string, Row> = {}
  rows.forEach(r => { indexById[r.id] = r })
  rows.forEach(r=>{
    r.dependsOn?.forEach(depId=>{
      const from = indexById[depId]; if(!from) return
      // from end of dependency to start of current
      const x1 = LEFT_COL + (from.startWeek + from.spanWeeks) * colW
      const x2 = LEFT_COL + r.startWeek * colW
      const y1 = HEADER_H + CAP_ROW_H + from.rowIndex * ROW_H + ROW_H/2
      const y2 = HEADER_H + CAP_ROW_H + r.rowIndex * ROW_H + ROW_H/2
      deps.push({x1, y1, x2, y2})
    })
  })

  return (
    <div className="gantt" ref={wrapRef}>
      {/* Legend */}
      <div className="legend">
        <span className="dot red"></span> Critical (0 slack)
        <span className="dot amber" style={{marginLeft:16}}></span> Near (&le; 1 week slack)
        <span className="dot green" style={{marginLeft:16}}></span> On track (&gt; 1 week)
      </div>

      {/* SVG arrows (render only after measured to avoid hydration mismatches) */}
      {gridW !== null && (
        <svg width="100%" height={svgH} className="depsSvg">
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,3 L0,6 Z" fill="#6aa7ff" />
            </marker>
          </defs>
          {deps.map((p,i)=>(
            <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="#6aa7ff" strokeWidth="2" markerEnd="url(#arrow)" />
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
            {wk && (
              <div className="capPill">+{wk.hours}h freed</div>
            )}
          </div>
        })}
        <div className="actionCell"><span className="small">Weekly totals (tool details in the table below)</span></div>

        {/* Task rows */}
        {rows.map(r=>{
          const allocHrs = Math.round(((r.allocatedMinutes||0)/60)*10)/10
          // color by slack (weekly granularity)
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
                    <div className={`bar ${state}`} style={{left:0, width:`calc(${r.spanWeeks}00% / ${spanWeeks})`}}>
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
