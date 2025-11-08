'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Gantt from '../components/Gantt'

type User = { id: string; name: string; role: string }
type EventType = 'zap_lead_triage'|'meeting_cut'|'auto_status'|'draft_speedup'|'rpa_block'|'service_deflection'
type AutoEvent = { id: string; type: EventType; ts: string; data: any }
type Token = { personId?: string; teamId: string; minutes: number; source: string; confidence: 'High'|'Medium'|'Low' }
type Task = {
  id: string; name: string; project: string; assignees: string[];
  start: string; due: string; baselineDays: number; slackDays: number; codPerDay: number; mvi: number;
  status: 'open'|'closed'; actualClose?: string; allocatedMinutes?: number;
}
type Evidence = { taskId?: string; label?: string; daysSaved?: number; value: number; tier: 'A'|'B'|'C'; details: string }

const users: User[] = [
  { id:'u1', name:'Sarah', role:'Marketing Analyst' },
  { id:'u2', name:'Jamal', role:'RevOps' },
  { id:'u3', name:'Maria', role:'Designer' },
  { id:'u4', name:'Diego', role:'Content Ops' },
]

// Standard Time Catalog (minutes)
const STC = {
  perZapRun: 90,            // lead triage record + Slack post ~= 1.5 min
  weeklyStatus: 90,         // manual status creation
  makerMinutesPerDay: 60,   // conservative "true focus minutes/day"
  rpaMinutesPerTxn: 1.2,    // manual minutes per transaction (block)
  serviceMinPerTicket: 7,   // AHT minutes for deflectable tickets
  realization: 0.8          // oversight factor for block automation
}

// Prior manual owner share for lead triage (for attribution)
const ownerShare: Record<string, number> = { u1: 0.6, u2: 0.25 } // Sarah 60%, Jamal 25%
function d(offsetDays:number){ const dt=new Date(); dt.setDate(dt.getDate()+offsetDays); return dt.toISOString() }
function daysBetween(a:string,b:string){ return Math.round((new Date(b).getTime()-new Date(a).getTime())/86400000) }
const toHrs = (m:number)=> Math.round((m/60)*10)/10

// Mock tasks (two hotspots on critical path, one non-critical)
const initialTasks: Task[] = [
  { id:'t1', name:'Enablement Deck v2 — Design QA', project:'Q4 Sales Enablement', assignees:['u3'],
    start: d(-6), due: d(+4), baselineDays: 4, slackDays: 0, codPerDay: 7500, mvi: 0.84, status:'open', allocatedMinutes:0 },
  { id:'t2', name:'ICP Tier‑A One‑Pagers', project:'ABM Acceleration', assignees:['u4'],
    start: d(-3), due: d(+7), baselineDays: 5, slackDays: 2, codPerDay: 4000, mvi: 0.72, status:'open', allocatedMinutes:0 },
  { id:'t3', name:'Field Pilot Feedback Synthesis', project:'Q4 Sales Enablement', assignees:['u2'],
    start: d(-2), due: d(+5), baselineDays: 3, slackDays: 0, codPerDay: 3500, mvi: 0.77, status:'open', allocatedMinutes:0 },
]

