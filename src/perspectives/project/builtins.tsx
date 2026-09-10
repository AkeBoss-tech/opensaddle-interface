import React from 'react'
import {registerSurface} from '../../surfaces/registry'
import {compilePerspectiveCatalog} from '../catalog'
import type {ProjectTaskCard,ProjectTaskModel} from './model'
void React
export interface ProjectPerspectiveInputs {model:ProjectTaskModel;onOpenTask:(id:string)=>void;onNewTask:()=>void}
function Task({task,onOpen}:{task:ProjectTaskCard;onOpen:(id:string)=>void}){return <button className="project-task-card" onClick={()=>onOpen(task.id)}><strong>{task.title}</strong><span>{task.status} · {task.verified?'Result verified':'Not verified'}</span></button>}
export function DialoguePerspective({model,onOpenTask,onNewTask}:ProjectPerspectiveInputs){return <section className="project-dialogue"><header><h2>What would you like to work on?</h2><p>Start a task or open its existing task and execution evidence.</p><button onClick={onNewTask}>New task</button></header><div className="project-task-list">{model.tasks.map(task=><Task key={task.id} task={task} onOpen={onOpenTask}/>)}</div>{!model.tasks.length&&<p>No tasks in this project yet.</p>}</section>}
export function DispatchPerspective({model,onOpenTask,onNewTask}:ProjectPerspectiveInputs){const columns=[{title:'Queued',states:['queued','pending']},{title:'Working',states:['running','leased','starting','provisioning','verifying']},{title:'Needs attention',states:['awaiting_approval','paused']},{title:'Finished',states:['completed','failed','cancelled','canceled']},{title:'Other',states:[]}];const known=columns.flatMap(column=>column.states);return <section className="project-dispatch"><header><h2>Project dispatch</h2><button onClick={onNewTask}>New task</button></header><div className="project-dispatch-columns">{columns.map(column=><section key={column.title}><h3>{column.title}</h3>{model.tasks.filter(task=>column.states.length?column.states.includes(task.status):!known.includes(task.status)).map(task=><Task key={task.id} task={task} onOpen={onOpenTask}/>)}</section>)}</div></section>}
registerSurface({id:'project-dialogue-v1',inputs:['model','onOpenTask','onNewTask'],Component:DialoguePerspective})
registerSurface({id:'project-dispatch-v1',inputs:['model','onOpenTask','onNewTask'],Component:DispatchPerspective})
export const PROJECT_PERSPECTIVES=compilePerspectiveCatalog([
 {id:'dialogue',version:'1.0.0',title:'Dialogue',description:'Focused task list and access to task evidence.',surfaceId:'project-dialogue-v1',requiredCapabilities:['projection.project-runs.v1']},
 {id:'dispatch',version:'1.0.0',title:'Dispatch',description:'Status board over the same project tasks.',surfaceId:'project-dispatch-v1',requiredCapabilities:['projection.project-runs.v1']},
],new Set(['projection.project-runs.v1']))
export function resolveProjectPerspective(id:string){return {perspective:PROJECT_PERSPECTIVES.find(item=>item.id===id)??PROJECT_PERSPECTIVES[0],fallback:!PROJECT_PERSPECTIVES.some(item=>item.id===id)}}
