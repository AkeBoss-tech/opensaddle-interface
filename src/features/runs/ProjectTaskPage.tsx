import {useParams} from 'react-router-dom'
import {useStore} from '../../data/store'
import {AuthoritativeRunSurface} from './AuthoritativeRunSurface'

/** Project navigation remains host-owned, regardless of the selected Perspective. */
export function ProjectTaskPage(){
 const {projectId='',runId=''}=useParams()
 const {services,data}=useStore()
 const journey=services?.journey
 if(!journey?.runDetail)return <main className="content-page cc-page"><h1>Task unavailable</h1><p role="status">This connection does not provide authoritative task details.</p></main>
 return <AuthoritativeRunSurface key={`${data.currentUserId}:${projectId}:${runId}`} authority={journey as typeof journey & {runDetail:NonNullable<typeof journey.runDetail>}} runId={runId} projectId={projectId} codingResults={services?.codingResults} approvalReview={services?.runApprovalReview}/>
}
