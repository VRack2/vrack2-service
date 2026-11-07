# 01 — Basics

## What this is

VRack2 is a self-hosted platform for event-driven automation services in JS/TypeScript. Typical tasks: local automation, an alternative to SCADA, abstractions over "hardware" (I²C, Serial, Modbus), 24/7 hardware testing, remote data access and control.

## How VRack2 is built: what each component does

The stack is three components, each solving its own problem:

### 1. vrack2-core — the foundation (framework)

A toolkit for building **services** (npm `vrack2-core`). A service = a set of **devices** (components with business logic) linked by **connections** through **ports**; a service is described by a JSON file (devices + options + connections).

Core provides: `Device`, `Port`, `Rule`, `Metric`, `Action` (the bricks); `Container` (hosts devices, creates connections, emits lifecycle events); `MainProcess` (starts a service from a file); `ImportManager`, `UniversalWorker` (loading schemas/classes, isolated processes); `ErrorManager`, `Bootstrap` (errors, device "wrappers").

Core can be used on its own, but it is recommended to use it as part of VRack2.

### 2. vrack2-service — the service runner

Its job is to **simplify starting a service written on core**: take a service file and, according to it, start the service:

```
node ./run/index [path/to/service.json]
  → ImportManager.importJSON(serviceFile)   // load the schema (devices, connections)
  → MainProcess.run()                        // core: Container → devices → connections → lifecycle
```

- by default it starts the **VRack2 service** (`devices/vrack2/vrack2.json`; options override — `vrack2.conf.json`);
- with a path argument — **any service** (standalone, without the platform);
- the same `run/index.js` also runs as a **child worker** — that's how every service started by VRack2 gets its own process (the parent passes the service file, `MainProcess`, and options).

It is also a **workspace**: device libraries (`devices/`), user services (`services/`), generated structures (`structure/`), device state (`storage/`).

### 3. VRack2 — a service written on core

VRack2 (`devices/vrack2`) — **a vrack2-core service started by vrack2-service** (it is the default target service). Its purpose is to **systematically extend the capabilities** of a service written on core:

- **starts services**: `ServiceManager` (start/stop, autoStart/autoReload) + `WorkersManager` (workers: a thread by default, a process when `isolated: true` — [02-service](./02-service.md) § `meta.json`) + the service process skeleton `process.json` (`Master + WorkerProvider + Service`);
- **provides an API** for working with services: the chain `WSProvider → ProvidersClients → Guard → Master` — commands with data validation and access levels, authorization (API keys, AES-CBC), broadcast channels;
- **systematizes transport**: the Provider/Client model (`ProvidersClients`: N providers × M clients, dynamic ports `client%d.*` / `provider%d.send`). `WSProvider` is just one transport implementation; `Guard`/`Master`/`Broadcaster` sit above the transport and don't depend on it.

In other words, "the VRack2 platform" = the `devices/vrack2` service (the `vrack2.json` schema) running in the `vrack2-service` runner on the `vrack2-core` framework. Composition and API — in detail in [04-platform](./04-platform.md).

Key implications:

- **the platform is a service** → it is extended the same way as any service (see below);
- **VRack2's devices are reusable** — `ServiceManager`, `Master`, `KeyManager`, `Service`, etc. can be placed into your own services.

## How to extend VRack2

All the extension mechanisms are the same as when building a service: write a device (see [03-device](./03-device.md)) and add it to the VRack2 schema (`devices/vrack2/vrack2.json`) or to your own service file.

