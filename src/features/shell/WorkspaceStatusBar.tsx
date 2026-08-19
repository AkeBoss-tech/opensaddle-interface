import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { connectionPresentation } from '../../lib/connectionPresentation'

export function WorkspaceStatusBar() {
  const { connection, data, services, persistenceStatus } = useStore()
  const navigate = useNavigate()
  const project = data.projects.find((item) => item.id === data.activeProjectId)
  const activeChat = data.chats.find((item) => item.id === data.activeChatId)
  const latestRun = useMemo(
    () => data.messages
      .filter((message) => message.chatId === activeChat?.id && message.run)
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.run,
    [activeChat?.id, data.messages],
  )
  const diff = latestRun?.artifacts.find((artifact) => artifact.type === 'diff')?.diff ?? []
  const changeCount = diff.length
  const connectionState = connectionPresentation({
    connection,
    controlPlane: services?.controlPlane ?? null,
    desktop: Boolean(window.opensaddleDesktop),
  })

  return (
    <footer className="tf-statusbar" aria-label="Workspace status">
      <button onClick={() => navigate('/settings')} title={connectionState.title}>
        <span className={`tf-connection-dot ${connectionState.kind}`} />
        {connectionState.label}
      </button>
      <button onClick={() => project && navigate(`/project/${project.id}`)}>{project?.name ?? 'No project'}</button>
      {changeCount > 0 && <button onClick={() => activeChat && navigate(`/chat/${activeChat.id}`)}>{changeCount} change{changeCount === 1 ? '' : 's'}</button>}
      {latestRun?.cost && <span>{latestRun.cost}</span>}
      <span className="tf-statusbar-spacer" />
      <button onClick={() => navigate('/settings')}>
        {connectionState.kind === 'demo'
          ? 'Simulated workspace'
          : !connectionState.connected
          ? 'Waiting for server'
          : persistenceStatus === 'syncing'
            ? 'Saving…'
            : persistenceStatus === 'error'
              ? 'Save error'
              : persistenceStatus === 'synced'
                ? 'Saved'
                : 'Connected'}
      </button>
    </footer>
  )
}
