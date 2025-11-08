'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Gantt, { CapEvent, Task } from '../components/Gantt'
import Tour, { TourStep } from '../components/Tour'

type Team = 'Content'|'Design'|'Ops'|'Support'

// map tool/outcome text to a team (very simple demo rules)
function teamForSource(src:string): Team{
  const s = src.toLowerCase()
  if (s.includes('draft') || s.includes('copy') || s.includes('status')) return 'Content'
  if (s.includes('design')) return 'Design'
  if (s.includes('agent') || s.includes('questions')) return 'Support'
  return 'Ops'
}

type Evidence = { taskId?: string; label?: string; daysSaved?: number; value: number; tier: 'A'|'B'|'C'; details: string }
type Token = { minutes:number; source:string; confidence:'High'|'Medium'|'Low' }

function d(offset:number){ const dt=new Date(); dt.setDate(dt.getDate()+offset); return dt.toISOString() }
function daysBetweenISO(a:string,b:string){ return Math.max(1, Math.round((new Date(b).getTime()-new Date(a).getTime())/86400000)) }
const toIntHrs = (m:number)=> Math.round(m/60)

// valuation constants for the demo
const HOURLY_VALUE = 135 // $/freed hr shown in Capacity sources

const STC = {
  perZapRun: 90,
  weeklyStatus: 90,
  makerMinutesPerDay: 60,
  rpaMinutesPerTxn: 1.2,
  serviceMinPerTicket: 7,
  realization: 0.8,
}

