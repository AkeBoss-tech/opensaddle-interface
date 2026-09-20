import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronRight, Code2, Fingerprint, FolderOpen, GitBranch, Layers3, LockKeyhole, Network, PanelTop, ShieldCheck, Terminal } from 'lucide-react'
void React

const connectionHref = '/settings?section=connection'
const assetBase = import.meta.env?.BASE_URL ?? '/'
const logoUrl = `${import.meta.env?.BASE_URL ?? '/'}opensaddle-mark-transparent.svg`
function BrandMark() { return <img className="wl-logo" src={logoUrl} width="32" height="32" alt=""/> }
const stages = [
  { label: 'Plan', title: 'A clear brief. A bounded scope.', description: 'Define the outcome, the workspace, and what the agent is allowed to change.', rows: [ ['Outcome', 'Add keyboard navigation'], ['Workspace', 'web / components'], ['Acceptance', 'Keyboard flow + regression tests'] ], note: 'You choose the goal and the boundaries.' },
  { label: 'Execute', title: 'The right tools for the task.', description: 'A coding agent works within the project while the runtime records its actions.', rows: [ ['Agent', 'Coding specialist'], ['Environment', 'Approved local worker'], ['Tools', 'Repository · test runner'] ], note: 'Execution stays tied to a project and an agent.' },
  { label: 'Review', title: 'Inspect the work before it moves on.', description: 'Review the patch and test evidence together. Decide what happens next.', rows: [ ['Artifact', 'Keyboard navigation patch'], ['Evidence', 'Test report + change summary'], ['Next step', 'Human review'] ], note: 'A completed run is a result to inspect.' },
]

function WorkspacePreview() {
  const [stage, setStage] = useState(0)
  const [decision, setDecision] = useState<'accepted'|'changes'|null>(null)
  const current = stages[stage]
  return <section className="wl-preview" aria-label="Interactive workflow preview">
    <div className="wl-preview-top"><span><BrandMark/> OpenSaddle</span><span className="wl-preview-label">Illustrative preview</span></div>
    <div className="wl-preview-body">
      <div className="wl-preview-rail" aria-hidden="true"><PanelTop/><Layers3/><GitBranch/><ShieldCheck/><div/><Terminal/></div>
      <div className="wl-preview-workspace">
        <div className="wl-preview-breadcrumb"><FolderOpen size={13}/> Website <ChevronRight size={12}/> New feature</div>
        <div className="wl-task-prompt"><span className="wl-prompt-icon"><Code2 size={18}/></span><div><small>THE OUTCOME</small><h3>Make the app work<br/>with a keyboard.</h3></div></div>
        <div className="wl-stage-switch" role="group" aria-label="Explore workflow stages">{stages.map((item, index) => <button key={item.label} type="button" aria-pressed={stage === index} onClick={() => setStage(index)}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</button>)}</div>
        <div className="wl-stage-detail" aria-live="polite"><span className="wl-stage-eyebrow">{current.label.toUpperCase()} / EXAMPLE</span><h4>{current.title}</h4><p>{current.description}</p><dl>{current.rows.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{label === 'Next step' && decision ? (decision === 'accepted' ? 'Example accepted' : 'Changes requested in preview') : value}</dd></div>)}</dl>{stage === 2 && <div className="wl-preview-decisions"><button type="button" aria-pressed={decision === 'accepted'} onClick={() => setDecision('accepted')}>Accept in preview</button><button type="button" aria-pressed={decision === 'changes'} onClick={() => setDecision('changes')}>Request changes in preview</button></div>}</div>
        <div className="wl-preview-foot"><ShieldCheck size={15}/><span>{stage === 2 && decision ? (decision === 'accepted' ? 'Example accepted. No workspace was changed.' : 'Example returned for changes. No request was sent.') : current.note}</span></div>
      </div>
    </div>
    <div className="wl-preview-caption"><span className="wl-static-dot"/>Explore the flow. No agents run in this preview.</div>
  </section>
}

function IntegrationMark({ name }: { name: string }) {
  return <img src={`${assetBase}brands/${name}.svg`} alt="" width="26" height="26" loading="lazy"/>
}