export default function Demo(){
  // Toggles to simulate extra sources
  const [simRPA, setSimRPA] = useState(true)
  const [simSVC, setSimSVC] = useState(true)

  const [tokens, setTokens] = useState<Token[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])

  // Harvest potentials
  const [rpaPotential, setRpaPotential] = useState<{hours:number; contractorHours:number; contractorRate:number; dollars:number} | null>(null)
  const [svcPotential, setSvcPotential] = useState<{tickets:number; costPerTicket:number; dollars:number} | null>(null)
  const [harvestedRPA, setHarvestedRPA] = useState(false)
  const [harvestedSVC, setHarvestedSVC] = useState(false)

  useEffect(()=>{
    const sTasks = localStorage.getItem('vx_tasks'); setTasks(sTasks? JSON.parse(sTasks): initialTasks)
    const sEv = localStorage.getItem('vx_evidence'); setEvidence(sEv? JSON.parse(sEv): [])
    const sR = localStorage.getItem('vx_simRPA'); setSimRPA(sR? JSON.parse(sR): true)
    const sS = localStorage.getItem('vx_simSVC'); setSimSVC(sS? JSON.parse(sS): true)
  },[])
  useEffect(()=>{ localStorage.setItem('vx_tasks', JSON.stringify(tasks)) },[tasks])
  useEffect(()=>{ localStorage.setItem('vx_evidence', JSON.stringify(evidence)) },[evidence])
  useEffect(()=>{ localStorage.setItem('vx_simRPA', JSON.stringify(simRPA)) },[simRPA])
  useEffect(()=>{ localStorage.setItem('vx_simSVC', JSON.stringify(simSVC)) },[simSVC])

  // Mint tokens on toggle change
  useEffect(()=>{
    const result = mintTokens(simRPA, simSVC)
    setTokens(result.tokens)
    setRpaPotential(result.rpa)
    setSvcPotential(result.svc)
    setHarvestedRPA(false); setHarvestedSVC(false)
  },[simRPA, simSVC])

  const hours = useMemo(()=>groupAvailableHours(tokens),[tokens])
  const allocated = Math.round(tasks.reduce((a,b)=>a+(b.allocatedMinutes||0),0)/60*10)/10
  const realized = evidence.reduce((a,b)=>a+b.value,0)
  const valueCreated = evidence.filter(e=>e.taskId).reduce((a,b)=>a+b.value,0)
  const costAvoided = evidence.filter(e=>!e.taskId).reduce((a,b)=>a+b.value,0)

  function allocate(taskId:string, hours:number){
    let minsNeeded = hours*60
    const order = ['High','Medium','Low'] as const
    const newTokens = [...tokens]
    for(const tier of order){
      for(let i=0;i<newTokens.length;i++){
        const t = newTokens[i]
        if(t.teamId && !t.personId && t.confidence===tier && t.minutes>0){
          const take = Math.min(t.minutes, minsNeeded)
          newTokens[i] = {...t, minutes: t.minutes - take}
          minsNeeded -= take
        }
        if(minsNeeded<=0) break
      }
      if(minsNeeded<=0) break
    }
    setTokens(newTokens)
    setTasks(ts=>ts.map(t=> t.id===taskId ? {...t, allocatedMinutes:(t.allocatedMinutes||0)+(hours*60)} : t))
  }

  function closeTask(taskId:string, actualCloseISO:string){
    setTasks(ts=>{
      const t = ts.find(x=>x.id===taskId)!; if(!t) return ts
      const actualDays = Math.max(1, daysBetween(t.start, actualCloseISO))
      const daysSaved = Math.max(0, t.baselineDays - actualDays)
      const value = daysSaved * t.codPerDay
      const tier: 'A'|'B'|'C' = (t.slackDays<=0 && daysSaved>0) ? 'B' : 'C'
      setEvidence(ev=>[{ taskId:t.id, daysSaved, value, tier,
        details:`Closed ${daysSaved.toFixed(1)}d faster than baseline ${t.baselineDays}d. CoD/day $${t.codPerDay.toLocaleString()}.` }, ...ev])
      return ts.map(x=> x.id===taskId ? {...x, status:'closed', actualClose:actualCloseISO} : x)
    })
  }

  return (
    <div className="container">
      <h2 className="h">VelocityAI — Capacity → Redeploy → Proof (Demo)</h2>
      <p className="small">We mint capacity from automation/AI signals, route it to critical‑path work, and recognize dollars only when outcomes happen or when hard savings are harvested. No forecasts. No timesheets.</p>

      <div className="row">
        <div className="card kpi"><h3 className="h">Capacity captured (hrs)</h3>
          <div>High: <span className="badge green">{hours.high}</span> &nbsp; Medium: <span className="badge amber">{hours.med}</span> &nbsp; Total: <b>{hours.all}</b></div>
          <p className="small">Sources: Zap runs, meeting cuts, auto‑status, faster drafts{simRPA?' + RPA block':''}{simSVC?' + Service deflection':''}.</p>
        </div>
        <div className="card kpi"><h3 className="h">Allocated to hotspots</h3>
          <div><b>{allocated} hrs</b></div>
          <p className="small">Apply pooled hours to zero‑slack tasks (critical path).</p>
        </div>
        <div className="card kpi"><h3 className="h">Leadership dashboard</h3>
          <div>Value created (cycle‑time): <b>${Math.round(valueCreated).toLocaleString()}</b></div>
          <div>Cost avoided (harvested): <b>${Math.round(costAvoided).toLocaleString()}</b></div>
          <div>Total realized: <b>${Math.round(valueCreated+costAvoided).toLocaleString()}</b></div>
          <p className="small">Value is recognized after completion (Tiered A/B/C) or after a harvest action (PO/seat/contractor reduction).</p>
        </div>
      </div>

      <div className="card">
        <h3 className="h">Simulation toggles</h3>
        <label className="switch"><input type="checkbox" checked={simRPA} onChange={e=>setSimRPA(e.target.checked)}/> RPA block automation (Finance/Ops)</label>
        <label className="switch"><input type="checkbox" checked={simSVC} onChange={e=>setSimSVC(e.target.checked)}/> Service AI deflection (Tier‑1)</label>
        <p className="small">Toggling adds/removes extra capacity sources and their harvestable savings.</p>
      </div>

      <div className="card">
        <h3 className="h">Gantt: critical path hotspots (allocate on the right)</h3>
        <Gantt tasks={tasks} onAllocate={allocate} onComplete={closeTask}/>
      </div>

      <div className="card">
        <h3 className="h">Capacity sources (this week)</h3>
        <table className="table">
          <thead><tr><th>Source</th><th>Confidence</th><th>Minutes</th><th>~Hours</th></tr></thead>
          <tbody>
            {tokens.map((t,i)=> t.minutes>0 && <tr key={i}>
              <td>{t.source}</td>
              <td><span className={`badge ${t.confidence==='High'?'green': t.confidence==='Medium'?'amber':'red'}`}>{t.confidence}</span></td>
              <td>{Math.round(t.minutes)}</td>
              <td>{toHrs(t.minutes)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="h">Harvest hard savings (optional)</h3>
        <div className="row">
          <div className="card kpi">
            <h4 className="h">RPA block automation</h4>
            {rpaPotential ? <>
              <p className="small">Freed {Math.round(rpaPotential.hours)}h; assume {Math.round(rpaPotential.contractorHours)}h contractor reduction @ ${rpaPotential.contractorRate}/h.</p>
              <button className="btn" disabled={harvestedRPA} onClick={()=>{
                setEvidence(ev=>[{ label:'RPA contractor reduction', value:rpaPotential.dollars, tier:'A',
                  details:`Reduced contractors by ${Math.round(rpaPotential.contractorHours)}h @ $${rpaPotential.contractorRate}/h.`}, ...ev])
                setHarvestedRPA(true)
              }}>{harvestedRPA ? 'Harvested' : `Harvest $${Math.round(rpaPotential.dollars).toLocaleString()}`}</button>
            </> : <p className="small">Toggle “RPA” on to simulate.</p>}
          </div>
          <div className="card kpi">
            <h4 className="h">Service deflection</h4>
            {svcPotential ? <>
              <p className="small">{svcPotential.tickets} tickets deflected × ${svcPotential.costPerTicket}/ticket.</p>
              <button className="btn" disabled={harvestedSVC} onClick={()=>{
                setEvidence(ev=>[{ label:'Service cost avoided', value:svcPotential.dollars, tier:'A',
                  details:`Recognized cost avoided: ${svcPotential.tickets} × $${svcPotential.costPerTicket}.`}, ...ev])
                setHarvestedSVC(true)
              }}>{harvestedSVC ? 'Harvested' : `Harvest $${Math.round(svcPotential.dollars).toLocaleString()}`}</button>
            </> : <p className="small">Toggle “Service deflection” on to simulate.</p>}
          </div>
        </div>
        <p className="small">In production, we count hard savings only when POs/seats/contracts are actually reduced. Here you click “Harvest” to simulate that step.</p>
      </div>

      <div className="card">
        <h3 className="h">Evidence log (realized)</h3>
        <table className="table">
          <thead><tr><th>Item</th><th>Days saved</th><th>$ value</th><th>Tier</th><th>Details</th></tr></thead>
          <tbody>
            {evidence.map((e,i)=>{
              const t = e.taskId ? tasks.find(x=>x.id===e.taskId) : undefined
              return <tr key={i}>
                <td>{t ? t.name : (e.label || 'Item')}</td>
                <td>{e.daysSaved !== undefined ? e.daysSaved.toFixed(1) : '—'}</td>
                <td>${Math.round(e.value).toLocaleString()}</td>
                <td><span className={`badge ${e.tier==='A'?'green': e.tier==='B'?'amber':'red'}`}>{e.tier}</span></td>
                <td className="small">{e.details}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ====== minting logic ====== */
function mintTokens(simRPA:boolean, simSVC:boolean){
  const now = new Date().toISOString()
  const events: AutoEvent[] = [
    { id:'e1', type:'zap_lead_triage', ts:now, data:{ runs: 600 } },
    { id:'e2', type:'meeting_cut', ts:now, data:{ series:'Weekly GTM', deltaMinutes:30, attendees:['u1','u2','u3','u4'] } },
    { id:'e3', type:'auto_status', ts:now, data:{ count:6 } },
    { id:'e4', type:'draft_speedup', ts:now, data:{ items:7, deltaDaysPerItem: 1.0 } },
  ]
  if(simRPA) events.push({ id:'e5', type:'rpa_block', ts:now, data:{ txns: 10000, contractorRate:95, contractorShare:0.3 } })
  if(simSVC) events.push({ id:'e6', type:'service_deflection', ts:now, data:{ deflected: 400, costPerTicket: 6.5 } })

  const tokens: Token[] = []
  let rpa: {hours:number; contractorHours:number; contractorRate:number; dollars:number} | null = null
  let svc: {tickets:number; costPerTicket:number; dollars:number} | null = null

  for(const ev of events){
    if(ev.type==='zap_lead_triage'){
      const minutes = ev.data.runs * STC.perZapRun
      for(const [uid,share] of Object.entries(ownerShare)){
        tokens.push({ personId: uid, teamId:'marketing', minutes: minutes*share, source:'Zap:LeadTriage', confidence:'High' })
      }
      const remainder = minutes*(1 - Object.values(ownerShare).reduce((a,b)=>a+b,0))
      if(remainder>0) tokens.push({ teamId:'marketing', minutes: remainder, source:'Zap:LeadTriage', confidence:'High' })
    }
    if(ev.type==='meeting_cut'){
      const minutes = ev.data.deltaMinutes * ev.data.attendees.length
      tokens.push({ teamId:'marketing', minutes, source:`Meeting Cut:${ev.data.series}`, confidence:'High' })
    }
    if(ev.type==='auto_status'){
      const minutes = ev.data.count * STC.weeklyStatus
      tokens.push({ teamId:'marketing', minutes, source:'Asana Auto‑Status', confidence:'High' })
    }
    if(ev.type==='draft_speedup'){
      const minutes = ev.data.items * ev.data.deltaDaysPerItem * STC.makerMinutesPerDay
      tokens.push({ teamId:'marketing', minutes, source:'Faster Drafts (AI)', confidence:'Medium' })
    }
    if(ev.type==='rpa_block'){
      const freedMinutes = ev.data.txns * STC.rpaMinutesPerTxn * STC.realization
      tokens.push({ teamId:'marketing', minutes: freedMinutes, source:'RPA Bot (Block)', confidence:'High' })
      const hours = freedMinutes/60
      const contractorHours = hours * ev.data.contractorShare
      const dollars = contractorHours * ev.data.contractorRate
      rpa = { hours, contractorHours, contractorRate: ev.data.contractorRate, dollars }
    }
    if(ev.type==='service_deflection'){
      const freedMinutes = ev.data.deflected * STC.serviceMinPerTicket
      tokens.push({ teamId:'marketing', minutes: freedMinutes, source:'Service Deflection (AI Agent)', confidence:'High' })
      const dollars = ev.data.deflected * ev.data.costPerTicket
      svc = { tickets: ev.data.deflected, costPerTicket: ev.data.costPerTicket, dollars }
    }
  }
  return { tokens, rpa, svc }
}

function groupAvailableHours(tokens: Token[]){
  const toHrs = (m:number)=> Math.round((m/60)*10)/10
  const sum = (conf:'High'|'Medium'|'Low') => toHrs(tokens.filter(t=>t.confidence===conf).reduce((a,b)=>a+b.minutes,0))
  return { high: sum('High'), med: sum('Medium'), low: sum('Low'), all: toHrs(tokens.reduce((a,b)=>a+b.minutes,0)) }
}