// dependsOn is a single string to match Gantt props
const seeded: Task[] = [
  { id:'t1', name:'Design QA', project:'Q4 Sales Enablement', assignees:['u1'], start:d(-12), due:d(+10), baselineDays:4, slackDays:0, codPerDay:7500, mvi:0.84, status:'open', allocatedMinutes:0 },
  { id:'t2', name:'Field Pilot Synthesis', project:'Q4 Sales Enablement', assignees:['u2'], start:d(-10), due:d(+14), baselineDays:3, slackDays:0, codPerDay:3500, mvi:0.77, status:'open', allocatedMinutes:0, capability:true, dependsOn:'t1' },
  { id:'t3', name:'Email Copy v1', project:'Q4 Campaign Email Sprint', assignees:['u3'], start:d(-9), due:d(+7), baselineDays:3, slackDays:1, codPerDay:2500, mvi:0.6, status:'open', allocatedMinutes:0, dependsOn:'t2' },
  { id:'t4', name:'Design Build', project:'Q4 Campaign Email Sprint', assignees:['u4'], start:d(-7), due:d(+20), baselineDays:5, slackDays:2, codPerDay:3000, mvi:0.65, status:'open', allocatedMinutes:0, dependsOn:'t3' },
  { id:'t5', name:'SEO QA', project:'Website Refresh', assignees:['u1'], start:d(-11), due:d(+15), baselineDays:4, slackDays:0, codPerDay:4000, mvi:0.7, status:'open', allocatedMinutes:0, dependsOn:'t4' },
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

  // Guided tour
  const [tourOpen, setTourOpen] = useState(false)
  const [tourIdx, setTourIdx]   = useState(0)

  useEffect(()=>{ mintCapacity() },[simRPA, simSVC])

  const [panelTask, setPanelTask] = useState<Task|null>(null)
const [panelTeam, setPanelTeam] = useState<Team>('Ops')
const [panelHours, setPanelHours] = useState<number>(8)

// weekly capacity by team from tokens
const teamHours = useMemo(()=>{
  const obj: Record<Team, number> = {Content:0, Design:0, Ops:0, Support:0}
  tokens.forEach(t=>{
    const hrs = Math.round(t.minutes/60)
    const team = teamForSource(t.source)
    obj[team] += hrs
  })
  return obj
},[tokens])

function openPanel(taskId:string){
  const t = tasks.find(x=>x.id===taskId) || null
  setPanelTask(t)
  // naive recommendation by task name
  const name = (t?.name||'').toLowerCase()
  let rec:Team = 'Ops'
  if(name.includes('design')) rec='Design'
  else if(name.includes('email')||name.includes('copy')||name.includes('seo')) rec='Content'
  else if(name.includes('pilot')||name.includes('qa')) rec='Support'
  setPanelTeam(rec)
  setPanelHours(Math.min(8, teamHours[rec]||8))
}

// confirm redeploy
function confirmRedeploy(){
  if(!panelTask) return
  allocate(panelTask.id, panelHours)
  setPanelTask(null)
}

  // Capacity minting → tokens + weekly capacity pills
  function mintCapacity(){
    const events = [
      { label: 'HubSpot Workflows: automated routing', minutes: 600 * STC.perZapRun, dayOffset: 1, conf: 'High' as const, project: 'Q4 Campaign Email Sprint' },
      { label: 'Microsoft Copilot: shorter weekly meeting', minutes: 30 * 6, dayOffset: 0, conf: 'High' as const, project: 'Q4 Sales Enablement' },
      { label: 'Asana AI: auto-status created', minutes: 6 * STC.weeklyStatus, dayOffset: 2, conf: 'High' as const, project: 'Q4 Sales Enablement' },
      { label: 'Copilot: first draft faster', minutes: 7 * 1 * STC.makerMinutesPerDay, dayOffset: 3, conf: 'Medium' as const, project: 'Q4 Campaign Email Sprint' },
      ...(simRPA ? [{
        label: 'UiPath RPA: data entry automated',
        minutes: 10_000 * STC.rpaMinutesPerTxn * STC.realization,
        dayOffset: 1,
        conf: 'High' as const,
        project: 'Website Refresh'
      }] : []),
      ...(simSVC ? [{
        label: 'Service AI Agent: routine questions resolved',
        minutes: 400 * STC.serviceMinPerTicket,
        dayOffset: 4,
        conf: 'High' as const,
        project: 'Service'
      }] : []),
    ]

    setTokens(events.map(e => ({ minutes: e.minutes, source: e.label, confidence: e.conf })))
    setCap(events.map(e => ({ dayOffset: e.dayOffset, label: e.label, hours: Math.round(e.minutes/60), project: e.project })))
  }

  // Allocate pooled capacity to a task
 function allocate(taskId: string, hours: number){
  let minsNeeded = hours * 60
  const order: Array<'High'|'Medium'|'Low'> = ['High','Medium','Low']
  const newTokens = [...tokens]
  for (const tier of order){
    for (let i=0;i<newTokens.length;i++){
      const t = newTokens[i]
      if (t.confidence !== tier || t.minutes <= 0) continue
      const take = Math.min(t.minutes, minsNeeded)
      newTokens[i] = { ...t, minutes: t.minutes - take }
      minsNeeded -= take
      if (minsNeeded <= 0) break
    }
    if (minsNeeded <= 0) break
  }
  setTokens(newTokens)

  // 8h ≈ 1 day predicted shorten (demo logic)
  setTasks(ts => ts.map(t => {
    if (t.id !== taskId) return t
    const predicted = Math.ceil(hours / 8)
    return { ...t, allocatedMinutes: (t.allocatedMinutes || 0) + hours * 60, predictedDaysSaved: (t.predictedDaysSaved || 0) + predicted }
  }))
}
  


  // Close task with earlier actual date → Operational dollars and ghost tick
function closeTask(taskId: string, iso: string){
  setTasks(ts => {
    const t = ts.find(x => x.id === taskId)
    if (!t) return ts

    // 1) Compare to scheduled due date (what execs expect)
    const schedDur  = Math.max(1, daysBetweenISO(t.start, t.due))      // planned start→due
    const actualDur = Math.max(1, daysBetweenISO(t.start, iso))        // start→actual close
    const daysSaved = Math.max(0, schedDur - actualDur)                // if iso < due → positive
    const value     = daysSaved * t.codPerDay
    const tier: 'A'|'B'|'C' = (t.slackDays <= 0 && daysSaved > 0) ? 'B' : 'C'

    // 2) Optional capability credit (from allocated minutes)
    if (t.capability && t.allocatedMinutes) {
      const capHrs = t.allocatedMinutes / 60
      setEvidence(ev => [
        { label: 'Capability growth', value: capHrs * 120, tier: 'C', details: `${capHrs.toFixed(1)}h x $120/h (proxy)` },
        ...ev
      ])
    }

    // 3) Operational evidence: realized days saved vs due
    setEvidence(ev => [
      { taskId: t.id, daysSaved, value, tier, details: `Closed ${daysSaved.toFixed(1)}d earlier than due; CoD/day $${t.codPerDay.toLocaleString()}.` },
      ...ev
    ])

    // 4) Write back: keep a copy of the original due for the ghost tick; move due earlier; clear prediction
    const plannedDue = t.plannedDue ?? t.due
    return ts.map(x => x.id === taskId
      ? { ...x, status: 'closed', plannedDue, predictedDaysSaved: 0, due: iso }
      : x
    )
  })
}

  // Harvest hard savings
  function harvestRPA(){
    const rpa = tokens.find(t=>t.source.includes('RPA'))
    if(!rpa) return
    const hours = rpa.minutes/60
    const contractorHours = hours * 0.3
    const dollars = contractorHours * 95
    setEvidence(ev=>[
      { label:'RPA contractor reduction', value:dollars, tier:'A', details: `Reduced contractors by ${Math.round(contractorHours)}h @ $95/h.` },
      ...ev
    ])
  }
  function harvestService(){
    const svc = tokens.find(t=>t.source.includes('Service'))
    if(!svc) return
    const tickets = Math.round(svc.minutes / STC.serviceMinPerTicket)
    const dollars = tickets * 6.5
    setEvidence(ev=>[
      { label:'AI Agent cost avoided', value:dollars, tier:'A', details: `${tickets} deflected x $6.5/ticket.` },
      ...ev
    ])
  }
  function recordSQLLift(n=12){
    setEvidence(ev=>[
      { label:'More qualified deals (strategic)', value:n*5600, tier:'C', details: `${n} deals x $5,600 value/deal.` },
      ...ev
    ])
  }

  // 30‑sec demo: allocate → close (earlier than planned due) → harvest → growth
  function runDemo(){
    if(!seededOnce){
      allocate('t1', 8)
      const t1 = tasks.find(t=>t.id==='t1')
      if(t1){
        const earlier = new Date(t1.due); earlier.setDate(earlier.getDate()-1) // 1 day earlier than planned
        closeTask('t1', earlier.toISOString())
      }
      if(simRPA) harvestRPA()
      if(simSVC) harvestService()
      recordSQLLift(12)
      setSeededOnce(true)
    }
    document.getElementById('evidence')?.scrollIntoView({behavior:'smooth'})
  }

  // Guided tour (Next/Back)
  const steps: TourStep[] = [
    { id:'kpis',  title:'1) What we measure', text:'Executive dollars: Operational (faster milestones), Cost avoided (fewer external/manual hours), and Strategic (more qualified deals + skill growth).', targetId:'kpis' },
    { id:'gantt', title:'2) Where time appears', text:'Weekly freed time from Copilot, Asana AI, Workflows, RPA, and AI Agents (green pills). Red bars show critical‑path tasks.', targetId:'gantt' },
    { id:'gantt', title:'3) Redeploy to priority', text:'Move 8h to “Design QA” (critical path) to accelerate the launch.', targetId:'gantt', run:()=>allocate('t1', 8) },
    { id:'gantt', title:'4) Recognize operational value', text:'Mark it complete earlier than planned. We compute dollars only from realized days saved.', targetId:'gantt', run:()=>{
      const t1 = tasks.find(t=>t.id==='t1')
      if(t1){ const earlier = new Date(t1.due); earlier.setDate(earlier.getDate()-1); closeTask('t1', earlier.toISOString()) }
    }},
    { id:'harvest', title:'5) Count cost avoided', text:'Recognize RPA contractor reduction and AI‑answered tickets.', targetId:'harvest', run:()=>{ harvestRPA(); harvestService() } },
    { id:'evidence', title:'6) Add growth & review proof', text:'Record “more qualified deals.” Every line has an audit trail below.', targetId:'evidence', run:()=>recordSQLLift(12) },
  ]
  function startTour(){ setTourOpen(true); setTourIdx(0) }
  function nextStep(){
    const s = steps[tourIdx]; if(s?.run) s.run()
    if(tourIdx < steps.length-1) setTourIdx(tourIdx+1); else setTourOpen(false)
  }
  function prevStep(){ if(tourIdx>0) setTourIdx(tourIdx-1) }

  // Metrics
  const capturedMin = tokens.reduce((a,b)=>a+b.minutes,0)
  const capturedHrs = toIntHrs(capturedMin)
  const allocatedHrs = Math.round(tasks.reduce((a,b)=>a+(b.allocatedMinutes||0),0)/60)
  const redeployRate = capturedHrs>0 ? Math.round(allocatedHrs/capturedHrs*100) : 0

  const opValue = evidence.filter(e=>e.taskId).reduce((a,b)=>a+b.value,0)
  const costAvoided = evidence.filter(e=>e.label?.includes('RPA') || e.label?.includes('Agent')).reduce((a,b)=>a+b.value,0)
  const strategic = evidence.filter(e=>e.label?.includes('qualified') || e.label?.includes('Capability')).reduce((a,b)=>a+b.value,0)
  const total = opValue + costAvoided + strategic
  const dollarsPerFreedHr = capturedHrs>0 ? Math.round(total/capturedHrs) : 0

  const tierSum = (t:'A'|'B'|'C') => evidence.filter(e=>e.tier===t).reduce((a,b)=>a+b.value,0)

  // Project filter
  const projects = Array.from(new Set(tasks.map(t=>t.project)))
  const tasksFiltered = project==='All' ? tasks : tasks.filter(t=>t.project===project)
  const capFiltered = project==='All' ? cap : cap.filter(e=>e.project===project)

  // Grouped capacity sources (table) → hours + $ value/hr
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
      <p className="small">We connect your AI tools (Copilot, Asana AI, Workflows, RPA, AI Agents), capture the time they create, redeploy it to priority work, and prove dollars—Operational, Cost avoided, Strategic. No forecasts. No timesheets.</p>

      <div className="row" id="kpis">
        <div className="card kpi">
          <h3 className="h">Operational (velocity)</h3>
          <div><b>${Math.round(opValue).toLocaleString()}</b></div>
          <span className="small">Realized days saved on critical milestones • Tier A ${Math.round(tierSum('A')).toLocaleString()} • B ${Math.round(tierSum('B')).toLocaleString()} • C ${Math.round(tierSum('C')).toLocaleString()}</span>
        </div>
        <div className="card kpi">
          <h3 className="h">Cost avoided (harvested)</h3>
          <div><b>${Math.round(costAvoided).toLocaleString()}</b></div>
          <span className="small">Contractor/licence/time reductions tied to AI automation</span>
        </div>
        <div className="card kpi">
          <h3 className="h">Strategic (growth/capability)</h3>
          <div><b>${Math.round(strategic).toLocaleString()}</b></div>
          <span className="small">More qualified deals and skill hours invested</span>
        </div>
      </div>

      <div className="row">
        <div className="card kpi">
          <h3 className="h">Capacity captured</h3>
          <div><b>{capturedHrs} hrs</b></div>
          <span className="small">Redeployed: {allocatedHrs}h • Rate: {redeployRate}% • $/freed hr: ${dollarsPerFreedHr}</span>
        </div>
        <div className="card kpi">
          <h3 className="h">Quick actions</h3>
          <button className="btn" onClick={startTour}>Start guided demo</button>
          &nbsp;<button className="btn secondary" onClick={runDemo}>Run 30‑sec demo</button>
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
        <Gantt tasks={tasksFiltered} capacity={capFiltered} onAllocate={allocate} onComplete={closeTask} onView={openPanel}/>
      </div>

      <div className="card">
        <h3 className="h">Simulation toggles</h3>
        <label className="switch"><input type="checkbox" checked={simRPA} onChange={e=>setSimRPA(e.target.checked)}/> RPA back‑office automation</label>
        <label className="switch"><input type="checkbox" checked={simSVC} onChange={e=>setSimSVC(e.target.checked)}/> AI Agent resolves routine questions</label>
        <span className="small"> Toggling changes capacity sources and harvestable savings.</span>
      </div>

      <div className="card">
        <h3 className="h">Capacity sources (summary)</h3>
        <table className="table">
          <thead><tr><th>AI tool → Outcome</th><th>Confidence</th><th>Hours</th><th>Value ($)</th></tr></thead>
          <tbody>
            {groupedSources.map((s,i)=>{
              const hrs = toIntHrs(s.minutes)
              return (
                <tr key={i}>
                  <td>{s.source}</td>
                  <td><span className={`badge ${s.confidence==='High'?'green':'amber'}`}>{s.confidence}</span></td>
                  <td>{hrs}</td>
                  <td>${(hrs*HOURLY_VALUE).toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="card" id="harvest">
        <h3 className="h">Harvest / Strategic actions</h3>
        <div className="row">
          <div className="card kpi">
            <h4 className="h">RPA contractor reduction</h4>
            <button className="btn" onClick={harvestRPA}>Recognize hard savings</button>
            <p className="small">Counted only when POs/seats/contracts are reduced.</p>
          </div>
          <div className="card kpi">
            <h4 className="h">AI Agent cost avoided</h4>
            <button className="btn" onClick={harvestService}>Recognize cost avoided</button>
          </div>
          <div className="card kpi">
            <h4 className="h">Record growth</h4>
            <button className="btn" onClick={()=>recordSQLLift(12)}>Add qualified deals → $</button>
          </div>
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
      <Tour
        open={tourOpen}
        index={tourIdx}
        steps={steps}
        onNext={nextStep}
        onPrev={prevStep}
        onClose={()=>setTourOpen(false)}
      />
    </div>
  )
}
