# Manager Project context

The connected landing page now offers a Manager context panel when Core advertises
both current-membership Project discovery and explicit manager-context support.
The initial scope is empty; the user checks up to 32 Projects and chooses Preview
context. The host displays selected objectives, active tasks, outcomes, attention
items and explicit truncation notices. Context preview does not start tasks.

Changing selection clears the preview immediately. Replacing an account, client
or directory invalidates old responses. The Interface client verifies exact scope,
field names, row/text bounds and the response's lack of execution authority.
No raw policy, credentials or source locators are accepted into the preview.

The panel deliberately identifies manager conversation as not connected. It does
not simulate a reply, persist a manager thread or dispatch child tasks. Those
remain required next steps; the temporary scope selection is not a durable
conversation scope record.

Ten mounted/client/Command Center tests and the production build pass. The actual
Interface directory and manager-context clients also passed against a disposable
Core server over authenticated loopback HTTP: one selected Project, one explicitly
unverified fixture outcome, no execution authority, and rejection of a missing
Project. The receipt contains no token. This was not a browser check. Visual,
keyboard, real-user scope preview and manager conversation remain pending.
