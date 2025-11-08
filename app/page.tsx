'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Gantt, { CapEvent, Task } from '../components/Gantt'

type Evidence = { taskId?: string; label?: string; daysSaved?: number; value: number; tier: 'A'|'B'|'C'; details: string }
type Token = { minutes:number; source:string; confidence:'High'|'Medium'|'Low' }

function d(offset:number){ const dt=new Date(); dt.setDate(dt.getDate()+offset); return dt.toISOString() }
function daysBetweenISO(a:string,b:string){ return Math.max(1, Math.round((new Date(b).getTime()-new Date(a).getTime())/86400000)) }
const toIntHrs = (m:number)=> Math.round(m/60)

const STC = {
perZapRun: 90,
weeklyStatus: 90,
makerMinutesPerDay: 60,
rpaMinutesPerTxn: 1.2,
serviceMinPerTicket: 7,
realization: 0.8,
}

const seeded: Task[] = [
{ id:'t1', name:'Design QA', project:'Q4 Sales Enablement', assignees:['u1'], start:d(-6), due:d(+4), baselineDays:4, slackDays:0, codPerDay:7500, mvi:0.84, status:'open', allocatedMinutes:0 },
{ id:'t2', name:'Field Pilot Synthesis', project:'Q4 Sales Enablement', assignees:['u2'], start:d(-2), due:d(+5), baselineDays:3, slackDays:0, codPerDay:3500, mvi:0.77, status:'open', allocatedMinutes:0, capability:true },
{ id:'t3', name:'Email Copy v1', project:'Q4 Campaign Email Sprint', assignees:['u3'], start:d(-3), due:d(+2), baselineDays:3, slackDays:1, codPerDay:2500, mvi:0.6, status:'open', allocatedMinutes:0 },
{ id:'t4', name:'Design Build', project:'Q4 Campaign Email Sprint', assignees:['u4'], start:d(-1), due:d(+6), baselineDays:5, slackDays:2, codPerDay:3000, mvi:0.65, status:'open', allocatedMinutes:0 },
{ id:'t5', name:'SEO QA', project:'Website Refresh', assignees:['u1'], start:d(-4), due:d(+3), baselineDays:4, slackDays:0, codPerDay:4000, mvi:0.7, status:'open', allocatedMinutes:0 },
]

