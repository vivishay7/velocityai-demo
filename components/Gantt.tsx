'use client'
import React, { useMemo } from 'react'

type Task = {
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
  status: 'open' | 'closed'
  allocatedMinutes?: number
}

type Row = Task & { offset: number; duration: number }

type Props = {
  tasks: Task[] | undefined
  onAllocate: (taskId: string, hours: number) => void
  onComplete: (taskId: string, actualCloseISO: string) => void
}

function fmt(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function daysBetween(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000))
}

export default function Gantt({ tasks, onAllocate, onComplete }: Props) {
  const { start, spanDays, gridCols, rows } = useMemo(() => {
    const open = (tasks ?? []).filter(t => t.status === 'open')

    // Fallback grid if no tasks
    if (open.length === 0) {
      const today = new Date()
      const start = new Date(today)
      start.setDate(start.getDate() - 1)
      return {
        start,
        spanDays: 7,
        gridCols: `220px repeat(7, 1fr) 240px`,
        rows: [] as Row[],
      }
    }

    const minStart = new Date(Math.min(...open.map(t => new Date(t.start).getTime())))
    const maxDue = new Date(Math.max(...open.map(t => new Date(t.due).getTime())))
    const start = new Date(minStart)
    start.setDate(start.getDate() - 1)
    const end = new Date(maxDue)
    end.setDate(end.getDate() + 1)

    const spanDays = Math.max(1, daysBetween(start, end))
    const gridCols = `220px repeat(${spanDays}, 1fr) 240px`

    const rows: Row[] = open.map(t => {
      const s = new Date(t.start)
      const d = new Date(t.due)
      const offset = daysBetween(start, s)
      const duration = daysBetween(s, d)
      return { ...t, offset, duration }
    })

    return { start, spanDays, gridCols, rows }
  }, [tasks])

  const dayCells = Array.from({ length: spanDays }, (_, i) => {
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
        {/* header */}
        <div className="ganttHeader">
          <div className="cell" style={{ padding: '6px 8px', fontWeight: 600 }}>
            Task
          </div>
          {dayCells}
          <div className="cell" style={{ padding: '6px 8px', fontWeight: 600 }}>
            Actions
          </div>
        </div>

        {/* rows */}
        {rows.map(r => {
          const allocHrs = Math.round(((r.allocatedMinutes || 0) / 60) * 10) / 10
          const isHot = r.slackDays <= 0
          return (
            <div key={r.id} className="ganttRow">
              <div className="taskCell">
                <div>{r.name}</div>
                <div className="small">
                  {r.project} • Baseline {r.baselineDays}d • CoD ${r.codPerDay.toLocaleString()}
                </div>
              </div>

              {Array.from({ length: spanDays }).map((_, i) => {
                const isBarStart = i === r.offset
                return (
                  <div key={i} className="dayCell">
                    {isBarStart && (
                      <div
                        className={`bar ${isHot ? 'hot' : 'warm'}`}
                        style={{
                          left: 0,
                          // the width approximation across grid cells
                          width: `calc(${r.duration}00% / ${spanDays})`,
                        }}
                      >
                        <span>{isHot ? 'Critical' : 'Near‑critical'}</span>
                        {allocHrs > 0 && <span className="allocPill">{allocHrs}h allocated</span>}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="actionCell">
                <input
                  className="input"
                  style={{ width: 80 }}
                  type="number"
                  min={1}
                  defaultValue={4}
                  id={`alloc-${r.id}`}
                />
                <button
                  className="btn"
                  onClick={() => {
                    const el = document.getElementById(`alloc-${r.id}`) as HTMLInputElement | null
                    const v = (el?.valueAsNumber ?? 0) || 2
                    onAllocate(r.id, v)
                  }}
                >
                  Allocate
                </button>
                <button
                  className="btn secondary"
                  onClick={() => {
                    const val = prompt('Actual close date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10))
                    if (val) {
                      const iso = new Date(val).toISOString()
                      onComplete(r.id, iso)
                    }
                  }}
                >
                  Mark complete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