1. **A new API command** — a device with a `register.command` (output) port and a `command` (input) port, connected to a free `Master.registerN` / `Master.commandN` (the number of ports is set by the `registerPorts`/`commandPorts` options). The command automatically appears in `commandsList` with its description, access level, and data validation — the API self-documents.
2. **A new transport** — a device implementing the provider ports (`send`, `command`, `register`), like `WSProvider`. Add it to `vrack2.json`, raise `ProvidersClients.providers` (up to 10), connect `provider%d.send` / `client%d.*`. `Guard`, `Master`, `Broadcaster` don't need to change.
3. **System devices** — subscribe to Container events (`ServiceManager.service.*`, `Guard.client.*`, `KeyManager.key.*`) and do something: notifications (the vrack2-system library is exactly that: event interception, adapters, telegram), auditing, integrations.
4. **Inter-service control** — the `InterService` device (a `command` port, e.g. `serviceStart`) lets a service execute its own VRack2 commands.
5. **Commands inside a service** — each running service has its own `Master` and `Service` (the `process.json` skeleton): `Service` routes commands to the service's devices (actions, metrics, sending data), and external commands arrive through the submaster chain: `Master.submaster → ServiceManager.submaster → worker (WorkersManager) → the service's Master`.

## Glossary

| Term | Meaning |
|---|---|
| **Service** | A work unit: a set of devices + connections, described by a JSON file. Runs in a separate process (a worker) |
| **Runner (vrack2-service)** | The service starter: takes a service file and, according to it, starts the service (`run/index.js` → `MainProcess`) |
| **Device** | A class extending `Device` (vrack2-core) — a reusable component with business logic |
| **Vendor** | A group of devices: a directory in `devices/` (often a separate git repository) |
| **Port** | A device input/output for passing events. Two types: `standard`, `return`; there are dynamic ones too |
| **Connection** | A string of the form `A.out -> B.in` in a service file |
| **Container** | An EventEmitter from vrack2-core: stores the service's devices, creates connections, emits lifecycle events |
| **Bootstrap** | A core mechanism for "wrapping" a device with extra capabilities (above the container) |
| **Worker** | `UniversalWorker`: a thread (`worker_thread`) of the main process by default, a separate process (`fork`) when `meta.isolated: true` (see [02-service](./02-service.md) § `meta.json`). Each service — its own worker |
| **Submaster** | A port that passes unknown commands further down the chain (Master → ServiceManager → service) |
| **Broadcast** | Broadcast channels for WS clients: `services.{id}.devices.{dev}.{channel}` |
| **terminal / notify / event / alert / error** | A device's service messages (`this.terminal(...)` etc.) — visible in Manager, interceptable in code |
| **Shares** | A device's live data — a plain object (not reactive), sent to clients only when the device calls `this.render()` after a change (batching: the platform's `renderDelay` option, default 200 ms, range 10–3000) |
| **Storage** | A device's persistent JSON state (`this.storage` + `this.save()`), files in `storage/` |
| **Metric** | A numeric time series captured by the platform's unified journal (`vrack2.Journal`, vrack2-journal-db), e.g. `memory.rss` |
| **Action** | An async method of a device, invoked via the API (`Action.global()`) |
| **Service file** | `<id>.json` + `<id>.meta.json` + optional `<id>.conf.json` |

## Structure of this repository

```
vrack2-service/
├── run/index.js            # Entry point: npm start [path/to/service.json]
├── devices/                # Device libraries (vendors)
│   ├── vrack2/             #   The platform: ServiceManager, Guard, Master, WSProvider, …
│   ├── vrack2-basic/       #   Basic devices (Interval, Debug, …)
├── services/               # User services: *.json + *.meta.json (+*.conf.json)
├── structure/              # Auto-generated service structures (graphs) + worker::<id>.json
├── storage/                # Persistent device state (JSON)
└── node_modules/vrack2-core/
```

## Key parameters of this environment

| Parameter | Value | Where |
|---|---|---|
| WebSocket API port | **4404** (standard 4044) | `devices/vrack2/vrack2.conf.json` |
| Service directories | `./services` (generate: true), `./devices/zlab-weather/services` (generate: true), `./devices/zlab-wprotect/service`, `./devices/vrack2-example/services` (generate: false) | `vrack2.conf.json` → `ServiceManager.servicesDirs` |
| autoStart | `false` — services are started manually / via the API | `vrack2.conf.json` |
| autoReload | `true` — the global enabling switch (the firing condition — [04-platform](./04-platform.md) § ServiceManager); does not apply to init errors (the list is in [03-device](./03-device.md)) | `vrack2.conf.json` |

## Design principles (from the authors)

1. **One device — one zone of responsibility.** From the name it should be clear what it does: `Interval`, `ParkingManager`, `SNMPTrap`. The suffixes `Manager`/`Adapter`/`Transmitter` refine the role.
2. **Don't split for the sake of modularity.** First extend the existing device (add an option); create a new one only if there's no way out.
3. **Shared logic — into a separate device** (or a static helper, if stateless and one vendor).
4. **API-like interaction between devices** through `return` ports: a list of commands + one handler (an example — `devices/vrack2/docs/Service.md`).
5. **Self-documentation**: describe ports/options/metrics — that is the documentation for Manager and for AI.
