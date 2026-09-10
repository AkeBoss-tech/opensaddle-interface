# Personal and Team Perspectives

Scoped views use `opensaddle.application.v1` framing and
`opensaddle.scoped-view.v1` initialization metadata. The host sends the selected
scope and declared supported capabilities. There is no synthetic Project model.
Signed `ui_contract.scope` must match the mount, with `mount_kind: perspective`
and host API range containing version 1. Unknown required capabilities reject
mounting. State, ready, failure and ping/pong use the existing fenced envelope.

## Owner device reads

A personal view can declare `owner.devices.read` in the signed UI contract's
`required_capabilities`. To inspect activity also declare
`owner.device-activity.read`; it requires inventory capability. These capabilities
are unavailable to Team views. Neither allows device registration, pairing,
sharing, worker configuration or task dispatch.

After receiving init, keep its protocol/nonce/generation/instance_id/
connection_key/package_ref as the envelope. Reply `kind: ready`. Requests use:

```js
parent.postMessage({...envelope, kind: 'request', action: 'read_devices',
  request_id: 'devices-1', after: ''}, '*');
```

A successful response has `kind: resources`, the matching `request_id`,
`resource: owner_devices` and `value`:

```json
{"schema_version":"opensaddle.owner-device-page.v1","task_authority":"not_evaluated",
 "items":[{"device_id":"device_example","display_name":"My laptop",
 "platform":"macos","pairing_state":"paired","connection_state":"unknown"}],
 "next_cursor":null}
```

Pages contain at most 50 devices. Use the returned cursor explicitly; cursors
must be strings of at most 512 characters. Do not infer that `unknown` means
online or that pairing means task eligibility.

On explicit device selection, request activity for an ID already returned to
this frame's inventory (the host retains at most 200 delivered IDs):

```js
parent.postMessage({...envelope, kind: 'request', action: 'read_device_activity',
  request_id: 'activity-1', device_id: selectedDeviceId}, '*');
```

The resource is `owner_device_activity`. Its value includes `device_id`,
`generated_at`, `readiness`, `active_runs`, `task_authority: not_evaluated` and
`process_termination: not_observed`. Readiness and run observations retain the
personal-device service's current Project-membership filtering. They contain no
credentials, source paths or prompts. An empty observation is not evidence that
all physical processes stopped.

Only one resource read may be outstanding per frame. Request IDs must match
`[-A-Za-z0-9_]{1,100}`. Unsupported/malformed requests are ignored; permitted
requests that fail return `kind: resource_error` with `error: unavailable`.
Clients should bound their own waits. Accept responses only from the parent and
matching envelope/request ID. Credentials never enter the frame. Core host
session authority is checked around resource reads; account changes or revocation
prevent delivery. Resource contents confer no new authority.

## Current limits

Team/global summaries, richer settings delivery and a packaged plug-in helper
remain separate work. The current owner device wire contract is verified with
production host/client code, signed packages and real Core; its iframe messaging
has component evidence and still needs a resource-specific browser walkthrough.
