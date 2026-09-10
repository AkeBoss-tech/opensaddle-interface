# Saved manager conversations

When Core advertises owner-private manager conversations, user messages and scope
edits, the landing-page manager offers saved conversations. Select Projects above,
create a conversation, reopen it, save a message, or explicitly apply the selection
to future messages. Checkbox changes alone do not modify an existing conversation.
The UI displays each message's saved scope and states that no agent is connected.

The client reuses stable request UUIDs for uncertain creation/message saves. Intent
keys are hashed and isolated by server/user/operation; session storage contains
request IDs rather than message text. It clears an intent only after a validated
success receipt. Reloading a newer conversation version does not change a pending
message's identity. If session intent persistence fails, it does not submit.

Draft text is kept in memory while switching saved conversations and while writes
fail. It is cleared on account/connection reset; draft persistence after page or
scope-panel reload is not implemented. Conversation switching is disabled during
a pending message/scope write. Open history is rechecked every five seconds while
mounted, with overlapping reads suppressed. Unavailable history is removed and
must be reauthorized; server history errors do not become an empty successful
conversation. History is capped at 1,000 messages and lists at 1,000 conversations.

Mounted tests cover failed-draft retention, explicit scope changes and account
reset. Client tests cover account changes during intent creation and repeated
pagination cursors. The actual client also passed against disposable authenticated
Core HTTP: post-commit response loss, client recreation and duplicate-free retry;
old/new scope revisions; other-owner denial. The production build passed.

Browser/keyboard verification could not run because the Mac was locked. This is
saved user conversation functionality, not provider execution: assistant turns,
streaming, independently admitted child tasks and real manager acceptance remain
unfinished. The temporary context preview remains separate from saved conversation
scope until the user applies it explicitly.

## Explicit child tasks

Where Core advertises `child_tasks`, each saved message has a Run as a project task
disclosure. The user chooses the target Project, registered source and ready native
agent. Submission references the saved message; it sends no other messages or
multi-Project preview. Ordinary Core task admission and device policy apply.
The UI displays each child Run's status and links to its Project task page, polling
while the disclosure is open. Changing source/adapter for an already reserved
message/Project conflicts; use a new message for a different task intent.

The controls block duplicate submissions, retain uncertain selections for retry,
and stop showing task status when access reads fail. Saved-message scope must
match the current conversation before a new dispatch. Older messages can still
show authorized existing children. Saving alone starts no work; automatic manager
replies remain unavailable. Seven mounted/client checks, a renderer build and a
real Core HTTP response-loss/retry check pass. The disposable admitted task was
cancelled and fixture stopped. Browser/native manager acceptance remains pending.
