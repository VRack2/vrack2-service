# 04 — Platform: how VRack2 works

## Starting the platform

VRack2 is a service (the schema `devices/vrack2/vrack2.json`), the default target of the runner `run/index.js` (what a runner is — [01-basics](./01-basics.md) § "What this is"): the runner takes a service file and starts it via `MainProcess` (core).

`npm start` → `run/index.js`:

```js
const { ImportManager, MainProcess, UniversalWorker } = require('vrack2-core');
const service = await ImportManager.importJSON('devices/vrack2/vrack2.json');
const MainProcessClass = await ImportManager.importClass('vrack2-core.MainProcess');
new MainProcessClass({ id: 'vrack2', service, confFile: 'devices/vrack2/vrack2.conf.json' }).run();
```

- `npm start ./path/to/service.json` — starts ANY service standalone (exactly what `ServiceManager` does for every service).
- `vrack2.conf.json` — an options override for the platform itself: the WS port, `servicesDirs`, `autoStart`, `autoReload`.

## Main process composition (devices/vrack2/vrack2.json)

| Device | Role |
|---|---|
| **WSProvider** | The API WebSocket server (port 4404 in this environment) |
| **ProvidersClients** | Provider/client multiplexing, request wrapping |
| **Guard** | Authorization: API keys, access levels, decryption (AES-CBC) |
| **Master** | The API command registry: data validation, levels, execution; unknown command → `submaster` |
| **Broadcaster** | Pub/Sub: broadcast channels for clients (`channelJoin`/`channelLeave`) |
| **KeyManager** | API key management. ⚠️ The device ID in the schema is `ApiKeyManager`, but events are named after the class: `KeyManager.key.*` |
| **WorkersManager** | Worker management: creation/stopping/queries |
| **ServiceManager** | Service lifecycle: directory watching, start/stop, events, API commands |
| **System** | System utilities (processes, CPU, etc.) |
| **DeviceInfo** | Device information (a separate process `device-info.json`) |
| **InterService** | Inter-service control (calling VRack2 commands from a service, e.g. `serviceStart`) |

API request chain:

```
client → WSProvider → ProvidersClients → Guard → Master → (submaster) ServiceManager → …
the reply returns the same way (return ports, await push)
```

> MCP clients go **straight to the Master** (bypassing `ProvidersClients`/`Guard`) — the path and authorization are described in § "MCP (HTTP) — a separate entry point" (below, inside "WebSocket API").

## ServiceManager

- Watches the service directories (`servicesDirs`): new/changed files → structure regeneration (`structure/`), `ServiceManager.service.*` events.
- `autoStart: true` (global) + `meta.autoStart: true` → the service starts together with VRack2. In this environment the global autoStart is **off**.
- `autoReload` (the global `ServiceManager` option) — the **enabling switch** for restarting crashed services. A service restarts only if **both** this global option **and** the service's own `meta.autoReload` are on; the exception — the "ignored" init errors (the `ignoreAutoReloadErrors` option); the restart timer is 5000 ms.
- Each service is started via `WorkersManager` (a worker), with the data: the service file path, meta, conf, processPath.

### ServiceManager commands (registered in Master)

| Command | Level | Data | Purpose |
|---|---|---|---|
| `serviceList` | 3 | — | Service list (id → config + meta) |
| `serviceUpdateList` | 3 | — | The same, with a refresh |
| `service` | 3 | `{service}` | Info: run, errors, paths, startedAt |
| `serviceMeta` | 3 | `{service}` | Metadata |
| `serviceStart` | 1 | `{service}` | Start |
| `serviceStop` | 1 | `{service}` | Stop |
| `serviceCheck` | 1 | `{service}` | Check |
| `serviceErrors` | 1 | `{service}` | The service's error list |
| `serviceErrorsClear` | 1 | `{service}` | Error reset |

### ServiceManager events (the main process's Container)

| Event | When |
|---|---|
| `ServiceManager.service.start` | A service starts |
| `ServiceManager.service.stop` | A service stops |
| `ServiceManager.service.convert` | Regeneration of the service's file/structure |
| `ServiceManager.service.update` | Any change of the service's data |
| `ServiceManager.service.error` | A service error |
| `ServiceManager.service.exit` | The service process exits |

Subscribing from another device of the main process:

