# 05 — Cheatsheet

## Naming

| What | Rule | ✅ | ❌ |
|---|---|---|---|
| Service file | lowercase Latin, `-` separator | `my-service.json` | `My.Service.json` |
| Device ID | CamelCase, short | `Interval1` | `interval_1` |
| Device type | `vendor.ClassName` | `basic.Interval` | `Basic.interval` |
| Vendor directory | lowercase Latin, `-` allowed | `my-devices` | `my devices` |
| Device file | CamelCase | `MyDevice.js` | `my-device.js` |
| Port | one lowercase word, no leading digits, 1 level of groups via `.` | `timers.gate1` | `gate-1`, `a.b.c` |
| Input handler | `input` + CamelCase of the port name | `inputControlStart` | `controlStart` |
| Action handler | `action` + CamelCase | `actionTestAction` | `testAction` |
| Metric | `[a-zA-Z0-9._*]`, short; `<id>` in the pattern is a placeholder, **replaced entirely** by the value | `memory.rss`, `boilers.42.temp` | `memory rss`, `boilers.{bid}.temp` (the braces are not part of the name) |

## Ports — in 10 seconds

`standard` = 1 output → N inputs, no return; `return` = 1 → 1, `const r = await out.push(data)`. **The types are incompatible** — you cannot connect a standard to a return. Details — [03-device](./03-device.md) § Ports.

## Device lifecycle — in one line

`onRegister()` (dynamic handlers, `addInputHandler`) → [ports + connections] → `onStart()` (sync start) → `onStartAsync()` (async, the container waits for ALL) → RUNNING (inputs/events).

## Task → action

| Task | How |
|---|---|
| Create a service | `services/<id>.json` + `services/<id>.meta.json`; devices — from the existing libraries |
| Start a service | API `serviceStart {service}` (level 1) or the VRack2 Manager |
| Check status | API `service {service}`; the `structure/<id>.json` files; Manager |
| Change options without touching the original | `services/<id>.conf.json` (in `.gitignore`) |
| Write a device | `devices/<vendor>/MyDevice.js` + an entry in `list.json`; skeleton — [03-device](./03-device.md) |
| Send data to an output | `this.ports.output['x'].push(data)` — only after checking `connected` |
| API call to a device | a `return` port: `const r = await this.ports.output['api'].push({command, data})` |
| Persist state | `this.storage.x = …; this.save()` (no more often than necessary — SSD) |
| Live data for the UI | `this.shares.x = …; this.render()` |
| Notify | `this.alert('text', data)` / `this.notify(…)` / `this.event(…)` |
| Report a critical error (terminate the service) | `this.terminate(err)` (emits `device.terminate`); without auto-reload — `ErrorManager.make('CONT_IGNORE_SERVICE_AUTORELOAD').add(err)` |
| Intercept another device's message | `this.Container.on('device.alert', fn)` (subscribe in `onStart()`) |
| Watch a service from another service | `meta.parentChannels` + subscribing to `Service.parent.event` |
| Run a service standalone (without the platform) | `npm start ./devices/<vendor>/<service>.json` |
| Invoke a device action | API `serviceDeviceAction {service, device, action, data}` (level 2) — the Master passes it to the worker via `submaster`; details — [04-platform](./04-platform.md) § submaster |
| Push data into a device input | API `serviceDevicePush {service, device, port, data}` (level 1) — lands in the input handler (`input<Port>`) |
| Read a device's shares (live state) | API `serviceDeviceShares {service, device}` (level 1) — returns the current `device.shares` object |
| Read a device's metric (time series) | API `serviceDeviceMetric {service, device, metric, period, precision, func}` (level 3) — unified journal (master-level, works for stopped services); `service` = container id: `<svc>` / `worker::<svc>` (service process) / `vrack2` (master); `{relevant, start, end, rows: [{time, value}]}` |
| Learn a service's actions/structure | `structure/<id>.json` or API `structureGet {id}` (level 3) |

## Common mistakes

Almost all of them are the ⚠️ notes and the "Rules that break startup/runtime" table in [03-device](./03-device.md): an input without a handler, a standard↔return connection, `push()` without `connected`, a device missing from `list.json`, long ids/ports, `this.save()` on every message, mutating `this.shares` without a following `render()`, an `onStartAsync()` that never resolves, dynamic ports without `addInputHandler`, unhandled exceptions (`uncaughtTerminate: true`).

The one thing not in 03: **subscribing to the Container outside `onStart()`/`onRegister()`/`onStartAsync()`** → the event may never arrive.

## Key events

| Source | Events |
|---|---|
| ServiceManager | `service.start` / `service.stop` / `service.convert` / `service.update` / `service.error` / `service.exit` |
| Device | `device.terminal` / `device.notify` / `device.event` / `device.alert` / `device.error` / `device.render` / `device.save` / `device.metric` / `device.terminate` |
| Clients | `Guard.client.register` / `.unregister` / `.autorize` / `.command` / `.command.error` / `.command.success`; `Broadcaster.channel.join` / `.leave` |
| Keys | `KeyManager.key.add` / `.update` / `.delete` |

The full container event list (startup, stop, hot, `device.status`) — [03-device](./03-device.md) § Container.

## Paths (this environment)

The repository tree — [01-basics](./01-basics.md) § "Structure of this repository"; the source-docs map — [README](./README.md) § "Deep documentation". WS API — `ws://<host>:4404/` (04-platform § WebSocket API).

## Key API commands

| Command | Level | Purpose |
|---|---|---|
| `commandsList` | 1000 | All registered commands + validation rules |
| `apiKeyAuth` / `apiPrivateAuth` | 1000 | Authorization (key; then AES-CBC) |
| `channelJoin` | 3 | Subscribe to a broadcast channel |
| `serviceList` | 3 | Service list |
| `service` / `serviceMeta` | 3 | Service info / metadata |
| `serviceStart` / `serviceStop` | 1 | Start / stop |
| `serviceCheck` | 1 | Check |
| `serviceErrors` / `serviceErrorsClear` | 1 | Errors / reset |
| `serviceDeviceAction` | 2 | Invoke a service device action (`{service, device, action, data}`); executed in the worker via `submaster` |
| `serviceDevicePush` | 1 | Push data into a service device's input port (`{service, device, port, data}`) |
| `serviceDeviceShares` | 1 | Read a service device's current shares (`{service, device}`) |
| `serviceDeviceMetric` | 3 | Read a metric time series from the unified journal (`{service, device, metric, period, precision, func}`; `service` = container id: `<svc>` / `worker::<svc>` / `vrack2`) |
| `structureGet` | 3 | Container structure (devices + actions with `requirements`) |

Level: **1** — admin, **2** — operator, **3** — dispatcher, **1000** — guest. Access: **`client level ≤ command level`** (lower number = more rights; `level: 1` — admin only, `level: 1000` — everyone).
Commands are dynamic: they depend on the devices in the schema (each service has its own set).

## vrack2-core — the exact API

Full tables (Rule/Port/Action/Metric/Device/ErrorManager/CoreError/Validator + the export list) — [03-device](./03-device.md): sections "Options and Rule", "Ports", "Base Device class API", "Metrics", "Actions", "Errors", "Exports of `require('vrack2-core')`". The ultimate source on any mismatch — `node_modules/vrack2-core/lib/*.d.ts`.

## Reading further

The deep-docs map (`devices/vrack2/docs/`) — in [README](./README.md) § "Deep documentation".
