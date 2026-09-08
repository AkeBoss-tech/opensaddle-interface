import { RemoteJourneyClient } from '../../../../src/services/remoteJourney'

const [baseUrl, projectId, phase, runId] = process.argv.slice(2)
const token = process.env.OPENSADDLE_PROBE_TOKEN
const subject = process.env.OPENSADDLE_PROBE_SUBJECT
if (!baseUrl || !projectId || !phase || !token || !subject) throw Error('probe arguments are required')
const client = new RemoteJourneyClient(baseUrl, () => subject, token, false, false, true)

if (phase === 'create') {
  const snapshot = await client.snapshot(projectId)
  if (snapshot.sources?.length !== 1 || snapshot.authorizedContextSources?.length !== 3) throw Error('expected distinct runtime and Knowledge sources')
  if (snapshot.authorizedContextSources.some(item => snapshot.sources!.some(source => source.sourceId === item.sourceId))) throw Error('source namespaces overlap')
  const created = await client.delegate(projectId, snapshot.sources[0].sourceId, 'same packet through production RemoteJourneyClient', undefined, snapshot.authorizedContextSources.map(item => item.sourceId)) as Record<string, unknown>
  process.stdout.write(JSON.stringify({ runId: created.run_id, runtimeSourceId: snapshot.sources[0].sourceId, knowledgeSourceIds: snapshot.authorizedContextSources.map(item => item.sourceId) }) + '\n')
} else if (phase === 'verify') {
  if (!runId) throw Error('run ID required')
  const snapshot = await client.snapshot(projectId)
  const result = snapshot.results?.find(item => item.runId === runId)
  if (!result?.authorizedContext) throw Error('admitted packet handle absent')
  const packet = await client.authorizedContextPacket(projectId, runId, result.authorizedContext)
  const artifact = await client.review(projectId, runId)
  if (artifact.text !== 'protected cli echo') throw Error('protected artifact mismatch')
  process.stdout.write(JSON.stringify({ packetDigest: packet.packetDigest, requestDigest: packet.requestDigest, artifactId: artifact.resource.artifact_id, artifactDigest: artifact.resource.digest, text: artifact.text }) + '\n')
} else if (phase === 'revoked') {
  if (!runId) throw Error('run ID required')
  const snapshot = await client.snapshot(projectId)
  const result = snapshot.results?.find(item => item.runId === runId)
  if (!result?.authorizedContext) throw Error('admitted packet handle absent')
  let packetDenied = false
  let artifactDenied = false
  try { await client.authorizedContextPacket(projectId, runId, result.authorizedContext) } catch { packetDenied = true }
  try { await client.review(projectId, runId) } catch { artifactDenied = true }
  if (!packetDenied || !artifactDenied) throw Error('revoked protected content remained readable')
  process.stdout.write(JSON.stringify({ packetDenied, artifactDenied }) + '\n')
} else throw Error('unknown phase')
