import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../common/Icon'

export function NativeBrowserPane({ width, collapsed, onCollapse, onClose }: { width: number; collapsed: boolean; onCollapse: () => void; onClose: () => void }) {
  const [url, setUrl] = useState('https://example.com')
  const [zoom, setZoom] = useState(100)
  const [menuOpen, setMenuOpen] = useState(false)
  const [finding, setFinding] = useState(false)
  const [findText, setFindText] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

  const syncBounds = () => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    void window.opensaddle?.setBrowserBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }

  const navigate = () => {
    // The view is created asynchronously in the main process.  Syncing only
    // after that completes prevents Electron from showing its default full
    // window-sized view on the first open.
    void window.opensaddle?.openBrowser(url).then(() => requestAnimationFrame(syncBounds)).catch(() => undefined)
  }

  const command = (action: 'back' | 'forward' | 'reload' | 'zoom-in' | 'zoom-out' | 'zoom-reset') => {
    void window.opensaddle?.browserCommand(action).then((result) => setZoom(Math.round(result.zoomFactor * 100)))
  }

  const closeFind = () => {
    setFinding(false)
    setFindText('')
    void window.opensaddle?.stopFindingInBrowser()
  }

  useEffect(() => {
    navigate()
    return () => { void window.opensaddle?.closeBrowser() }
  // The native view is created once; navigation is explicitly user-triggered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    syncBounds()
    const observer = new ResizeObserver(syncBounds)
    observer.observe(canvas)
    window.addEventListener('resize', syncBounds)
    return () => { observer.disconnect(); window.removeEventListener('resize', syncBounds) }
  }, [])

  return (
    <aside className={`native-browser-pane ${collapsed ? 'collapsed' : ''}`} style={{ width }} aria-label="OpenSaddle browser" aria-hidden={collapsed}>
      <form className="native-browser-toolbar" onSubmit={(event) => { event.preventDefault(); navigate() }}>
        <span className="native-browser-mark"><Icon name="globe" className="icon sm" /></span>
        <button className="icon-btn" type="button" title="Back" onClick={() => command('back')}><Icon name="back" className="icon sm" /></button>
        <button className="icon-btn" type="button" title="Forward" onClick={() => command('forward')}><Icon name="forward" className="icon sm" /></button>
        <input aria-label="Browser URL" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
        <button className="icon-btn" type="submit" title="Reload page"><Icon name="refresh" className="icon sm" /></button>
        <button className="icon-btn" type="button" title="Browser settings" onClick={() => setMenuOpen((open) => !open)}><Icon name="more" className="icon sm" /></button>
        <button className="icon-btn" type="button" title="Collapse browser" onClick={onCollapse}><Icon name="chevron" className="icon sm" /></button>
        <button className="icon-btn" type="button" title="Close browser" onClick={onClose}><Icon name="x" className="icon sm" /></button>
      </form>
      {finding && <form className="native-find" onSubmit={(event) => { event.preventDefault(); void window.opensaddle?.findInBrowser(findText) }}>
        <input autoFocus aria-label="Find in page" placeholder="Find in page" value={findText} onChange={(event) => { setFindText(event.target.value); void window.opensaddle?.findInBrowser(event.target.value) }} />
        <button className="icon-btn" type="button" title="Close find" onClick={closeFind}><Icon name="x" className="icon sm" /></button>
      </form>}
      {menuOpen && <div className="native-browser-menu" role="menu">
        <button type="button" onClick={() => { setFinding(true); setMenuOpen(false) }}>Find in page</button>
        <button type="button" onClick={() => { void window.opensaddle?.printBrowser(); setMenuOpen(false) }}>Print</button>
        <div className="native-menu-row"><span>Zoom</span><button type="button" aria-label="Zoom out" onClick={() => command('zoom-out')}><Icon name="minus" className="icon sm" /></button><button type="button" onClick={() => command('zoom-reset')}>{zoom}%</button><button type="button" aria-label="Zoom in" onClick={() => command('zoom-in')}><Icon name="plus" className="icon sm" /></button></div>
        <button type="button" onClick={() => { void window.opensaddle?.screenshotBrowser(); setMenuOpen(false) }}><Icon name="camera" className="icon sm" /> Take a screenshot</button>
        <div className="native-menu-separator" />
        <button type="button" onClick={() => { void window.opensaddle?.clearBrowserData(); setMenuOpen(false) }}>Clear browsing data</button>
        <p>Browser data stays in this local OpenSaddle profile.</p>
      </div>}
      <div ref={canvasRef} className="native-browser-canvas" />
    </aside>
  )
}
