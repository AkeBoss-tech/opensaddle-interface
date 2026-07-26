import { Sidebar } from 'opensaddle-interface'

export function Expanded() {
  return (
    <div style={{ height: 560, display: 'flex' }}>
      <Sidebar onCreateProject={() => {}} collapsed={false} onCollapsedChange={() => {}} />
    </div>
  )
}

export function Collapsed() {
  return (
    <div style={{ height: 560, display: 'flex' }}>
      <Sidebar onCreateProject={() => {}} collapsed onCollapsedChange={() => {}} />
    </div>
  )
}
