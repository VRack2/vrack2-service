# AGENTS.md — VRack2-Service

Conceptual map of the repo. Deep detail lives in [`ai-doc-en/`](./ai-doc-en/README.md) — follow the links instead of reading source blindly.

## What this repository is

`vrack2-service` is **not an application with a `src/`**. It is a **runner + workspace** for services built on `vrack2-core`:

```
vrack2-core (npm framework) → vrack2-service (this repo: run/index.js + workspace) → VRack2 platform (itself just a service: devices/vrack2/)
```

- `npm start` runs the **VRack2 platform** (`devices/vrack2/vrack2.json`): WS API on **4404**, optional MCP bridge on **4405**.
- `npm start ./path/to/service.json` runs any service **standalone** (without the platform).
- The same `run/index.js` runs as a child worker — that's how the platform launches every managed service in its own thread/process.
- The platform is **not a privileged layer** — the same model (devices + connections) running on itself.

## The mental model

1. **Service** = **devices** (coarse-grained components with logic) wired by **connections** through **ports**, declared in a JSON file. Running needs no code — only device libraries.
2. **Logic lives inside devices**, not in the graph — splitting logic into tiny nodes is the anti-pattern.
3. **Three facets of a service — never confuse them**: **structure** (`services/<id>.json`) and **behavior** (`devices/<vendor>/<Device>.js`) are readable on disk; **live state** (shares/metrics/status) is **only via the running platform's API** (see below).

## Repo layout

```
run/index.js        # entry: MainProcess from a service file (default: devices/vrack2/vrack2.json)
devices/<vendor>/   # device libraries ("vendors"); devices/vrack2/ = the platform itself
services/           # user services: <id>.json + <id>.meta.json (+ optional <id>.conf.json overrides)
structure/          # auto-generated service graphs (read these to understand a service fast)
storage/            # persistent device state (this.storage + this.save())
data/, journals/    # service-local sqlite/db artifacts, unified metrics journal
keys.json           # platform API keys — NEVER commit, NEVER print in logs/output
node_modules/vrack2-core/lib/*.d.ts   # GROUND TRUTH of the core API on any mismatch with docs
```

`devices/ services/ structure/ storage/ journals/ keys.json` are **gitignored** — live work, not repo-tracked code; git history explains nothing here.

## The API (live platform)

No REST: the API is **commands registered by devices into `Master`**; the set depends on the running schema — **discover at runtime, never memorize**. Discovery + protocol/auth + access levels: [`ai-doc-en/00-ai-start.md`](./ai-doc-en/00-ai-start.md) §2, `devices/vrack2/docs/Api.md`, [`ai-doc-en/04-platform.md`](./ai-doc-en/04-platform.md).

**MCP is one optional bridge** — look for device `vrack2-mcp.Mcp` in the schema `devices/vrack2/vrack2.conf.json` (endpoint: `kilo.json` → `mcp.vrack2`). No `Mcp` in schema / platform down / standalone run → no MCP: use the WS API directly, or files (`structure/`, `storage/`) + service logs.

### Diagnose ("something doesn't work")

**Trap: `running` + `0 errors` ≠ healthy.** Descend, in order: service running? → errors/crashes? → read the graph (`services/<id>.json` or `structure/<id>.json`) → per key device (especially output ones): status → **last error**, alert count; shares → is data flowing? → trace source→output and find the hop where data stops.

### Author ("write me a device X and a service for it")

| What you need | Where |
|---|---|
| Device skeleton + full API | [`ai-doc-en/03-device.md`](./ai-doc-en/03-device.md) |
| Exact signatures on any mismatch | `node_modules/vrack2-core/lib/*.d.ts` (ground truth) |
| Small real device to copy | `devices/test/SineWave.js`, `devices/my-vendor/Counter.js` |
| Vendor shape | directory + `list.json` (array of class names, no `.js`); own `package.json` per vendor |
| Service + meta syntax | [`ai-doc-en/02-service.md`](./ai-doc-en/02-service.md); examples in `services/*.json` |
| Prose docs | `devices/vrack2/docs/FirstService.md`, `ServiceFile.md`, `Devices.md`, `Service.md` |

Steps: `devices/<vendor>/<Device>.js` + entry in vendor `list.json` (no entry = invisible) → `services/<id>.json` + `<id>.meta.json` (`autoStart`/`autoReload`/`isolated`) → run (`node run/index.js services/<id>.json` standalone, or the platform's service-start command) → verify live (per-device status, shares, log).

## Where to read deeper

| Need | Doc |
|---|---|
| Start now: tools, workflows, traps | [`00-ai-start`](./ai-doc-en/00-ai-start.md) |
| Concepts, glossary, design principles | [`01-basics`](./ai-doc-en/01-basics.md) |
| Service files, meta/conf | [`02-service`](./ai-doc-en/02-service.md) |
| **Device API**: data flow, ports, lifecycle, shares, metrics, actions, errors | [`03-device`](./ai-doc-en/03-device.md) |
| Platform: ServiceManager, workers, submaster, WS, access levels | [`04-platform`](./ai-doc-en/04-platform.md) |
| Naming rules, task→action table, common mistakes | [`05-cheatsheet`](./ai-doc-en/05-cheatsheet.md) |
| Source of truth | `devices/vrack2/docs/*.md`; core API — `node_modules/vrack2-core/lib/*.d.ts` |
