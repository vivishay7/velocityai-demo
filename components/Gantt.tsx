'use client'
import React, { useMemo } from 'react'

export type Task = {
  id: string
  name: string
  project: string
  assignees: string[]
  start: string
  due: string
  baselineDays: number
  slackDays: number
  codPerDay: number
  mvi: number
  status: 'open' | 'closed'
  allocatedMinutes?: number
  capability?: boolean
  dependsOn?: string // for arrows
}

export type CapEvent = { dayOffset: number; label: string; hours: number; project?: string; aiTool: string; fromTask?: string } // fromTask for source

type Row = Task & { offset: number; duration: number }

type Props = {
  tasks: Task[] | undefined
  capacity: CapEvent[]
  onAllocate: (taskId: string, hours: number) => void
  onComplete: (taskId: string, actualCloseISO: string) => void
  onView?: (taskId: string) => void
}

function fmt(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function daysBetween(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000))
}

export default function Gantt({ tasks, capacity, onAllocate, onComplete, onView }: Props) {
  const { start, spanDays, gridCols, rows, capByWeek, dependencies } = useMemo(() => {
    const open = (tasks ?? []).filter(t => t.status === 'open')

    if (open.length === 0) {
      const today = new Date()
      const start = new Date(today)
      start.setDate(start.getDate() - 1)
      return {
        start,
        spanDays: 14, // Limit to 2 weeks for no scroll
        gridCols: `280px repeat(14, 1fr) 280px`,
        rows: [] as Row[],
        capByWeek: {} as Record<number, CapEvent[]>,
        dependencies: [] as { from: string; to: string }[],
      }
    }

    const minStart = new Date(Math.min(...open.map(t => new Date(t.start).getTime())))
    const maxDue = new Date(Math.max(...open.map(t => new Date(t.due).getTime())))
    const start = new Date(minStart)
    start.setDate(start.getDate() - 1)
    const end = new Date(maxDue)
    end.setDate(end.getDate() + 1)

    const spanDays = Math.min(14, Math.max(1, daysBetween(start, end))) // Cap at 2 weeks
    const gridCols = `280px repeat(${spanDays}, 1fr) 280px`

    const rows: Row[] = open.map(t => {
      const s = new Date(t.start)
      const d = new Date(t.due)
      const offset = daysBetween(start, s)
      const duration = daysBetween(s, d)
      return { ...t, offset, duration }
    })

    const capByWeek: Record<number, CapEvent[]> = {}
    capacity.forEach(ev => {
      const week = Math.floor(ev.dayOffset / 7) // Group daily into weekly
      if (week < 0 || week > Math.ceil(spanDays / 7) - 1) return
      capByWeek[week] = capByWeek[week] || []
      capByWeek[week].push(ev)
    })

    const dependencies = open.filter(t => t.dependsOn).map(t => ({ from: t.dependsOn!, to: t.id }))

    return { start, spanDays, gridCols, rows, capByWeek, dependencies }
  }, [tasks, capacity])

  const headerDays = Array.from({ length: spanDays }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return (
      <div key={i} className="cell">
        {fmt(d)}
      </div>
    )
  })

  return (
    <div className="gantt">
      <div className="ganttGrid" style={{ gridTemplateColumns: gridCols }}>
        <div className="ganttHeader">
          <div className="cell" style={{ padding: '6px 8px', fontWeight: 600 }}>
            Task
          </div>
          {headerDays}
          <div className="cell" style={{ padding: '6px 8px', fontWeight: 600 }}>
            Actions
          </div>
        </div>

        {/* Capacity row (weekly) */}
        <div className="taskCell">Freed capacity (weekly)</div>
        {Array.from({ length: spanDays }).map((_, i) => {
          const week = Math.floor(i / 7)
          const evs = capByWeek[week] || []
          const totalHrs = evs.reduce((a, b) => a + b.hours, 0)
          return (
            <div key={i} className="dayCell">
              {i % 7 === 0 && totalHrs > 0 && (
                <div className="capacityBlock" style={{ width: `calc(700% / ${spanDays})` }}> // Span 7 days
                  {totalHrs}h from {evs[0].aiTool} in {evs[0].project}
                </div>
              )}
            </div>
          )
        })}
        <div className="actionCell">
          <span className="small">Weekly pills show time freed by AI tools in accelerated projects.</span>
        </div>

        {/* Task rows */}
        {rows.map(r => {
          const allocHrs = Math.round(((r.allocatedMinutes || 0) / 60) * 10) / 10
          const slackW = r.slackDays / 7
          const state = slackW <= 0 ? 'hot' : (slackW <= 1 ? 'warm' : 'green')
          const label = state === 'hot' ? 'Critical' : state === 'warm' ? 'Near' : 'On track'
          return (
            <div key={r.id} className="ganttRow">
              <div className="taskCell">
                <div>{r.name}</div>
                <div className="small">
                  {r.project} • Baseline {r.baselineDays}d • CoD ${r.codPerDay.toLocaleString()} {r.capability && '• Capability'}
                </div>
              </div>

              {Array.from({ length: spanDays }).map((_, i) => {
                const isBarStart = i === r.offset
                return (
                  <div key={i} className="dayCell">
                    {isBarStart && (
                      <div
                        className={`bar ${state}`}
                        style={{ left: 0, width: `calc(${r.duration}00% / ${spanDays})` }}
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
                {onView && (
                  <button className="btn ghost" onClick={() => onView(r.id)}>
                    View
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="legend">
        <div className="legendItem"><div className="legendColor red"></div> Critical (slack=0)</div>
        <div className="legendItem"><div className="legendColor yellow"></div> Near-crit (slack≤1 week)</div>
        <div className="legendItem"><div className="legendColor green"></div> On track (slack&gt;1 week)</div>
      </div>

      {/* Dependency arrows (SVG) */}
      {dependencies.map((dep, idx) => {
        // Mock arrow positioning (in production, calculate based on bar positions)
        return <svg key={idx} className="arrow" style={{ position: 'absolute', top: 100, left: 300, width: 200, height: 100 }}>
          <path d="M0 0 L180 0 L180 80" fill="none" stroke="#6aa7ff" strokeWidth="2" markerEnd="url(#arrowhead)" />
          <defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#6aa7ff" /></marker></defs>
        </svg>
      })}
    </div>
  )
}
