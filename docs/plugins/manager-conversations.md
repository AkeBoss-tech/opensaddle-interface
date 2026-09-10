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


## Completed child output

Where `manager_conversations_v1.child_results` is advertised, a completed native
child task exposes its published text through
`GET .../messages/{message_id}/dispatches/{project_id}/result`. Core resolves the
Run through the owner-private saved-message binding, checks current and historical
Project access, and calls the existing authorized artifact content reader. It
requires the exact completed Run, a native result artifact, at most 256 KiB of
strict UTF-8, and a matching SHA-256 digest. Access and Run identity are checked
again after the read. Coding-review results continue through their existing review
workflow.

Interface verifies the complete conversation/message/Project/Run binding and text
digest before displaying literal task output beneath the saved message. The shared
result panel refreshes authorization and clears failed or stale reads. This is a
linked task artifact marked `not_assessed`, not a stored assistant turn or a human
acceptance decision. Automatic manager reasoning and cross-Project context dispatch
remain separate work.

Validation: 49 Core manager/storage/API checks and eight focused Interface checks
pass; the renderer build passes. Both backend and mounted UI regression assertions
fail on their previous commits and pass with these changes. The API completion
fixture is seeded; real native manager dispatch-to-reply and browser acceptance
remain pending.


## Native manager round trip — 2026-09-10

The actual Interface `ManagerConversationsClient` created a private conversation,
saved a message and explicitly dispatched it to the disposable Mac mini worker.
The paired user-owned device had owner-authorized selected-member consent accepted
by the Project. The real Codex adapter ran `uname -s` and
`python3 -c "print(43 * 19)"`; its tool transcript records `Darwin` and `817`.

A recreated Interface client reopened the saved conversation, observed its bound
Run completed, and fetched the exact published result through the manager result
route. Client-verified artifact and native dispatch digests agree. An unrelated
owner was denied. No seeded completion or synthetic provider reply was used.
Core evidence is in `docs/testing/receipts/manager-native-result-20260910.json`.

This used a disposable loopback Core, reverse SSH and fixture requester identity.
It proves the native manager dispatch-to-result path, not production identity,
network deployment, browser rendering or automatic cross-Project manager reasoning.
Device assignment and enrollment were revoked afterward; the worker, fixture Core
and tunnel stopped. The remote workspace stayed clean. Browser verification was
retried but the Mac remained locked.


## Independent manager availability

Saved manager conversations require their own capability and the current Project
directory. They no longer require Command Center or context-preview support. A
dashboard load error, missing capability, or refresh leaves the manager mounted,
preserving its unsent draft and allowing normal authorized saves. Disconnecting
still unmounts private manager content; identity changes retain the existing
account fences. Context preview appears only when its separate client is present.

Thirteen mounted dashboard/manager checks and the renderer build pass. The new
regression test fails on the previous Interface commit and passes after separation.
This is component-level evidence; browser acceptance remains pending.
