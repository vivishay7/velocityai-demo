'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Gantt, { CapEvent, Task } from '../components/Gantt'
import Tour, { TourStep } from '../components/Tour'

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
const VALUE_PER_HOUR = 95 // loaded hourly value for capacity table

// dependsOn is a string (not array) for Gantt
const seeded: Task[] = [
  { id:'t1', name:'Design QA', project:'Q4 Sales Enablement', assignees:['u1'], start:d(-28), due:d(+7), baselineDays:4, slackDays:0, codPerDay:7500, mvi:0.84, status:'open', allocatedMinutes:0 },
  { id:'t2', name:'Field Pilot Synthesis', project:'Q4 Sales Enablement', assignees:['u2'], start:d(-24), due:d(+10), baselineDays:3, slackDays:0, codPerDay:3500, mvi:0.77, status:'open', allocatedMinutes:0, capability:true, dependsOn:'t1' },
  { id:'t3', name:'Email Copy v1', project:'Q4 Campaign Email Sprint', assignees:['u3'], start:d(-21), due:d(+9), baselineDays:3, slackDays:1, codPerDay:2500, mvi:0.6, status:'open', allocatedMinutes:0, dependsOn:'t2' },
  { id:'t4', name:'Design Build', project:'Q4 Campaign Email Sprint', assignees:['u4'], start:d(-18), due:d(+21), baselineDays:5, slackDays:2, codPerDay:3000, mvi:0.65, status:'open', allocatedMinutes:0, dependsOn:'t3' },
  { id:'t5', name:'SEO QA', project:'Website Refresh', assignees:['u1'], start:d(-26), due:d(+14), baselineDays:4, slackDays:0, codPerDay:4000, mvi:0.7, status:'open', allocatedMinutes:0, dependsOn:'t4' },
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

  // Guided tour state
  const [tourOpen, setTourOpen] = useState(false)
  const [tourIdx, setTourIdx]   = useState(0)

  useEffect(()=>{ mintCapacity() },[simRPA, simSVC])

  function mintCapacity(){
    const events = [
      { label: 'HubSpot Workflows: automated routing', minutes: 600 * STC.perZapRun, dayOffset: 7, conf: 'High' as const, project: 'Q4 Campaign Email Sprint' },
      { label: 'Microsoft Copilot: shorter weekly meeting', minutes: 30 * 8, dayOffset: 0, conf: 'High' as const, project: 'Q4 Sales Enablement' },
      { label: 'Asana AI: auto-status created', minutes: 6 * STC.weeklyStatus, dayOffset: 14, conf: 'High' as const, project: 'Q4 Sales Enablement' },
      { label: 'Copilot: first draft faster', minutes: 7 * 1 * STC.makerMinutesPerDay, dayOffset: 21, conf: 'Medium' as const, project: 'Q4 Campaign Email Sprint' },
      ...(simRPA ? [{ label: 'UiPath RPA: data entry automated', minutes: 10_000 * STC.rpaMinutesPerTxn * STC.realization, dayOffset: 7, conf: 'High' as const, project: 'Website Refresh' }] : []),
      ...(simSVC ? [{ label: 'Service AI Agent: routine questions resolved', minutes: 400 * STC.serviceMinPerTicket, dayOffset: 28, conf: 'High' as const, project: 'Service' }] : []),
    ]
    setTokens(events.map(e => ({ minutes: e.minutes, source: e.label, confidence: e.conf })))
    setCap(events.map(e => ({ dayOffset: e.dayOffset, label: e.label, hours: Math.round(e.minutes/60), project: e.project })))
  }

  function allocate(taskId:string, hours:number){
    let minsNeeded = hours*60
    const order: Array<'High'|'Medium'|'Low'> = ['High','Medium','Low']
    const newTokens = [...tokens]
    for(const tier of order){
      for(let i=0;i<newTokens.length;i++){
        const t = newTokens[i]
        if(t.confidence!==tier || t.minutes<=0) continue
        const take = Math.min(t.minutes, minsNeeded)
        newTokens[i] = {...t, minutes: t.minutes - take}
        minsNeeded -= take
        if(minsNeeded<=0) break
      }
      if(minsNeeded<=0) break
    }
    setTokens(newTokens)
    setTasks(ts=>ts.map(t=> t.id===taskId ? {...t, allocatedMinutes:(t.allocatedMinutes||0)+hours*60} : t))
  }

  function closeTask(taskId:string, iso:string){
    setTasks(ts=>{
      const t = ts.find(x=>x.id===taskId); if(!t) return ts
      // Ensure operational dollars > 0: close one day earlier than baseline
      const baselineEnd = new Date(new Date(t.start).getTime() + t.baselineDays*86400000)
      const earlierISO = new Date(baselineEnd.getTime() - 86400000).toISOString()
      const actualDays = Math.max(1, daysBetweenISO(t.start, earlierISO))
      const daysSaved = Math.max(0, t.baselineDays - actualDays)
      const value = daysSaved * t.codPerDay
      const tier: 'A'|'B'|'C' = (t.slackDays<=0 && daysSaved>0) ? 'B' : 'C'
      if(t.capability && t.allocatedMinutes){
        const capHrs = t.allocatedMinutes/60
        setEvidence(ev=>[{ label:'Capability growth', value: capHrs*120, tier:'C', details: `${capHrs.toFixed(1)}h x $120/h (proxy)` }, ...ev])
      }
      setEvidence(ev=>[{ taskId:t.id, daysSaved, value, tier, details: `Closed ${daysSaved.toFixed(1)}d faster; CoD/day $${t.codPerDay.toLocaleString()}.` }, ...ev])
      return ts.map(x=> x.id===taskId ? {...x, status:'closed', due: iso} : x)
    })
  }

  function harvestRPA(){
    const rpa = tokens.find(t=>t.source.includes('RPA'))
    if(!rpa) return
    const hours = rpa.minutes/60
    const contractorHours = hours * 0.3
    const dollars = contractorHours * 95
    setEvidence(ev=>[{ label:'RPA contractor reduction', value:dollars, tier:'A', details: `Reduced contractors by ${Math.round(contractorHours)}h @ $95/h.` }, ...ev])
  }
  function harvestService(){
    const svc = tokens.find(t=>t.source.includes('Service'))
    if(!svc) return
    const tickets = Math.round(svc.minutes / STC.serviceMinPerTicket)
    const dollars = tickets * 6.5
    setEvidence(ev=>[{ label:'Service cost avoided', value:dollars, tier:'A', details: `${tickets} deflected x $6.5/ticket.` }, ...ev])
  }
  function recordSQLLift(n=12){
    setEvidence(ev=>[{ label:'More qualified deals (strategic)', value:n*5600, tier:'C', details: `${n} deals x $5,600 value/deal.` }, ...ev])
  }

  function runDemo(){
    if(!seededOnce){
      allocate('t1', 8)
      // use baseline earlier (guarantee days saved)
      const t = tasks.find(x=>x.id==='t1')!
      const baselineEnd = new Date(new Date(t.start).getTime() + t.baselineDays*86400000)
      const earlierISO = new Date(baselineEnd.getTime() - 86400000).toISOString()
      closeTask('t1', earlierISO)
      if(simRPA) harvestRPA()
      if(simSVC) harvestService()
      recordSQLLift(12)
      setSeededOnce(true)
    }
    document.getElementById('evidence')?.scrollIntoView({behavior:'smooth'})
  }

  // Guided tour
  const steps: TourStep[] = [
    { id:'kpis',  title:'1) What we measure', text:'Operational (faster milestones), Cost avoided (external/manual hours cut), and Strategic (more qualified deals + skill growth).', targetId:'kpis' },
    { id:'gantt', title:'2) Where time appears', text:'Weekly pills show time created by your AI tools (Copilot, Asana AI, Workflows, RPA, AI Agents). Red bars are critical path.', targetId:'gantt' },
    { id:'gantt', title:'3) Redeploy to priority', text:'Moving 8h into “Design QA” (critical path).', targetId:'gantt', run:()=>allocate('t1', 8) },
    { id:'gantt', title:'4) Recognize operational value', text:'Close earlier than baseline. Only realized outcomes count.', targetId:'gantt', run:()=>{
      const t = tasks.find(x=>x.id==='t1')!
      const baselineEnd = new Date(new Date(t.start).getTime() + t.baselineDays*86400000)
      const earlierISO  = new Date(baselineEnd.getTime() - 86400000).toISOString()
      closeTask('t1', earlierISO)
    }},
    { id:'harvest', title:'5) Count cost avoided', text:'RPA contractor reduction and AI‑answered tickets.', targetId:'harvest', run:()=>{ harvestRPA(); harvestService() } },
    { id:'evidence', title:'6) Add growth', text:'Record “more qualified deals” and review the proof below.', targetId:'evidence', run:()=>recordSQLLift(12) },
  ]
  const [tourOpen2, setOpen] = useState(false)
  const [tourIdx2, setIdx]   = useState(0)
  function startTour(){ setOpen(true); setIdx(0) }
  function nextStep(){ const s=steps[tourIdx2]; if(s?.run) s.run(); if(tourIdx2<steps.length-1) setIdx(i=>i+1); else setOpen(false) }
  function prevStep(){ if(tourIdx2>0) setIdx(i=>i-1) }

  // KPI metrics
  const capturedMin = tokens.reduce((a,b)=>a+b.minutes,0)
  const capturedHrs = toIntHrs(capturedMin)
  const allocatedHrs = Math.round(tasks.reduce((a,b)=>a+(b.allocatedMinutes||0),0)/60)
  const redeployRate = capturedHrs>0 ? Math.round(allocatedHrs/capturedHrs*100) : 0

  const opValue = evidence.filter(e=>e.taskId && (e.daysSaved||0)>0).reduce((a,b)=>a+b.value,0)
  const daysSavedTotal = evidence.filter(e=>e.taskId && (e.daysSaved||0)>0).reduce((a,b)=>a+(b.daysSaved||0),0)
  const projectsAccelerated = evidence.filter(e=>e.taskId && (e.daysSaved||0)>0).length

  const costAvoided = evidence.filter(e=>e.label?.includes('RPA') || e.label?.includes('Service')).reduce((a,b)=>a+b.value,0)
  const strategic = evidence.filter(e=>e.label?.includes('qualified') || e.label?.includes('Capability')).reduce((a,b)=>a+b.value,0)
  const total = opValue + costAvoided + strategic
  const dollarsPerFreedHr = capturedHrs>0 ? Math.round(total/capturedHrs) : 0

  const tierSum = (t:'A'|'B'|'C') => evidence.filter(e=>e.tier===t).reduce((a,b)=>a+b.value,0)

  // Project filter
  const projects = Array.from(new Set(tasks.map(t=>t.project)))
  const tasksFiltered = project==='All' ? tasks : tasks.filter(t=>t.project===project)
  const capFiltered = project==='All' ? cap : cap.filter(e=>e.project===project)

  // Capacity table: hours + dollar value
  const capacityRows = useMemo(()=>{
    const map: Record<string, {label:string; hours:number; confidence:'High'|'Medium'|'Low'}> = {}
    tokens.forEach(t=>{
      const key = t.source
      if(!map[key]) map[key] = { label:key, hours:0, confidence:t.confidence }
      map[key].hours += t.minutes/60
      if(t.confidence==='Medium' && map[key].confidence==='High') map[key].confidence='Medium'
    })
    return Object.values(map).map(r=>({
      label:r.label, confidence:r.confidence, hours: Math.round(r.hours),
      dollars: Math.round(r.hours * VALUE_PER_HOUR)
    }))
  },[tokens])

  return (
    <div className="container">
      <h2 className="h">Turn AI time into dollars (Exec demo)</h2>
      <p className="small">We connect your AI tools (Copilot, Asana AI, Workflows, RPA, AI Agents), capture the time they create, redeploy it to priority work, and prove dollars—Operational, Cost avoided, and Strategic.</p>

      <div className="row" id="kpis">
        <div className="card kpi">
          <h3 className="h">Operational (velocity)</h3>
          <div><b>${Math.round(opValue).toLocaleString()}</b></div>
          <div className="small">{projectsAccelerated} milestones accelerated • {daysSavedTotal.toFixed(1)} total days saved</div>
          <div className="small">Tier A ${Math.round(tierSum('A')).toLocaleString()} • B ${Math.round(tierSum('B')).toLocaleString()} • C ${Math.round(tierSum('C')).toLocaleString()}</div>
        </div>
        <div className="card kpi">
          <h3 className="h">Cost avoided (harvested)</h3>
          <div><b>${Math.round(costAvoided).toLocaleString()}</b></div>
          <div className="small">Contractor reduction & AI‑answered tickets recognized</div>
        </div>
        <div className="card kpi">
          <h3 className="h">Strategic (growth/capability)</h3>
          <div><b>${Math.round(strategic).toLocaleString()}</b></div>
          <div className="small">More qualified deals • skill hours invested</div>
        </div>
      </div>

      <div className="row">
        <div className="card kpi">
          <h3 className="h">Capacity captured</h3>
          <div><b>{capturedHrs} hrs</b></div>
          <div className="small">Redeployed {allocatedHrs}h • Rate {redeployRate}% • ${dollarsPerFreedHr}/freed hr</div>
        </div>
        <div className="card kpi">
          <h3 className="h">Quick actions</h3>
          <button className="btn" onClick={()=>{ setTourOpen(true); setTourIdx(0) }}>Start guided demo</button>
          &nbsp;<button className="btn secondary" onClick={runDemo}>Run 30-sec demo</button>
        </div>
        <div className="card kpi">
          <h3 className="h">Project filter</h3>
          <div className="row">
            <button className={`btn ${project==='All'?'':'secondary'}`} onClick={()=>setProject('All')}>All</button>
            {projects.map(p=><button key={p} className={`btn ${project===p?'':'secondary'}`} onClick={()=>setProject(p)}>{p}</button>)}
          </div>
        </div>
      </div>

      <div className="card" id="gantt">
        <h3 className="h">Gantt — weekly freed time + critical path hotspots</h3>
        <Gantt tasks={tasksFiltered} capacity={capFiltered} onAllocate={allocate} onComplete={closeTask}/>
      </div>

      <div className="card">
        <h3 className="h">Simulation toggles</h3>
        <label className="switch"><input type="checkbox" checked={simRPA} onChange={e=>setSimRPA(e.target.checked)}/> RPA back-office automation</label>
        <label className="switch"><input type="checkbox" checked={simSVC} onChange={e=>setSimSVC(e.target.checked)}/> AI Agent resolves routine questions</label>
      </div>

      <div className="card">
        <h3 className="h">Capacity sources (summary)</h3>
        <table className="table">
          <thead><tr><th>AI tool → Outcome</th><th>Confidence</th><th>Hours</th><th>$ value (@${VALUE_PER_HOUR}/h)</th></tr></thead>
          <tbody>
            {capacityRows.map((r,i)=>(
              <tr key={i}>
                <td>{r.label}</td>
                <td><span className={`badge ${r.confidence==='High'?'green':'amber'}`}>{r.confidence}</span></td>
                <td>{r.hours}</td>
                <td>${r.dollars.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" id="harvest">
        <h3 className="h">Harvest / Strategic actions</h3>
        <div className="row">
          <div className="card kpi"><h4 className="h">RPA contractor reduction</h4><button className="btn" onClick={harvestRPA}>Recognize hard savings</button><p className="small">Counted only when POs/seats/contracts are reduced.</p></div>
          <div className="card kpi"><h4 className="h">AI Agent cost avoided</h4><button className="btn" onClick={harvestService}>Recognize cost avoided</button></div>
          <div className="card kpi"><h4 className="h">Record growth</h4><button className="btn" onClick={()=>recordSQLLift(12)}>Add qualified deals → $</button></div>
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

      {/* Guided tour overlay */}
      <Tour open={tourOpen} index={tourIdx} steps={steps}
            onNext={()=>{ const s=steps[tourIdx]; if(s?.run) s.run(); if(tourIdx<steps.length-1) 
