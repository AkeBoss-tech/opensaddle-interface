# Project capacity actual HTTP receipt (Core 8878)

Date: 2026-09-07

## Boundary

This receipt covers the production `RemoteJourneyClient` capacity transport against a disposable, loopback Core fixture backed by PostgreSQL. The fixture contained no production data. A narrow fetch adapter translated the Interface caller header into the fixture's trusted-proxy subject and role headers; response parsing, Project paths, request bodies, authorization outcomes, and state transitions used the production Interface transport.

This is API integration evidence. Visible Electron evidence remains pending because macOS was locked; no lock bypass was attempted.

## Fixture

- Core URL: `http://127.0.0.1:8878`
- Project: `interface-capacity`
- Renewable held Run: `run_e347e532b4e3475ba06837a6911dc4b4`
- Configured Project allocation: 2,000 mCPU, 1,024 MiB, concurrency 2
- Held reservation: 1,000 mCPU, 512 MiB, concurrency 1
- Worker allocation source: worker self-report; hardware was not attested

The real Core `OutboundWorkerClient` renewed the lease every five seconds and refreshed its self-reported resource snapshot at the half-TTL interval (60 seconds for a 120-second TTL).

## Journey and observed receipt

1. Owner and member GET returned the same configured limits, usage, and one active reservation.
2. Member PUT was denied by Core.
3. Owner reduced limits to 500 mCPU, 256 MiB, concurrency 1.
4. GET returned `state=overcommitted`, `admission_state=blocked`, zero available capacity, and the same active reservation. Existing work retained its reservation.
5. Owner restored limits to 2,000 mCPU, 1,024 MiB, concurrency 2. GET returned `state=configured`, `admission_state=idle`, with the reservation still active.
6. Owner cancelled the held Run. The renewable worker observed cancellation and released the reservation. GET returned zero usage, zero active reservations, and one recent release.

```json
{"actualHttp":true,"project":"interface-capacity","runId":"run_e347e532b4e3475ba06837a6911dc4b4","before":{"state":"configured","admission":"idle","usage":{"cpuMillicores":1000,"memoryMiB":512,"concurrency":1},"reservations":1},"memberRead":{"limits":{"cpuMillicores":2000,"memoryMiB":1024,"maxConcurrency":2},"reservations":1},"memberConfigureDenied":true,"reduced":{"state":"overcommitted","admission":"blocked","usage":{"cpuMillicores":1000,"memoryMiB":512,"concurrency":1},"available":{"cpuMillicores":0,"memoryMiB":0,"concurrency":0},"reservations":1,"projectExcess":{"cpuMillicores":500,"memoryMiB":256,"concurrency":0}},"restored":{"state":"configured","admission":"idle","usage":{"cpuMillicores":1000,"memoryMiB":512,"concurrency":1},"reservations":1},"released":{"state":"configured","admission":"idle","usage":{"cpuMillicores":0,"memoryMiB":0,"concurrency":0},"reservations":0,"recentReleases":1}}
```

## Verification command

The disposable probe was executed from the Interface checkout with:

```sh
npm exec -- tsx docs/agents/evidence/fixtures/project-capacity-core-http-probe.ts
```

The evidence probe instantiates `RemoteJourneyClient` and exercises the actual Core HTTP endpoints. It requires a disposable Core fixture seeded with the synthetic Project, owner, member, worker, and renewable held Run documented above; the fixture URL and Run ID can be overridden with `OPENSADDLE_CAPACITY_FIXTURE_URL` and `OPENSADDLE_CAPACITY_FIXTURE_RUN_ID`. It asserts each transition, restores the original limits before cancellation, and emits the receipt above.
