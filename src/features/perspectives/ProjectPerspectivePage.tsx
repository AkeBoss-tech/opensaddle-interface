import './project-perspectives.css'
import {useParams} from 'react-router-dom'
import {useStore} from '../../data/store'
import {ProjectPerspectiveWorkspace} from './ProjectPerspectiveWorkspace'
export function ProjectPerspectivePage(){const {projectId=''}=useParams();const {services}=useStore();return <ProjectPerspectiveWorkspace key={projectId} projectId={projectId} services={services}/>}
