# 00 — AI Start (read me first)

Read this ONE file to start working with VRack2: the mental model, your tools, the workflows, and the traps. Depth lives in [01](./01-basics.md)–[05](./05-cheatsheet.md); follow the links when you need detail.

## 1. What VRack2 is (30-second model)

VRack2 is an attempt to **systematize automation** by drawing boundaries between **sufficiently large units** so the system reads top-down. Not a flow tool: in Node-RED the wires are the program; here the logic lives **inside devices** and the graph is only the map of their connections — a service diagram is an architecture map, not a spaghetti of small nodes. A **device** is a coarse-grained boundary modeled on a real device (ports, state, controls, metrics) — deliberately not a function; splitting logic into tiny reusable pieces is the anti-pattern. The model is **microservices inside one service**: isolation (per-vendor dependencies), mobility (devices move between services unchanged), predictability (explicit boundaries, observable state) — and running many services is the same principle at the next scale. **VRack2 runs on itself**: the platform master is just another service — the model has no privileged layer, and that is the proof it holds.

- **Service** = a set of **devices** (components with logic) wired by **connections** through **ports**, described in a JSON file. No code is needed to run one — only the device libraries (vendors).
- **Three layers**: `vrack2-core` (framework) → `vrack2-service` (runner: `node run/index.js [service.json]`) → the **VRack2 platform** (itself a service, `devices/vrack2/`) that runs other services in workers and exposes the API. core + runner + platform are **one instrument**, not three separable products.
- **You (the AI) work against a live platform through the MCP tools** (below). You don't need the platform internals for 95% of tasks.
- **A service has three facets** — keep them separate:
  1. **Structure** (the graph) — `services/<id>.json` (devices + connections). Readable.
  2. **Behavior** (what each node does) — device code in its vendor `devices/<vendor>/<Device>.js`. Readable.
  3. **Live state** (what's happening now) — `shares` (live values) + metrics + per-device status. Via MCP.

## 2. Your interface — the MCP tools (3 generic tools)

The platform exposes **three universal MCP tools** instead of one tool per command — you discover the API at runtime:

| Tool | Gives you |
|---|---|
| `commands_list` | Compact table of all available commands: platform Master commands + `serviceCommandsList` / `serviceCommandInfo` (the submaster command list of a running service). Format `{count, captions: [name, description, level], rows}` |
| `command_info` {name} | Full card of one command: description, level, owner, parameters (name, type, required, description, example) and the return shape (object fields / array item, recursively) |
| `command_execute` {name, data?} | Execute any command by name + parameters. Commands with a `service` parameter (submaster commands) are routed automatically to the running service's worker. Validation + access level enforced by the platform Master |

### Submaster commands (inside a running service)

These are not listed by the top Master. Fetch their full cards (parameters + return) with:

`command_execute {name: "serviceCommandsList", data: {service}}`

→ compact table `{count, captions, rows: [name, description, level]}` (same format as `commands_list`) for that service's submaster API: `serviceStructure`, `serviceDeviceAction`, `serviceDevicePush`, `serviceDeviceShares`, `serviceShares`, `serviceDeviceOutputListen`, `deviceProcess`, `deviceStop`, `deviceStatus`, `serviceParentEvent`, … The full card of one command (parameters + return) — `command_execute {name: "serviceCommandInfo", data: {service, command}}`.

> Journal and metrics commands (`serviceLog`, `serviceLogSet`, `serviceLogStats`, `serviceLogClear`, `serviceDeviceMetric`) are **not** submaster commands — they are registered by the master's `Journal` device and answered by the main process for any service, running or not. `service="vrack2"` reads the master's own journal (its device events and metrics).

### Old tool names → commands (reference map)

| Old tool | Now |
|---|---|
| `vrack2_service_list` | `command_execute {name: "serviceUpdateList"}` |
| `vrack2_service_status` {service} | `command_execute {name: "service", data: {service}}` (meta: `serviceMeta`) |
| `vrack2_service_start` / `vrack2_service_stop` {service} | `command_execute {name: "serviceStart" / "serviceStop", data: {service}}` |
| `vrack2_service_errors` / `vrack2_service_errors_clear` {service} | `command_execute {name: "serviceErrors" / "serviceErrorsClear", data: {service}}` |
| `vrack2_service_log` / `_log_set` / `_log_stats` / `_log_clear` | `command_execute {name: "serviceLog" / "serviceLogSet" / "serviceLogStats" / "serviceLogClear", data: {service, …}}` |
| `vrack2_service_device_action` / `_push` / `_shares` / `_metric` | `command_execute {name: "serviceDeviceAction" / "serviceDevicePush" / "serviceDeviceShares" / "serviceDeviceMetric", data: {service, device, …}}` |
| `vrack2_device_process` / `vrack2_device_stop` / `vrack2_device_status` {service, device} | `command_execute {name: "deviceProcess" / "deviceStop" / "deviceStatus", data: {service, device}}` |
| `vrack2_device_vendors` / `vrack2_device_list` / `vrack2_device_info` | `command_execute {name: "vendorList" / "vendorDevices" / "vendorDeviceInfo", data: {…}}` |
| `vrack2_key_list` / `vrack2_key_add` / `vrack2_key_delete` | `command_execute {name: "apiKeyList" / "apiKeyAdd" / "apiKeyDelete", data: {…}}` |

Exact parameters per command — from its card (`command_info`, or `serviceCommandInfo {service, command}` for submaster commands).

> **Levels:** **1**=admin, **2**=operator, **3**=dispatcher, **1000**=guest; rule `client level ≤ command level` (lower number = more rights). Over MCP the `Mcp` device executes every command at level 1 (not from a client key). Detail — [04](./04-platform.md) § Command levels.

## 3. Diagnostic workflow (find "what's not working")

**#1 trap: "running + 0 errors" ≠ end-to-end healthy.** A device can be `started` yet non-functional (e.g. can't reach its target). Always descend to per-device status/shares before concluding "it works."

1. `command_execute {name: "serviceUpdateList"}` — is the service even `run: true`?
2. `command_execute {name: "service", data: {service}}` — errors count, paths, startedAt.
3. `command_execute {name: "serviceErrors", data: {service}}` — any crash/exit logs?
4. Read `services/<id>.json` — the graph: which devices, which connections (who → whom).
5. For each **key device** (especially the terminal/output one):
   - `command_execute {name: "deviceStatus", data: {service, device}}` → `state`, **`lastError`**, **`lastAlert`**, `alertCount`/`errorCount`.
   - `command_execute {name: "serviceDeviceShares", data: {service, device}}` → live values (is it actually producing?).
6. Trace the chain: is data flowing source → … → output? Where does it stop?

### Worked example — `argb-test`

Flow: `Sine1..8 (test.SineWave) → MatrixBars.param1..8 → MatrixBars.colors → OpenRGBProvider.zone2 → LED @ 192.168.88.35:6742`.

- Top level: `run: true`, `errors: 0`, all 10 devices `started` → looks healthy. ❌ (the trap)
- Descend to the output device `OpenRGBProvider`:
  - `device_status` → `lastError: "… ECONNREFUSED 192.168.88.35:6742"`, `errorCount: 164`, `alertCount: 16062`.
  - `shares` → `connected: false`, `device.zones: []`, `zone1/2: zoneId null, leds null`.
- Upstream `MatrixBars` `shares` → live `values: [76,94,19,89,43,63,98,0]` + a computed 8×8 `frame` → the compute side is fine.
- **Verdict:** "healthy" at the platform level, but the end-to-end flow is dead at the last hop — the OpenRGB server isn't reachable (`ECONNREFUSED`). Fix = that server up at 192.168.88.35:6742 (or the IP/port is wrong). Code + wiring are correct.

## 4. Authoring workflow (build a service)

1. **Devices** (if new): `devices/<vendor>/<Device>.js` (extend `Device`) + register in the vendor `list.json`. Full API — [03](./03-device.md).
2. **Service file**: `services/<id>.json` (devices + options + connections) + `services/<id>.meta.json` (autoStart/autoReload/isolated). Syntax + examples — [02](./02-service.md).
3. **Run it**: standalone `node run/index.js services/<id>.json`; or via the platform `command_execute {name: "serviceStart", data: {service}}`.
4. **Verify live**: per device `command_execute` with `deviceStatus` + `serviceDeviceShares`; `serviceLog` for events.

## 5. Event-flow model (how data moves)

```
input port → input<Port>() handler → [device logic] → output port.push(data)
   → connection "A.out -> B.in" → B's input port → B's input<Port>() …
```

- `standard` port: 1 output → N inputs, fire-and-forget. `return` port: 1→1, `const r = await push(data)` (you get the handler's reply). The two are **incompatible**.
- Device messages: `this.terminal/notify/event/alert/error(…)` — visible in Manager + journal, and as `device.*` Container events.
- Live data: set `this.shares.x = …` then `this.render()` (batched); read it back via `command_execute {name: "serviceDeviceShares", data: {service, device}}`.
- Trace: start at the source device's output, follow the connection string to the target input, read the target's `input<Port>` handler. Detail — [03](./03-device.md) § Ports, § Lifecycle.

## 6. Where to go deeper

| Need | Doc |
|---|---|
| 3-layer stack, glossary, repo structure | [01-basics](./01-basics.md) |
| Service files, meta/conf, lifecycle, real examples | [02-service](./02-service.md) |
| Full device API (ports, lifecycle, shares, metrics, actions, errors) | [03-device](./03-device.md) |
| Platform internals (ServiceManager, submaster, WS API, MCP, levels, events) | [04-platform](./04-platform.md) |
| Naming rules, quick API command table, common mistakes | [05-cheatsheet](./05-cheatsheet.md) |

> Source-of-truth: `devices/vrack2/docs/*` (map in [README](./README.md)). Core API ground truth: `node_modules/vrack2-core/lib/*.d.ts`.
