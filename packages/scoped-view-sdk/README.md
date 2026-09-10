# Scoped view SDK

A local ESM helper for signed OpenSaddle user and Team views. Bundle `index.js`
into the renderer fragment before signing it. The package remains private and is
not published to a registry. TypeScript resolves declarations through the package
export; the declarations have no dependency on OpenSaddle application internals.

```ts
import {connectScopedView} from '@opensaddle/scoped-view-sdk'

let filter = ''
const view = connectScopedView({
  scope: 'user',
  onInit({state}) {
    // Validate restored state using the schema signed into your package.
    if (state && typeof state === 'object' && 'filter' in state &&
        typeof state.filter === 'string') filter = state.filter
  },
})

// Call after initialization, for example from a button's click handler.
async function showDevices() {
  const page = await view.readDevices()
  // These observations do not authorize task execution.
  for (const device of page.items) console.log(device.display_name)
}

function saveFilter(next: string) {
  filter = next
  view.saveState({filter}) // proposal, not a persistence acknowledgement
}
```

`scope: 'team'` exposes settings, JSON state proposals and disposal. Private owner
inventory/activity methods are only typed for `scope: 'user'`. Runtime capability
checks and host/Core authorization remain authoritative; types cannot grant
access. Declare the matching capabilities and settings contract in your signed
manifest. Activity reads require an ID previously delivered by the host.

`onInit` may return a promise; readiness follows its successful completion.
Do not await resource reads inside initialization. Only one resource request may
be outstanding, and requests reject on timeout or disposal. `dispose()` removes
the message listener and rejects pending reads. There is no task launch, token,
filesystem, or settings-write API.

Run `npm test` and `npm run test:types` from this package to check its wire
behavior and a consumer that imports the public package export. The type checks
include expected errors for Team device reads, unvalidated state, non-JSON state,
Project scope, credential access and task execution.
