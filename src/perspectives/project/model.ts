import type {JourneySnapshot} from '../../features/onboarding/ConnectedJourneySurface'
export interface ProjectTaskCard {id:string;title:string;status:string;verified:boolean;source:'active_run'|'result'}
export interface ProjectTaskModel {projectId:string;tasks:readonly ProjectTaskCard[]}
export function projectTaskModel(snapshot:JourneySnapshot,projectId:string):ProjectTaskModel {
 if(snapshot.projectId!==projectId)throw Error('Project projection mismatch')
 const tasks:ProjectTaskCard[]=[],seen=new Set<string>()
 for(const run of snapshot.activeRuns??[]){if(seen.has(run.runId))throw Error('Duplicate run');seen.add(run.runId);tasks.push(Object.freeze({id:run.runId,title:run.task,status:run.status,verified:false,source:'active_run'}))}
 for(const result of snapshot.results??[]){if(seen.has(result.runId))continue;seen.add(result.runId);tasks.push(Object.freeze({id:result.runId,title:result.title,status:result.status??'unknown',verified:result.verified,source:'result'}))}
 return Object.freeze({projectId,tasks:Object.freeze(tasks)})
}