function IntegrationOverview() {
  return <section className="wl-integrations wl-container" aria-labelledby="wl-integrations-title">
    <div className="wl-integration-heading"><div><span className="wl-kicker">FAMILIAR TOOLS. A SHARED WORKSPACE.</span><h2 id="wl-integrations-title">Bring your way of working.</h2></div><p>Choose from the harnesses and tools your runtime makes available. Keep the context around the work.</p></div>
    <div className="wl-integration-row"><span className="wl-integration-category">Agent harnesses</span><ul>
      <li><IntegrationMark name="openai"/><span>Codex<small>Native adapter</small></span></li>
      <li><IntegrationMark name="claude"/><span>Claude Code<small>CLI adapter</small></span></li>
      <li><IntegrationMark name="cursor"/><span>Cursor<small>CLI bridge</small></span></li>
      <li><IntegrationMark name="googlegemini"/><span>Gemini CLI<small>Harness detection</small></span></li>
    </ul></div>
    <div className="wl-integration-row"><span className="wl-integration-category">Tools & infrastructure</span><ul>
      <li><IntegrationMark name="github"/><span>GitHub<small>Repository connector</small></span></li>
      <li><IntegrationMark name="modelcontextprotocol"/><span>MCP<small>Custom tool servers</small></span></li>
      <li><IntegrationMark name="docker"/><span>Docker<small>Bounded container worker</small></span></li>
      <li><IntegrationMark name="tailscale"/><span>Tailscale<small>Private gateway setup</small></span></li>
    </ul></div>
    <div className="wl-platforms"><span><PanelTop size={16}/> macOS desktop</span><span><IntegrationMark name="linux"/> Linux workers</span><span><PanelTop size={16}/> Windows · qualification pending</span></div>
    <p className="wl-integration-note">Availability depends on installation, authentication, and server capabilities. Provider marks identify integrations, not endorsements.</p>
  </section>
}

