# Agent research browser check — 2026-09-19

Environment: the existing Vite app at `http://127.0.0.1:5176/opensaddle-interface/`,
the disposable [`agent-setup-browser-fixture.py`](../../scripts/agent-setup-browser-fixture.py)
Core on loopback port 8767 with its explicit `--research-provider mediawiki`
option, and Chrome. The fixture used a synthetic Project, synthetic registered
Git source, local human identity, and toy GitHub metadata broker. Its public
research adapter was the real, keyless MediaWiki documentation search API. The
only external query submitted was `OAuth`; no private source, finance query,
credential, or personal data was sent to the provider.

Through the normal `/project/browser-fixture/agents` route, the page displayed
`MediaWiki documentation only`, the exact `www.mediawiki.org` domain, and the
warning that entered queries go to that external provider. The `OAuth` query
returned three search-index excerpts with exact HTTPS page links, checked
time, provider endpoint, and a visible “Cited page not opened” label. GitHub
appeared as installed read actions; Notion appeared as research-catalog-only
with no installed action or access. The results screenshot captures the source
presentation: [research results](../../out/screenshots/agent-research-20260919/results.jpg).

Clicking **Apply draft and citations** populated the agent name, objective,
conservative instructions, assumptions, and three separate references. The
connector permission selector remained at “No action selected” and no grant
was added. The review panel still said “No agent drafts have been saved for
this Project”; an authenticated Core GET of the fixture proposal collection
returned `items: []` after Apply. No proposal or publication action was
triggered. The saved [ideas and unpublished draft](../../out/screenshots/agent-research-20260919/ideas-and-unpublished-draft.jpg)
and [applied citations](../../out/screenshots/agent-research-20260919/applied-draft.jpg)
screenshots show these separate states. Browser error log was empty.

The first live attempt exposed a capability-negotiation bug: Interface required
`online_research_available === false` before constructing the agent profile
client, hiding the entire setup page when Core truthfully advertised research.
Changing that gate to accept the Boolean availability state restored the page.
The same public service-negotiation assertion failed under the previous gate
and passed after the correction. This browser pass proves the public MediaWiki
research and UI draft boundary on this local fixture, not Brave account access,
verification of the cited page bodies, connector permission admission, provider
execution, or publication. The disposable Core fixture was stopped afterward;
port 8767 was no longer listening. The preexisting Vite app was left running.
