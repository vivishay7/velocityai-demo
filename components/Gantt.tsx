'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'

export type Task = {
  id: string
  name: string
  project: string
  assignees: string[]
  start: string  // ISO
  due: string    // ISO
  baselineDays: number
  slackDays: number
  codPerDay: number
  mvi: number
  status: 'open' | 'closed'
  allocatedMinutes?: number
  capability?: boolean
  dependsOn?: string       // predecessor ID for arrows
}

export type CapEvent = {
  dayOffset: number        // days from first visible day
  label: string            // “Copilot: shorter meeting”
  hours: number
  project?: string
}

type Row = Task & {
  startWeek: number
  weeksLong: number
  rowIndex: number
}

type Props = {
  tasks: Task[] | undefined
  capacity: CapEvent[]
  onAllocate: (taskId: string, hours: number) => void
  onComplete: (taskId: string, actualCloseISO: string) => void
  onView?: (taskId: string) => void
}

// Hydration‑safe date format
const dtf = new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', timeZone:'UTC' })
const fmt = (d: Date) => dtf.format(d)
const daysBetween = (a: Date, b: Date) => Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000))

export default function Gantt({ tasks, capacity, onAllocate, onComplete, onView }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [gridW, setGridW] = useState<number | null>(null) // null until measured

  // layout constants (WEEK view)
  const LEFT_COL = 280
  const RIGHT_COL = 280
  const ROW_H = 36
  const HEADER_H = 30
  const CAP_ROW_H = 36
  const MIN_WEEKS = 5

  // measure container after mount
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setGridW(el.clientWidth)
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // compute weekly grid, rows, weekly capacity
  const { start, totalWeeks, rows, capWeeks } = useMemo(() => {
    const open = (tasks ?? []).filter(t => t.status === 'open')
    let minStart = new Date()
    let maxDue = new Date()
    if (open.length > 0) {
      minStart = new Date(Math.min(...open.map(t => new Date(t.start).getTime())))
      maxDue = new Date(Math.max(...open.map(t => new Date(t.due).getTime())))
    }
    const start = new Date(minStart); start.setDate(start.getDate() - 1)
    const end = new Date(maxDue); end.setDate(end.getDate() + 1)

    const spanDays = daysBetween(start, end)
    const totalWeeks = Math.max(MIN_WEEKS, Math.ceil(spanDays / 7))

    const rows: Row[] = open.map((t, idx) => {
      const s = new Date(t.start), d = new Date(t.due)
      const startWeek = Math.floor(daysBetween(start, s) / 7)
      const weeksLong = Math.max(1, Math.ceil(daysBetween(s, d) / 7))
      return { ...t, startWeek, weeksLong, rowIndex: idx }
    })

    const capWeeks: Record<number, number> = {}
    capacity.forEach(ev => {
      const wk = Math.floor(ev.dayOffset / 7)
      if (wk < 0 || wk > totalWeeks - 1) return
      capWeeks[wk] = (capWeeks[wk] || 0) + ev.hours
    })

    return { start, totalWeeks, rows, capWeeks }
  }, [tasks, capacity])

  // header “Week 1…”
  const header = Array.from({ length: totalWeeks }, (_, i) => (
    <div key={i} className="cell">{`Week ${i+1}`}</div>
  ))

  // bar refs for arrows
  const barRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const setBarRef = (id: string) => (el: HTMLDivElement | null) => { barRefs.current[id] = el }

  // elbow connector paths anchored to bars
  const [paths, setPaths] = useState<string[]>([])
  useEffect(() => {
    if (gridW === null || !wrapRef.current) return
    const wrapRect = wrapRef.current.getBoundingClientRect()
    const p: string[] = []
    rows.forEach(r => {
      if (!r.dependsOn) return
      const fromEl = barRefs.current[r.dependsOn]
      const toEl = barRefs.current[r.id]
      if (!fromEl || !toEl) return
      const a = fromEl.getBoundingClientRect()
      const b = toEl.getBoundingClientRect()
      const x1 = a.right - wrapRect.left
      const y1 = a.top + a.height / 2 - wrapRect.top
      const x2 = b.left - wrapRect.left
      const y2 = b.top + b.height / 2 - wrapRect.top
      const midX = x1 + (x2 - x1) * 0.5
      p.push(`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`)
    })
    setPaths(p)
  }, [rows, gridW])

  return (
    <div className="gantt" ref={wrapRef}>
      {/* Legend */}
      <div className="legendItem"><div className="legendColor yellow"></div> Near‑crit (slack &le; 1 week)</div> <div className="legendItem"><div className="legendColor green"></div> On track (slack &gt; 1 week)</div>
      {/* Arrows */}
      {gridW !== null && (
        <svg className="depsSvg" width="100%" height={HEADER_H + CAP_ROW_H + rows.length * ROW_H}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,3 L0,6 Z" fill="#6aa7ff" />
            </marker>
          </defs>
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#6aa7ff" strokeWidth="2" markerEnd="url(#arrow)" />
          ))}
        </svg>
      )}

      {/* Grid (weekly) */}
      <div className="ganttGrid" style={{ gridTemplateColumns: `${LEFT_COL}px repeat(${totalWeeks}, 1fr) ${RIGHT_COL}px` }}>
        <div className="ganttHeader">
          <div className="cell headT">Task</div>
          {header}
          <div className="cell headA">Actions</div>
        </div>

        {/* Weekly capacity row */}
        <div className="taskCell">Freed capacity (weekly)</div>
        {Array.from({ length: totalWeeks }).map((_, i) => (
          <div key={i} className="dayCell">
            {capWeeks[i] ? <div className="capacityBlock">+{capWeeks[i]}h freed</div> : null}
          </div>
        ))}
        <div className="actionCell"><span className="small">Weekly totals (tool details in table below)</span></div>

        {/* Task rows */}
        {rows.map(r => {
          const allocHrs = Math.round(((r.allocatedMinutes || 0) / 60) * 10) / 10
          const slackW = r.slackDays / 7
          const state = slackW <= 0 ? 'hot' : (slackW <= 1 ? 'amber' : 'ok')
          const label = state === 'hot' ? 'Critical' : state === 'amber' ? 'Near' : 'On‑track'
          return (
            <div key={r.id} className="ganttRow">
              <div className="taskCell">
                <div className="tName">{r.name}</div>
                <div className="small">
                  {r.project} • Baseline {r.baselineDays}d • CoD ${r.codPerDay.toLocaleString()}
                  {r.capability ? ' • Capability' : ''}
                </div>
              </div>

              {Array.from({ length: totalWeeks }).map((_, i) => {
                const isStart = i === r.startWeek
                return (
                  <div key={i} className="dayCell">
                    {isStart && (
                      <div
                        ref={setBarRef(r.id)}
                        className={`bar ${state}`}
                        style={{ left: 0, width: `calc(${r.weeksLong} * 100% / ${totalWeeks})` }}
                      >
                        <span>{label}</span>
                        {allocHrs > 0 && <span className="allocPill">{allocHrs}h allocated</span>}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="actionCell">
                <input className="input" style={{ width: 80 }} type="number" min={1} defaultValue={8} id={`alloc-${r.id}`} />
                <button
                  className="btn"
                  onClick={() => {
                    const el = document.getElementById(`alloc-${r.id}`) as HTMLInputElement | null
                    const v = (el?.valueAsNumber ?? 0) || 4
                    onAllocate(r.id, v)
                  }}
                >
                  Allocate
                </button>
                <button
                  className="btn secondary"
                  onClick={() => {
                    const val = prompt('Actual close date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10))
                    if (val) onComplete(r.id, new Date(val).toISOString())
                  }}
                >
                  Mark complete
                </button>
                {onView && <button className="btn ghost" onClick={() => onView(r.id)}>View</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
