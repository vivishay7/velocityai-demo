'use client'
import React, { useMemo } from 'react'

export type Task = {
  id: string; name: string; project: string; assignees: string[];
  start: string; due: string; baselineDays: number; slackDays: number;
  codPerDay: number; mvi: number; status: 'open'|'closed';
  allocatedMinutes?: number; capability?: boolean;
}

export type CapEvent = { dayOffset: number; label: string; hours: number }

type Props = {
  tasks: Task[];
  capacity: CapEvent[];                      // freed-time markers on the timeline
  onAllocate: (taskId:string, hours:number)=>void;
  onComplete: (taskId:string, actualCloseISO:string)=>void;
}

function fmt(d:Date){ return d.toLocaleDateString(undefined,{month:'short', day:'numeric'}) }
function daysBetween(a:Date,b:Date){ return Math.max(1, Math.round((b.getTime()-a.getTime())/86400000)) }

export default function Gantt({tasks, capacity, onAllocate, onComplete}:Props){
  const { start, end, spanDays, gridCols, rows, capByDay } = useMemo(()=>{
    const open = tasks.filter(t=>t.status==='open')
    const minStart = new Date(Math.min(...open.map(t=>new Date(t.start).getTime())))
    const maxDue = new Date(Math.max(...open.map(t=>new Date(t.due).getTime())))
    const start = new Date(minStart); start.setDate(start.getDate()-1)
    const end = new Date(maxDue); end.setDate(end.getDate()+1)
    const spanDays = daysBetween(start,end)
    const gridCols = `220px repeat(${spanDays}, 1fr) 240px`
    const rows = open.map(t=>{
      const s = new Date(t.start)
      const d = new Date(t.due)
      const offset = daysBetween(start, s)
      const duration = daysBetween(s, d)
      return {...t, offset, duration}
    })
    // spread capacity events by day index
    const capByDay: Record<number, CapEvent[]> = {}
    capacity.forEach(ev=>{
      if(ev.dayOffset<0 || ev.dayOffset>spanDays-1) return
      capByDay[ev.dayOffset] = capByDay[ev.dayOffset] || []
      capByDay[ev.dayOffset].push(ev)
    })
    return { start, end, spanDays, gridCols, rows, capByDay }
  },[tasks, capacity])

  const dayHeader = Array.from({length: spanDays}, (_,i)=>{
    const d = new Date(start); d.setDate(d.getDate()+i)
    return <div key={i} className="cell">{fmt(d)}</div>
  })

  return (
    <div className="gantt">
      <div className="ganttGrid" style={{gridTemplateColumns: gridCols}}>
        {/* Header row */}
        <div className="ganttHeader">
          <div className="cell" style={{padding:'6px 8px', fontWeight:600}}>Task</div>
          {dayHeader}
          <div className="cell" style={{padding:'6px 8px', fontWeight:600}}>Actions</div>
        </div>

        {/* Capacity row */}
        <div className="taskCell">Freed capacity (events)</div>
        {Array.from({length: spanDays}).map((_,i)=>{
          const events = capByDay[i] || []
          return (
            <div key={i} className="dayCell">
              {events.map((ev,idx)=>(
                <div key={idx} className="capPill">+{ev.hours}h • {ev.label}</div>
              ))}
            </div>
          )
        })}
        <div className="actionCell"><span className="small">Pills show when and where time was freed.</span></div>

        {/* Task rows */}
        {rows.map((r)=>{
          const allocHrs = Math.round(((r.allocatedMinutes||0)/60)*10)/10
          const isHot = r.slackDays<=0
          return (
            <>
              <div className="taskCell">
                <div>{r.name}</div>
                <div className="small">
                  {r.project} • Baseline {r.baselineDays}d • CoD ${r.codPerDay.toLocaleString()}
                  {r.capability && ' • Capability'}
                </div>
              </div>
              {Array.from({length: spanDays}).map((_,i)=>{
                const isBarStart = i===r.offset
                return (
                  <div key={i} className="dayCell">
                    {isBarStart && (
                      <div className={`bar ${isHot?'hot':'warm'}`}
                           style={{left:0, right:0, width:`calc(${r.duration}00% / ${spanDays})`}}>
                        <span>{isHot? 'Critical' : 'Near-critical'}</span>
                        {allocHrs>0 && <span className="allocPill">{allocHrs}h allocated</span>}
                      </div>
                    )}
                  </div>
                )
              })}
              <div className="actionCell">
                <input className="input" style={{width:80}} type="number" min={1} defaultValue={4} id={`alloc-${r.id}`} />
                <button className="btn" onClick={()=>{
                  const v = (document.getElementById(`alloc-${r.id}`) as HTMLInputElement).valueAsNumber || 2
                  onAllocate(r.id, v)
                }}>Allocate</button>
                <button className="btn secondary" onClick={()=>{
                  const val = prompt('Actual close date (YYYY-MM-DD):', new Date().toISOString().slice(0,10))
                  if(val){ const iso=new Date(val).toISOString(); onComplete(r.id, iso) }
                }}>Mark complete</button>
              </div>
            </>
          )
        })}
      </div>
    </div>
  )
}