export function WorkspaceLanding() {
  return <div className="workspace-landing">
    <div className="wl-color-field" aria-hidden="true"><i/><i/><i/></div>
    <nav className="wl-nav wl-container" aria-label="OpenSaddle overview"><a className="wl-brand" href="#welcome"><span className="wl-brand-symbol"><BrandMark/></span>OpenSaddle<span className="wl-alpha">EARLY ACCESS</span></a><div className="wl-nav-links"><a href="#how-it-works">How it works</a><a href="#your-system">Your system</a><a href="https://github.com/AkeBoss-tech/opensaddle">GitHub ↗</a></div><Link className="wl-nav-connect" to={connectionHref}>Connect workspace <ArrowRight size={15}/></Link></nav>
    <section id="welcome" className="wl-hero wl-container" aria-labelledby="wl-title">
      <div className="wl-hero-copy"><div className="wl-kicker"><span/>THE OPERATING LAYER FOR AGENTS</div><h1 id="wl-title">Put agents<br/>to work.<br/><em>Keep control.</em></h1><p>Bring agents, tools, and project knowledge into one place. Give your work a system you can shape—and stay in control of how it runs.</p><div className="wl-hero-actions"><Link className="wl-button" to={connectionHref}>Connect workspace <ArrowRight size={17}/></Link><a className="wl-text-link" href="#workflow-preview">Explore the workflow <ChevronRight size={17}/></a></div><p className="wl-connection-note"><span/>Connect an existing server to get started.</p></div>
      <div id="workflow-preview" className="wl-hero-product"><div className="wl-product-overline"><span>A WORKSPACE THAT WORKS WITH YOU</span><span>01 — 03</span></div><WorkspacePreview/></div>
    </section>
    <div className="wl-foundation wl-container"><span>ONE WORKSPACE.<br/><strong>EVERY PART OF THE WORK.</strong></span><div><Code2/>Agents</div><div><Layers3/>Knowledge</div><div><Terminal/>Compute</div><div><Fingerprint/>Permissions</div></div>
    <IntegrationOverview/>
    <section id="how-it-works" className="wl-story wl-container" aria-labelledby="wl-story-title"><div className="wl-section-heading"><div><span className="wl-kicker">FROM INTENT TO EVIDENCE</span><h2 id="wl-story-title">Less coordination.<br/>More forward motion.</h2></div><p>Work shouldn’t disappear into a collection of chat windows. Keep the brief, execution, and result connected.</p></div><div className="wl-steps"><article><span className="wl-step-number">01</span><div className="wl-step-graphic"><div className="wl-brief-lines"><span/><span/><span/></div><span className="wl-mini-chip"><LockKeyhole size={12}/> Project scope</span></div><h3>Start with the outcome.</h3><p>Give the agent a goal and a project. Define what done means and which tools it can use.</p></article><article><span className="wl-step-number">02</span><div className="wl-step-graphic wl-node-graphic"><span><Code2/></span><i/><span className="wl-node-center"><BrandMark/></span><i/><span><Terminal/></span></div><h3>Bring the pieces together.</h3><p>Connect execution, context, and tools through a shared runtime, with permissions attached to the work.</p></article><article><span className="wl-step-number">03</span><div className="wl-step-graphic wl-evidence-graphic"><div><Check size={13}/> Change summary</div><div><Check size={13}/> Verification evidence</div><div><ShieldCheck size={13}/> Your review</div></div><h3>See what actually happened.</h3><p>Inspect the outputs and their evidence. Review a result, adjust the plan, or choose the next step.</p></article></div></section>
    <section id="your-system" className="wl-system" aria-labelledby="wl-system-title"><div className="wl-container wl-system-inner"><div><span className="wl-kicker">BUILT AROUND YOUR WORK</span><h2 id="wl-system-title">A common foundation.<br/>A system that’s yours.</h2><p>Make space for different agents, different projects, and different ways of working. Keep authority in the runtime as the workspace evolves.</p><Link className="wl-light-link" to={connectionHref}>Connect your system <ArrowRight size={17}/></Link></div><div className="wl-system-map" aria-label="OpenSaddle system layers"><div className="wl-map-top"><span><Code2 size={16}/> Agents</span><span><PanelTop size={16}/> Your interface</span><span><Layers3 size={16}/> Knowledge</span></div><div className="wl-map-stem"/><div className="wl-runtime-layer"><BrandMark/><div><strong>OpenSaddle runtime</strong><small>Identity · permissions · execution · audit</small></div><LockKeyhole size={19}/></div><div className="wl-map-stem"/><div className="wl-map-bottom"><span>Local machines</span><span>Tools & APIs</span><span>Project context</span></div><p className="wl-map-caption">Architecture overview · capabilities depend on your server</p></div></div></section>
    <section className="wl-details wl-container"><div className="wl-detail"><Network/><h3>Connect the tools you use.</h3><p>Bring available harnesses and connectors into the workspace. Extend the system around the tools your work needs.</p></div><div className="wl-detail"><ShieldCheck/><h3>Keep access intentional.</h3><p>Project boundaries, agent permissions, and review controls belong alongside the work—not in a separate spreadsheet.</p></div><div className="wl-detail"><PanelTop/><h3>Choose your perspective.</h3><p>Move between the task, its evidence, and the bigger picture. Build on a workspace designed to be customized.</p></div></section>
    <section className="wl-start wl-container" aria-labelledby="wl-start-title"><div><span className="wl-kicker">YOUR NEXT STEP</span><h2 id="wl-start-title">Give your agents<br/>a place to work.</h2><p>Already running OpenSaddle? Connect your server.<br/>Working locally? Start with the desktop runtime.</p><Link className="wl-button" to={connectionHref}>Connect workspace <ArrowRight size={17}/></Link></div><div className="wl-faq"><details><summary>What do I need to connect?</summary><p>An existing OpenSaddle server address and, where required, its access token. Open connection settings to enter them. This website does not start a server on your computer.</p></details><details><summary>Can I use my local machine?</summary><p>Yes. The desktop app provides a local runtime setup path. Browser access to a runtime also requires a reachable address and an origin allowed by that server.</p></details><details><summary>What about cloud accounts and teams?</summary><p>Cloud sign-in and remote machine enrollment are planned for this entry screen. Shared projects and available capabilities come from the server you connect to.</p></details></div></section>
    <footer className="wl-footer wl-container"><span className="wl-brand"><BrandMark/> OpenSaddle</span><span>A workspace for work worth doing.</span><a href="https://github.com/AkeBoss-tech/opensaddle">Explore the source <ArrowRight size={14}/></a></footer>
  </div>
}