export default function Page(){
const [tasks, setTasks] = useState<Task[]>(seeded)
const [tokens, setTokens] = useState<Token[]>([])
const [cap, setCap] = useState<CapEvent[]>([])
const [evidence, setEvidence] = useState<Evidence[]>([])

const [simRPA, setSimRPA] = useState(true)
const [simSVC, setSimSVC] = useState(true)
const [project, setProject] = useState<'All'|string>('All')
const [seededOnce, setSeededOnce] = useState(false)

useEffect(()=>{ mintCapacity() },[simRPA, simSVC])

// Capacity minting (creates tokens + freed-time pills with project tags)
function mintCapacity(){
const events = [
{ label: 'Zap lead triage', minutes: 600 * STC.perZapRun, dayOffset: 1, conf: 'High' as const, project: 'Q4 Campaign Email Sprint' },
{ label: 'Weekly GTM cut', minutes: 30 * 6, dayOffset: 0, conf: 'High' as const, project: 'Q4 Sales Enablement' }, // 6 attendees × 30m
{ label: 'Auto-status', minutes: 6 * STC.weeklyStatus, dayOffset: 2, conf: 'High' as const, project: 'Q4 Sales Enablement' },
{ label: 'Faster drafts', minutes: 7 * 1 * STC.makerMinutesPerDay, dayOffset: 3, conf: 'Medium' as const, project: 'Q4 Campaign Email Sprint' },
...(simRPA ? [{
label: 'RPA block',
minutes: 10_000 * STC.rpaMinutesPerTxn * STC.realization,
dayOffset: 1,
conf: 'High' as const,
project: 'Website Refresh'
}] : []),
...(simSVC ? [{
label: 'Service deflection',
minutes: 400 * STC.serviceMinPerTicket,
dayOffset: 4,
conf: 'High' as const,
project: 'Service'
}] : []),
]

// store for UI
setTokens(events.map(e => ({ minutes: e.minutes, source: e.label, confidence: e.conf })))
setCap(events.map(e => ({ dayOffset: e.dayOffset, label: e.label, hours: Math.round(e.minutes/60), project: e.project })))
}

function closeTask(taskId:string, iso:string){
setTasks(ts=>{
const t = ts.find(x=>x.id===taskId); if(!t) return ts
const actual = Math.max(1, daysBetweenISO(t.start, iso))
const daysSaved = Math.max(0, t.baselineDays - actual)
const value = daysSaved * t.codPerDay
const tier: 'A'|'B'|'C' = (t.slackDays<=0 && daysSaved>0) ? 'B' : 'C'
// capability credit (optional)
if(t.capability && t.allocatedMinutes){
const capHrs = t.allocatedMinutes/60
setEvidence(ev=>[{ label:'Capability growth', value: capHrs*120, tier:'C', details:${capHrs.toFixed(1)}h × $120/h (proxy)}, ...ev])
}
setEvidence(ev=>[{ taskId:t.id, daysSaved, value, tier, details:Closed ${daysSaved.toFixed(1)}d faster; CoD/day $${t.codPerDay.toLocaleString()}. }, ...ev])
return ts.map(x=> x.id===taskId ? {...x, status:'closed', due: iso} : x)
})
}

// Harvest hard savings (demo buttons)
function harvestRPA(){
const rpa = tokens.find(t=>t.source.includes('RPA'))
if(!rpa) return
const hours = rpa.minutes/60
const contractorHours = hours * 0.3
const dollars = contractorHours * 95
setEvidence(ev=>[{ label:'RPA contractor reduction', value:dollars, tier:'A', details:Reduced contractors by ${Math.round(contractorHours)}h @ $95/h. }, ...ev])
}
function harvestService(){
const svc = tokens.find(t=>t.source.includes('Service'))
if(!svc) return
const tickets = Math.round(svc.minutes / STC.serviceMinPerTicket)
const dollars = tickets * 6.5
setEvidence(ev=>[{ label:'Service cost avoided', value:dollars, tier:'A', details:${tickets} deflected × $6.5/ticket. }, ...ev])
}
function recordSQLLift(){
const n = parseInt(prompt('Incremental SQLs this month?', '18')||'0',10)
if(n>0){ setEvidence(ev=>[{ label:'SQL lift (strategic)', value:n*5600, tier:'C', details:${n} × $5,600/SQL (ASP × win × margin).}, ...ev]) }
}

// One‑click 30s demo
function runDemo(){
if(!seededOnce){
allocate('t1', 8)
const earlier = new Date(); earlier.setDate(earlier.getDate()-1)
closeTask('t1', earlier.toISOString())
if(simRPA) harvestRPA()
if(simSVC) harvestService()
setSeededOnce(true)
}
// scroll to evidence
document.getElementById('evidence')?.scrollIntoView({behavior:'smooth'})
}

// Metrics
const capturedMin = tokens.reduce((a,b)=>a+b.minutes,0)
const capturedHrs = toIntHrs(capturedMin)
const allocatedHrs = Math.round(tasks.reduce((a,b)=>a+(b.allocatedMinutes||0),0)/60)
const redeployRate = capturedHrs>0 ? Math.round(allocatedHrs/capturedHrs*100) : 0

const opValue = evidence.filter(e=>e.taskId).reduce((a,b)=>a+b.value,0)
const costAvoided = evidence.filter(e=>e.label?.includes('RPA') || e.label?.includes('Service')).reduce((a,b)=>a+b.value,0)
const strategic = evidence.filter(e=>e.label?.includes('SQL') || e.label?.includes('Capability')).reduce((a,b)=>a+b.value,0)
const total = opValue + costAvoided + strategic
const dollarsPerFreedHr = capturedHrs>0 ? Math.round(total/capturedHrs) : 0

// Tier breakdown
const tierSum = (t:'A'|'B'|'C') => evidence.filter(e=>e.tier===t).reduce((a,b)=>a+b.value,0)

// Project filter & capacity filter
const projects = Array.from(new Set(tasks.map(t=>t.project)))
const tasksFiltered = project==='All' ? tasks : tasks.filter(t=>t.project===project)
const capFiltered = project==='All' ? cap : cap.filter(e=>e.project===project)

// Grouped capacity sources for table
const groupedSources = useMemo(()=>{
const map: Record<string,{source:string;confidence:'High'|'Medium'|'Low'; minutes:number}> = {}
tokens.forEach(t=>{
const key = t.source
if(!map[key]) map[key] = { source:key, confidence:t.confidence, minutes:0 }
map[key].minutes += t.minutes
if(t.confidence==='Medium' && map[key].confidence==='High') map[key].confidence='Medium'
})
return Object.values(map)
},[tokens])

return (
<div className="container">
<h2 className="h">Turn AI time into dollars (Exec demo)</h2>
<p className="small">Identify high‑value work, visualize freed capacity on the Gantt, redeploy with one click, and prove dollars—Operational (velocity), Cost avoided, Strategic (growth/capability). No forecasts. No timesheets.</p>

text

  <div className="row">
    <div className="card kpi"><h3 className="h">Operational (velocity)</h3><div><b>${Math.round(opValue).toLocaleString()}</b></div><span className="small">Tier A ${Math.round(tierSum('A')).toLocaleString()} • B ${Math.round(tierSum('B')).toLocaleString()} • C ${Math.round(tierSum('C')).toLocaleString()}</span></div>
    <div className="card kpi"><h3 className="h">Cost avoided (harvested)</h3><div><b>${Math.round(costAvoided).toLocaleString()}</b></div><span className="small">RPA contractor cuts, Service deflection</span></div>
    <div className="card kpi"><h3 className="h">Strategic (growth/capability)</h3><div><b>${Math.round(strategic).toLocaleString()}</b></div><span className="small">SQL lift + capability hours</span></div>
  </div>

  <div className="row">
    <div className="card kpi">
      <h3 className="h">Capacity captured</h3>
      <div><b>{capturedHrs} hrs</b></div>
      <span className="small">Redeployed: {allocatedHrs}h • Rate: {redeployRate}% • $/freed hr: ${dollarsPerFreedHr}</span>
    </div>
    <div className="card kpi">
      <h3 className="h">Quick actions</h3>
      <button className="btn" onClick={runDemo}>Run 30‑sec demo</button>
      &nbsp;<button className="btn secondary" onClick={()=>{ setEvidence([]); setSeededOnce(false); }}>Reset ROI</button>
    </div>
    <div className="card kpi">
      <h3 className="h">Project filter</h3>
      <div className="row">
        <button className={`btn ${project==='All'?'':'secondary'}`} onClick={()=>setProject('All')}>All</button>
        {projects.map(p=><button key={p} className={`btn ${project===p?'':'secondary'}`} onClick={()=>setProject(p)}>{p}</button>)}
      </div>
    </div>
  </div>

  <div className="card">
    <h3 className="h">Gantt — freed time + critical path hotspots</h3>
    <Gantt tasks={tasksFiltered} capacity={capFiltered} onAllocate={allocate} onComplete={closeTask}/>
  </div>

  <div className="card">
    <h3 className="h">Simulation toggles</h3>
    <label className="switch"><input type="checkbox" checked={simRPA} onChange={e=>setSimRPA(e.target.checked)}/> RPA block automation</label>
    <label className="switch"><input type="checkbox" checked={simSVC} onChange={e=>setSimSVC(e.target.checked)}/> Service AI deflection</label>
    <span className="small"> Toggling changes capacity sources and harvestable savings.</span>
  </div>

  <div className="card">
    <h3 className="h">Capacity sources (this week)</h3>
    <table className="table">
      <thead><tr><th>Source</th><th>Confidence</th><th>Minutes</th><th>~Hours</th></tr></thead>
      <tbody>
        {groupedSources.map((s,i)=>(
          <tr key={i}>
            <td>{s.source}</td>
            <td><span className={`badge ${s.confidence==='High'?'green':'amber'}`}>{s.confidence}</span></td>
            <td>{Math.round(s.minutes)}</td>
            <td>{toIntHrs(s.minutes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>

  <div className="card">
    <h3 className="h">Harvest / Strategic actions</h3>
    <div className="row">
      <div className="card kpi"><h4 className="h">RPA contractor reduction</h4><button className="btn" onClick={harvestRPA}>Recognize hard savings</button><p className="small">In production, counted only when POs/seats/contracts are reduced.</p></div>
      <div className="card kpi"><h4 className="h">Service cost avoided</h4><button className="btn" onClick={harvestService}>Recognize cost avoided</button></div>
      <div className="card kpi"><h4 className="h">Record SQL lift</h4><button className="btn" onClick={recordSQLLift}>Add SQLs → $</button></div>
    </div>
  </div>

  <div className="card" id="evidence">
    <h3 className="h">Evidence log (realized)</h3>
    <table className="table">
      <thead><tr><th>Item</th><th>Days saved</th><th>$ value</th><th>Tier</th><th>Details</th></tr></thead>
      <tbody>
        {evidence.map((e,i)=>(
          <tr key={i}>
            <td>{e.taskId ? (tasks.find(x=>x.id===e.taskId)?.name || e.taskId) : (e.label || 'Item')}</td>
            <td>{e.daysSaved!==undefined ? e.daysSaved.toFixed(1) : '—'}</td>
            <td>${Math.round(e.value).toLocaleString()}</td>
            <td><span className={`badge ${e.tier==='A'?'green': e.tier==='B'?'amber':'red'}`}>{e.tier}</span></td>
            <td className="small">{e.details}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
)
}
