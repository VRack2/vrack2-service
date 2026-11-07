# 02 — Service: files and lifecycle

## What a service is

A service = a JSON file describing a set of devices and the connections between them. **No code is required to run a service** — only device libraries (vendors). A service runs in a separate process (a worker); a service crash does not kill the platform.

## Service files

| File | Required | Purpose |
|---|---|---|
| `my-service.json` | ✅ | Devices and connections |
| `my-service.meta.json` | recommended | name/group/description/autoStart/autoReload/isolated/parentChannels/journalEvents/journalMetrics/journalPorts |
| `my-service.conf.json` | optional | Options override for specific devices (usually in `.gitignore`) |

Where services live: `./services/` (default).

Service naming rules: lowercase Latin, `-` separator, no dots or special characters.

### Service file: syntax

```json
{
    "devices": [
        {
            "id": "Interval1",
            "type": "basic.Interval",
            "options": { "start": true, "timeout": 1200 },
            "connections": ["Interval1.gate -> Debug.debug1"]
        },
        { "id": "Debug", "type": "basic.Debug", "options": {} }
    ],
    "connections": []
}
```

- `devices[].id` — unique within the service; CamelCase; **short** — it goes into connections, broadcast channels, and storage paths.
- `devices[].type` — the device class `vendor.ClassName`; must be registered in the vendor's `list.json`.
- `devices[].options` — parameters; validated by the device's `checkOptions()`; may be `{}`.
- `connections` — an array of strings `"SourceID.out -> TargetID.in"`. Only `->`. Connections can be written globally or inside the device (as in the example) — the result is the same.

### meta.json

```json
{
    "name": "Unimax test",
    "group": "Test",
    "description": "A short description (markdown)",
    "autoStart": false,
    "autoReload": false,
    "isolated": false,
    "parentChannels": ["ServiceManager.service.update"]
}
```

| Field | What it does |
|---|---|
| `autoStart` | Start the service when VRack2 starts (only if the global `autoStart` is on) |
| `autoReload` | Allow the service to auto-restart on failure (does not apply to init errors — see [03-device](./03-device.md) § Errors). **Not self-sufficient**: the restart only kicks in together with the global `autoReload` option on `ServiceManager` (see [04-platform](./04-platform.md) § ServiceManager) |
| `isolated` | **`true`** — the service code runs in a separate **process** (`child_process.fork`; needed for I²C/Serial and similar). **`false`** (default) — the worker is a **thread** (`worker_thread`) of the main process. This is the canonical description of the worker |
| `parentChannels` | A list of the parent VRack2's events passed into the service; received via `Service.parent.event` (see [04-platform](./04-platform.md) § System events) |
| `journalEvents` | `false` — the service's device events are not written to the master's unified journal (default: on) |
| `journalMetrics` | `false` — the service's device metrics are not written to the master's unified journal (default: on) |
| `journalPorts` | `true` — outgoing port pushes are written to the journal (default: **off**, opt-in debug tool) |

### conf.json — override without touching the original

Needed when the service comes from a repository and you want to change a couple of options:

```json
{
    "devices": [
        { "id": "Interval1", "type": "basic.Interval",
          "options": { "start": true, "timeout": 4000 } }
    ]
}
```

Only the options of the listed devices change; the rest of the schema comes from the original. Recommended practice: `*.conf.json` in `.gitignore`.

## What happens at startup

```
ServiceManager (VRack2's main process)
  └─ worker.add ──▶ a new worker process
        └─ run/index.js  (MainProcessPath = vrack2-core.MainProcess)
              └─ Master + WorkerProvider + Service   ← the process skeleton (devices/vrack2/process.json)
                    └─ Service creates the Container with YOUR devices:
                         onRegister → [ports + connections] → onStart() → onStartAsync() → running
```

- Each service = a separate worker process (how the worker is started by the runner — [01-basics](./01-basics.md) § "What this is").
- Commands to the service go through the submaster chain: `ServiceManager → worker → Master → Service` (return ports, `await push()`).
- The running service's structure is saved to `structure/<id>.json` and `structure/worker::<id>.json` — **useful to check** that the service came up with the expected schema.
- Device state: `storage/<hash>/<DeviceID>.json`.
- Service lifecycle events (the main process's Container): `ServiceManager.service.start` / `.stop` / `.update` / `.error` / `.exit` / `.convert`.

## Real examples from this environment

### unimax — a Viessmann boiler over a socket tunnel

`services/unimax.json`:

```json
{
  "devices": [
    { "id": "WSH1", "type": "viessmann.Vitotronic200H", "options": {} },
    {
      "id": "Provider", "type": "vrack2-net.ConverterBus",
      "options": {
        "devices": 1,
        "socket": { "host": "192.0.2.139", "port": 4001 },
        "debug": true,
        "internalTimer": 1000
      },
      "connections": ["Provider.dev1 -> WSH1.bus"]
    }
  ],
  "connections": []
}
```

> `192.0.2.139` — a placeholder address (RFC 5737 test net) standing in for the real LAN address of the gateway.

`services/unimax.meta.json`: `autoStart: false`, `autoReload: false`, `isolated: true`, `parentChannels: ["ServiceManager.service.update"]`.

The idea: `ConverterBus` (vrack2-net) delivers the bus into the process, `Vitotronic200H` (viessmann) — the boiler logic. `isolated: true` — the service code in a separate process.

### plc — DI/DO + relay logic

`services/plc.json`: `vrack2-other-rtu.Waveshare8D` (8 DI / 8 DO) ↔ `my-vendor.LadderDiagramManager` — bidirectional connections:

```
DIDO8.di1..di8  -> LDManager.module.x1..x8
LDManager.module.y1..y8 -> DIDO8.do1..do8
DIDO8.status -> LDManager.module.status
```

## Service control commands (API)

`serviceList`, `service`, `serviceMeta` (level 3) — read; `serviceStart`, `serviceStop`, `serviceCheck`, `serviceErrors`, `serviceErrorsClear` (level 1) — control. Full table (with the `data` formats) — [04-platform](./04-platform.md) § ServiceManager.