```js
onStart() {
  this.Container.on('ServiceManager.service.stop', ({ service }) => {
    // service: { id, run, errors, filePath, metaPath, configPath, processPath, autoReload, startedAt }
  });
}
```

## How commands are executed inside a service (submaster)

A service runs in its own worker (`UniversalWorker`: a `worker_thread` of the main process by default, a separate `fork` process when `meta.isolated: true` — [02-service](./02-service.md) § `meta.json`). The service's commands (`service*`, e.g. `serviceDeviceAction`) are **not registered** in the main process's Master — they live in the service's worker. To invoke them, the `submaster` mechanism is used.

### Worker composition

The worker schema — the template `devices/vrack2/process.json` (can be replaced via `conf.processPath`):

```json
{
    "devices": [
        {
            "id": "Master",
            "type": "vrack2.Master",
            "options": { "registerPorts": 4, "commandPorts": 4 },
            "connections": []
        },
        {
            "id": "WorkerProvider",
            "type": "vrack2.WorkerProvider",
            "options": { },
            "connections": [ "WorkerProvider.command -> Master.command1" ]
        },
        {
            "id": "Service",
            "type": "vrack2.Service",
            "options": { },
            "connections": [
                "Service.send -> WorkerProvider.send",
                "Service.master.command -> Master.command2",
                "Service.register.command -> Master.register1",
                "Service.broadcast -> WorkerProvider.broadcast"
            ]
        }
    ]
}
```

- **`WorkerProvider`** — the transport to the main process: receives requests, returns responses.
- **`Service`** — the service's "engine": starts the user service in a **nested `ServiceContainer`** (its id = the service id; that's where your devices live) and **registers the `service*` commands in its own worker's Master** (the connection `Service.register.command -> Master.register1`).

So the worker has its **own** Master with its own command registry — parallel to the main process's Master. Worker-level commands (e.g. `serviceDeviceAction`) are visible from outside only via the submaster.

### Routing: Master → submaster → ServiceManager → worker

The `Master.inputCommand` logic (`devices/vrack2/src/Master.ts`):

1. The command **is** in the registry → level check (`data.level > command.level` → `MASTER_ACCESS_DENIED`; 1 — highest, admin), `data` validated against `rules`, the handler is called.
2. The command **is not** in the registry → if the `submaster` output port is connected, the request is passed to it **as-is** (in the main process, `ServiceManager` sits on `submaster`).
3. `submaster` is not connected → `MASTER_COMMAND_NOT_FOUND`.

`ServiceManager.inputSubmaster` (`devices/vrack2/src/ServiceManager.ts`):

1. `data` must contain the **`service`** parameter (otherwise `SM_SUMBASTER_COMMAND_NOT_FOUND`);
2. the service must be in the registry (`SM_SERVICE_NOT_FOUND`) and **running** (`SM_SERVICE_NOT_RUN`);
3. the request is forwarded to the worker via the `worker.request` port.

In the worker: `WorkerProvider` → its Master → the same algorithm (registry → level → rules → handler).

The reply returns the other way (return ports, `await push`).

### Example: invoking a device action (`serviceDeviceAction`)

The command is registered by the `Service` device (`devices/vrack2/src/Service.ts`):

| Field | Value |
|---|---|
| Level | `2` |
| Rules | `service` (string, the service id), `device` (string, the device id), `action` (string, dot-style, e.g. `set.address`), `data` (**object**, required; `{}` if there are no parameters) |

Execution — `Container.deviceAction` (vrack2-core):

1. The device exists (`CONT_DEVICE_NF`).
2. The device is running (`CONT_DEVICE_STOPPED` if it was stopped).
3. The action is declared by the device (`CONT_DEVICE_ACTION_NF`).
4. The handler name — `camelize('action.' + action)`: `set.address` → `actionSetAddress`; the handler must exist (`CONT_DEVICE_ACTION_HANDLER_NF`).
5. `data` is validated against the action's `requirements` (otherwise `VR_NOT_PASS`).
6. The device's `onBeforeAction(action, data)` hook runs — returning `false` vetoes the action (`CONT_DEVICE_ACTION_VETOED`).
7. `return await device.actionSetAddress(data)` — the action's return value becomes the response.

Request (WS API):

