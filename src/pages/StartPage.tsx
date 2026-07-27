import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'

export function StartPage() {
  const navigate = useNavigate()
  const { data, createProject, createChat, createAgent, services, toast } = useStore()

  const createWorkspace = () => {
    const projectId = createProject('My first project', null, 'A focused workspace for a new OpenSaddle task.')
    const chat = createChat(projectId, 'Plan my first task')
    toast('Project ready', 'Describe the outcome you want in the new chat.')
    navigate(`/chat/${chat.id}`)
  }
  const createQuickChat = () => {
    const chat = createChat(data.activeProjectId, 'New chat')
    navigate(`/chat/${chat.id}`)
  }
  const createAgentForProject = () => {
    const project = data.projects.find((item) => item.id === data.activeProjectId)
    if (!project) return
    const agent = createAgent({ projectId: project.id, name: `${project.name} assistant`, description: 'General-purpose project agent', systemPrompt: 'Help the project make steady, safe progress.', modelPolicy: 'auto', harness: 'coding', runtime: 'local', tools: ['Files'], knowledgeSourceIds: [], visibility: 'private' })
    toast('Agent created', `${agent.name} is ready in ${project.name}.`)
    navigate(`/agent/${agent.id}`)
  }

  return <div className="content-page start-page">
    <section className="start-hero">
      <span className="start-kicker"><Icon name="saddle" className="icon sm" /> Start here</span>
      <h1>Turn an outcome into a scoped agent run.</h1>
      <p>Projects hold context, chats hold intent, agents do work, and runs preserve the evidence. Start with the smallest useful thing.</p>
      <div className="start-actions">
        <button className="primary-btn" onClick={createWorkspace}><Icon name="plus" className="icon sm" /> Create a project and chat</button>
        <button className="secondary-btn" onClick={createQuickChat}><Icon name="chat" className="icon sm" /> Start a quick chat</button>
      </div>
    </section>
    <section className="start-grid">
      <button className="start-card" onClick={createWorkspace}><Icon name="folder" className="icon" /><strong>1. Create a project</strong><span>Keep files, permissions, agents, runs, and knowledge together.</span></button>
      <button className="start-card" onClick={createQuickChat}><Icon name="chat" className="icon" /><strong>2. Describe the outcome</strong><span>Ask for a plan, research, a fix, or an automation in a chat.</span></button>
      <button className="start-card" onClick={createAgentForProject}><Icon name="spark" className="icon" /><strong>3. Add a specialist</strong><span>Create an agent when the work needs its own role, tools, or permissions.</span></button>
      <button className="start-card" onClick={() => navigate('/runs')}><Icon name="clock" className="icon" /><strong>4. Review runs</strong><span>Follow approvals, artifacts, verification, and the final outcome.</span></button>
    </section>
    <section className="start-status">
      <span className={`pulse ${services?.controlPlane.connected ? '' : 'offline'}`} />
      <div><strong>{services?.controlPlane.connected ? 'Control plane connected' : 'Local workspace mode'}</strong><p>{services?.controlPlane.connected ? 'New chats can use the connected runtime.' : 'You can plan and organize work now. Start the local control plane when you are ready to run agents.'}</p></div>
      <button className="secondary-btn" onClick={() => navigate('/settings')}>Open setup</button>
    </section>
  </div>
}