```json
{
  "command": "serviceDeviceAction",
  "_pkgIndex": 1,
  "data": {
    "service": "music-player",
    "device": "MusicPlayer",
    "action": "set.volume",
    "data": { "volume": 50 }
  }
}
```

### Sibling command: `serviceDevicePush` (push into an input port)

| Field | Value |
|---|---|
| Level | `1` |
| Rules | `service` (string), `device` (string), `port` (string, an input port), `data` (**any** JSON value; may be `null`) |
Execution: checks the device exists (`CONT_DEVICE_NF`) and its input port

(`CONT_DEVICE_PORT_NF`), then `device.ports.input[port].push(data)` — the
device's input handler (`input<Port>`) is called with that data.
Unlike an action — there is no `requirements` validation and no return value (fire-and-forget).

### Sibling command: `serviceDeviceShares` (read a device's shares)

| Field | Value |
|---|---|
| Level | `1` |
| Rules | `service` (string), `device` (string) |
| Return | the object — the current `device.shares` |

Execution: checks the device exists (`CONT_DEVICE_NF`), then
`return device.shares` — returns the device's current live state
as-is, without rendering or a queue (unlike `serviceShares`, which
queues all the service's data for rendering).

### Metrics: `serviceDeviceMetric` (the single metrics read API)

NOT a submaster command — it is registered by the master's `Journal` device and answered by the main process, whether or not the service is running. All metrics of every container live in one unified journal (`journals/vrack2`, table `service_metric`, vrack2-journal-db): the worker forwards its containers' `device.metric` events to the master, and the master journals its own container too.

| Field | Value |
|---|---|
| Level | `3` |
| Rules | `service` (string, **a container id**: `<service-id>` — the service container's devices, `worker::<service-id>` — the service process itself (`Service` device metrics, e.g. `memory.rss`), `vrack2` — the master process), `device` (string, the device id), `metric` (string, the metric name, e.g. `brightness`), `period` (string, e.g. `now-1h:now`), `precision` (string or a number, e.g. `1m`), `func` (string, `last`/`first`/`min`/`max`/`avg`/`sum`, default `last`) |
| Return | `{relevant, start, end, rows: [{time, value}]}` — a time series; `relevant: false` — no data for the metric in the given period |

Execution: `Journal.readMetric(service, device, metric, period, precision, func)` — scans the `service_metric` table (Graphite-style retention tiers, rollups per bucket). There is no separate `serviceMetric` / `systemMetric` command — the container id in `service` is the namespace.

### How to find out which actions a service has

- `structure/<serviceId>.json` — the `ServiceContainer` structure: per device `actions` with `requirements` / `returns` / `description` (regenerated on container load).
- The `structureGet {id: <containerId>}` command (level 3).

## WebSocket API

- Address: `ws://<host>:4404/` (in this environment; the standard is 4044).
- Message format:

```json
{ "command": "serviceList", "_pkgIndex": 1004, "data": {} }
```

`_pkgIndex` — your request identifier; the reply comes back with the same index.

- **The API is dynamic**: the command set depends on the devices in the schema. `commandsList` (level 1000) returns all commands with their description, `rules` (input data validation), and `return` (response rule).

### Authorization

Access levels: **1** — admin, **2** — operator, **3** — dispatcher, **1000** — guest.

> **Access rule** (`Master.ts`, `MASTER_ACCESS_DENIED`): a command runs only if **the client's level ≤ the command's level**. Lower number = more rights. So: a command with `level: 1` — admin only; `level: 2` — admin+operator; `level: 3` — all authenticated; `level: 1000` — anyone, including guests.

1. `apiKeyAuth {key}` → reply `{cipher, verify?, level, authorize}`.
   - If `verify` is present — private authentication is needed (step 2).
2. `apiPrivateAuth {verify: <AES(privateKey, verify)>}` → `authorize: true`; **further traffic is encrypted**.

Encryption (implemented in `Guard.ts`, `cipherData`/`decipherData`): **AES-256-CBC**, key — the private key, IV — the API key, data on the wire — **base64**. For clients, the **vrack2-remote** library is recommended (official, handles auth/encryption) — don't implement encryption by hand.

> ⚠️ A static IV (the same API key for the whole session) and a key-as-string are insecure practices in CBC. This is the platform's implementation, not a recommended scheme: don't copy it in new projects — use standard AEAD constructions (AES-GCM / ChaCha20-Poly1305) with unique IVs.

### MCP (HTTP) — a separate entry point

The platform also includes an **`Mcp`** device (`vrack2.json`: connection `Mcp.command -> Master.command3`): an HTTP endpoint `/mcp` (default port **4405**), the MCP protocol (streamable HTTP, stateless mode). It exposes **3 generic tools** — `commands_list` (catalog of commands), `command_info {name}` (parameter/return card), `command_execute {name, data}` (direct execution of any command; submaster commands with a `service` parameter are routed to the running service's worker). Submaster command catalog for a service: `command_execute {name: "serviceCommandsList", data: {service}}` (compact table `[name, description, level]`); the full card of one command — `serviceCommandInfo {service, command}`. Detail — `devices/vrack2-mcp/README.md`.

- The path **bypasses `ProvidersClients`/`Guard`** — API keys and WS AES encryption do not apply here.
- Level checks are **not bypassed**: the Master requires `data.level ≤ command.level` on every command port (the same `MASTER_ACCESS_DENIED` as over WS); on the MCP path the `Mcp` device sets level **1** (admin) for every command (not the client's key).
- Protection from external clients: an optional Bearer token (the `Mcp.token` option, **disabled by default**) + the network reachability of port 4405.

### Command levels

The level is set by the device that registers the command: e.g. `ServiceManager` gives **3** to read commands (`serviceList`, `service`, `serviceMeta`) and **1** to control commands (`serviceStart`, `serviceStop`, `serviceCheck`, `serviceErrors`, `serviceErrorsClear`). The access rule is the same as above (client level ≤ command level); the actual levels of all commands are always visible in the `commandsList` reply.

Channels and subscription:

- `channelJoin {channel: "services.<id>.devices.<DeviceID>.<channel>"}` — subscribe to a broadcast.
- Service statuses: `manager.service.<service-id>.update` (run/errors/paths/startedAt).

## Broadcast (Pub/Sub)

- Device channels: `services.{service-id}.devices.{DeviceID}.{channel}`, where channel is `render`, `terminal`, `notify`, `event`, `alert`, `error`, etc. (depends on the device).
- Format of an incoming broadcast message:

```json
{
  "command": "broadcast",
  "channel": "services.unimax.devices.WSH1.render",
  "data": { "…": "…" },
  "target": "services.unimax",
  "providerId": 1,
  "clientId": 3
}
```

- If nobody is subscribed to a channel — nobody receives the message. The VRack2 Manager is the simplest "client" for checking.

## System events for your services

It is more convenient to handle top-level events not from the outside, but by "passing them through" into your own service:

1. In the service's `meta.json`, specify the channels you are interested in:

```json
{ "parentChannels": ["ServiceManager.service.update"] }
```

2. After startup, the ServiceManager passes the events of these channels into your service.
3. Inside the service, subscribe (preferably in `onStart()`):

```js
onStart() {
  this.Container.addListener('Service.parent.event', ({ channel, data }) => {
    // channel: 'ServiceManager.service.update'
    // data:    { service: { id, run, errors, filePath, … } }
  });
}
```

ℹ️ The `ServiceManager.service.{start,stop,convert,update,error,exit}` events and the `parentChannels`/`Service.parent.event` mechanism have been verified against the code (02.10.2026). The full list and examples — in `devices/vrack2/docs/SystemEvents.md` (the file exists in this repository).

Other system events (the main process's Container):

| Source | Events |
|---|---|
| Broadcaster | `channel.join` / `channel.leave` |
| Guard | `client.register` / `client.unregister` / `client.autorize` / `client.command` / `client.command.error` / `client.command.success` |

> ℹ️ `client.autorize` — the platform emits the event **exactly like this** (a typo in the Guard code). The event `client.authorize` does not exist.
| KeyManager | `key.add` / `key.update` / `key.delete` |

## VRack2 Manager (web UI)

An optional tool (VRack2 works without it). What it's for:

- **service schema** (graph) — generated from the running service, always up to date;
- **device documentation** — ports, options, rules (Rule), metrics;
- sending data to inputs, invoking actions;
- **channel subscription** (terminal/render/event/…) in real time;
- API console: the command list, rules, invocation;
- viewing metrics (the unified journal).
