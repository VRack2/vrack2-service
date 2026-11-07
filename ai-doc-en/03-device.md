# 03 — Device (component)

> **API verified against the installed `vrack2-core`** (CHANGELOG 2026.09.29; public API table = `node_modules/vrack2-core/docs/11-API.md`). If a doc here and the code disagree, the code wins — the ultimate source is `node_modules/vrack2-core/lib/`.

## Vendor and device registration

```
devices/<vendor>/
├── list.json          # Device registry (REQUIRED)
├── package.json       # The vendor's npm dependencies (optional)
├── helpers/           # Static helpers (optional)
├── MyDevice.js        # A device file, CamelCase
└── src/ + tsconfig.json   # For TypeScript: src/*.ts → devices/*.js (+.d.ts)
```

Rules:

- vendor name — lowercase Latin, hyphens allowed;
- device file — `CamelCase.js`;
- `list.json` — two formats:
  - a plain array: `["Device1", "Device2"]`;
  - an object with paths (if the files are not at the vendor root): `{ "Master": "devices/Master" }`.
- **A device not listed in `list.json` is invisible** — its type will not be found.
- TypeScript: see the "TypeScript" section below (that's how the platform itself is built — `devices/vrack2`).

## Device skeleton

> A device = a class extending `Device` from `vrack2-core`. All the logic — in input handlers, actions, and lifecycle hooks.

```js
const { Device, Port, Rule, Action, Metric } = require('vrack2-core');

class MyDevice extends Device {

  // ── OPTIONS: validation + defaults. this.options is available in all methods
  checkOptions() {
    return {
      timeout: Rule.number().integer().min(100).default(1000).description('Interval, ms'),
      enabled: Rule.boolean().default(true),
    };
  }

  // ── PORTS: standard = fire-and-forget (1→N); return = request/response (1→1)
  inputs()  { return { 'trigger': Port.standard().description('Start signal') }; }
  outputs() { return { 'result':  Port.standard().description('Result'),
                       'api':     Port.return().description('API port') }; }

  // ── INPUT HANDLER: input + the port name in CamelCase ('trigger' → inputTrigger)
  inputTrigger(data) {
    if (!this.options.enabled) return;
    this.terminal('trigger received', data);          // a service message (visible in Manager)
    if (this.ports.output['result'].connected)        // ALWAYS check connected
      this.ports.output['result'].push({ ...data, at: Date.now() });
  }

  // ── LIFECYCLE (call order, see the "Lifecycle" section below)
  onRegister() {}                                       // before ports exist: dynamic handlers
  onStart() {}                                          // sync start (timers, subscriptions)
  async onStartAsync() {}                               // async start; the container WAITS for all
  onStop() {}                                           // optional: when the container stops the device
  async onStopAsync() {}                                // optional: async counterpart of onStop()
  onBeforeAction(action, data) { return true; }         // veto an action by returning false
  onDestroy() {}                                        // when the device is removed from the service
}

module.exports = MyDevice;
```

Rules that break startup/runtime if violated:

| Where | Rule | Example |
|---|---|---|
| port name | one word, lowercase Latin, no leading digits; 1 level of groups via `.` | ✅ `timers.gate1` ❌ `gate-1`, `a.b.c` |
| input handler | `input` + CamelCase of the port name | `control.start` → `inputControlStart` |
| action handler | `action` + CamelCase of the action name | `set.value` → `actionSetValue` |
| connections | only `source.output -> target.input`; the port types must match | `A.out -> B.in` |
| device id | CamelCase, unique in the service, short | `Interval1` |
| handlers | **every input must have a handler** (otherwise `CONT_INPUT_HANDLER_NF` and the service will not start) | — |

## Options and Rule

`checkOptions()` returns an object of rules — a map `{ [name: string]: BasicType }`, where `BasicType` is the result of the `Rule.*()` factories (e.g. `Rule.number().default(10)`). **It is not callable**: the container applies the rules itself (`Validator.validate(rules, options)`); the result is available as `this.options.<name>`.

Full API (static factories + fluent methods). The ultimate source of truth — `node_modules/vrack2-core/lib/` (validator/ports/actions/metrics/errors/service):

| Rule method | What |
|---|---|
| `Rule.number()` / `.string()` / `.boolean()` / `.object()` / `.array()` / `.any()` / `.function()` | Static type factories (ALL that exist) |
| `.required()` | A required field (without it and without a `default` — a validation error `VR_ERROR_REQUIRED`) |
| `.default(v)` | The default value (applied when the key is absent); present on number/string/boolean/object/array/any/function |
| `.example(v)` | An example for documentation (does NOT become a default) |
| `.description(md)` | Description (markdown, visible in Manager) |
| `.message(template)` | Custom error text; `{description}` `{value}` `{default}` `{example}` are substituted |
| `.export()` / `.toJSON()` | A read-only snapshot of the rule |
| `.integer()` / `.min(n)` / `.max(n)` | `number` only (finite numbers: `NaN`/`±Infinity` → `VR_IS_NOT_NUMBER`) |
| `.minLength(n)` / `.maxLength(n)` | `string` only |
| `.fields({key: Rule})` | `object` only — rules for the inner fields (explicit `null` is rejected) |
| `.content(Rule)` | `array` only — a rule for each element |

`Validator.validate(rules, data)` — static validation of an object against rules (used inside core for options and for the `requirements` of actions). The `.require()` alias no longer exists — use `.required()`.

`null` vs `undefined`: an absent key (`undefined`) gets a `default` or fails if `required()`; an explicit `null` is a "present" value and is rejected by the type rules (except `Rule.any()`).

## Ports

Ports are the only way devices interact with each other (plus API/actions — for the outside).

| | `Port.standard()` | `Port.return()` |
|---|---|---|
| Connections | 1 output → **N** inputs | 1 output → **1** input |
| Return value | none | `const res = await out.push(data)` |
| Typical use | passing data, logging, statuses, triggers | local services, API-like interaction, DB |

**Ports of different types are incompatible** — you cannot connect a standard to a return (`CONT_INCOMPATIBLE_PORTS`).

> The canonical factory is **`Port.standard()`** — the old `Port.standart()` / `StandartPort` spelling is gone (removed in 2.0.0). Use only `Port.standard()`.

### Port fluent API (complete)

| Method | Where | What |
|---|---|---|
| `.description(md)` | both | Description (markdown, visible in Manager) |
| `.requirement(rule)` | both | A **documentation-only** rule for the data arriving at the port (NOT validated at runtime) |
| `.dynamic(N)` | both | Dynamic ports `1..N` (the name contains a `%d` mask, otherwise `CONT_INCORRECT_DYNAMIC_PN`) |
| `.return(rule)` | `Port.return()` only | A **documentation-only** rule for the returned value (NOT validated) |

Access to ports: `this.ports.input['name']`, `this.ports.output['name']`. Each port is a `DevicePort`: `id`, `type`, `connected` (read-only), `connections[]`, `bind`, `listens`. Sending:

```js
if (this.ports.output['result'].connected) {
  this.ports.output['result'].push(data);                        // standard
  const res = await this.ports.output['api'].push({command, data}); // return — wait for the reply
}
```

A stopped device (`running === false`) drops inbound `push` data; a not-yet-started (`registered`) device still accepts it, so start-traffic (e.g. command registration) passes.

### Dynamic ports

The number of ports depends on an option. The `%d` mask is replaced by the number 1..N:

```js
inputs() {
  return {
    'console.log%d': Port.standard().dynamic(this.options.logs).description('…'),
    'group%d.log':   Port.standard().dynamic(this.options.groups),  // groups: group1.log, group2.log …
  };
}

// Handlers for dynamic inputs are assigned in onRegister() (ports do not exist yet — only handlers):
onRegister() {
  for (let i = 1; i <= this.options.logs; i++)
    this.addInputHandler('console.log' + i, (data) => this.inputConsoleLog(data, i));
}
```

⚠️ **Every input port must have a handler — otherwise `CONT_INPUT_HANDLER_NF` and the service will not start.**

## Lifecycle

```
onRegister()  →  [ports created, handlers bound]  →  [connections]  →  onStart()  →  onStartAsync()  →  RUNNING
▲ dynamic handlers (addInputHandler/addActionHandler)          ▲ sync start: timers, subscriptions      ▲ async start; the container WAITS for ALL
```

Order is fixed by the core:

1. Constructor — `id`, `type`, `Container` are set.
2. `prepareOptions()` — prepare options **before** validation (derived values, transforms).
3. `Validator.validate(this.checkOptions(), this.options)` — options validation; on failure → `VR_NOT_PASS` (wrapped into `SLDR_ERROR_PREPARE_OPTIONS` → `SLDR_ERROR_INIT_DEVICE`).
4. `Container.registerDevice()`: `onRegister()` (ports not created yet — assign dynamic handlers), action-handler check, metric registration, input/output port creation, input-handler binding.
5. Connections created.
6. `onStart()` — **the start entry point**: all of the above is done; here you start the main work (timers, subscriptions, connections).
7. `await onStartAsync()` — async initialization the loader waits for on **every** device (e.g. opening file bases).

Stopping (reversible): `Container.stopDevice(id)` / `stopAll()` call `onStop()`, then `await onStopAsync()`, and set the device state to `stopped` (hence `running = false`). The device is **not destroyed** — restart it with `Container.startDevice(id)` (re-runs `onStart()` + `onStartAsync()`, ports and actions are enabled again).

Termination (irreversible): `onDestroy()` is called when the device is removed from a running service (`ServiceLoader.removeDevice()` → `Container.removeDevice()`). If it was running, it is stopped first (`onStop()` + `onStopAsync()`), and **only then** `onDestroy()`. On a plain process exit it is not called.

| Hook | Async | When it is called |
|---|---|---|
| `prepareOptions()` | no | before options validation |
| `checkOptions()` | no | returns the option rules |
| `onRegister()` | no | in `registerDevice()`, before start (assign dynamic handlers) |
| `onStart()` | no | in `runStart()` / `startDevice()`, step 1 |
| `onStartAsync()` | yes | in `runStart()` / `startDevice()`, step 2, awaited |
| `onStop()` | no | on stop (`stopDevice()` / `stopAll()`), only if the device was running |
| `onStopAsync()` | yes | on stop, awaited, after `onStop()` |
| `onBeforeAction(action, data)` | no | in `deviceAction()` **after** argument validation, **before** the action handler; returning `false` vetoes the action (`CONT_DEVICE_ACTION_VETOED`, fail-closed) |
| `onDestroy()` | no | on removal (after stop, if it was running) |

State machine: `CREATED → RUNNING → STOPPED → RUNNING …` (stop is reversible), and from any of those — `DESTROYED` (removal is irreversible). State is controlled **only** by the container.

## Base Device class API (complete)

Everything a `Device` subclass has. **If it's not in these tables, it doesn't exist in core (don't invent it).**

### Properties (filled by the core)

| Property | When filled | What |
|---|---|---|
| `this.id` | constructor | ID in the service (from `service.json`) |
| `this.type` | constructor | type `vendor.ClassName` |
| `this.Container` | constructor | The service's container (EventEmitter) |
| `this.options` | constructor + `createDevice()` | Options after validation (defaults applied) |
| `this.ports.input` / `this.ports.output` | `registerDevice()` | Port objects; `push(data)` on outputs |
| `this.storage` | start / hot add | Persistent state; saved by `save()` |
| `this.shares` | constructor / `onRegister()` | A **plain object** of live data; declare it as a typed field; call `render()` after changes |
| `this.running` | read-only getter | `true` unless the device is `stopped`/removed (derived from the container's `isRunning(id)`); a `registered` (not-yet-started) device is **not** stopped |

### Hooks to OVERRIDE (all have a default)

| Hook | When it is called |
|---|---|
| `description()` → `string` | once: documentation (markdown) |
| `settings()` → `{channels: [...]}` | once: the device's channels (default: all — see "Service messages") |
| `prepareOptions()` | before options validation |
| `checkOptions()` → `{name: Rule}` | options validation |
| `inputs()` / `outputs()` → `{name: Port}` | port creation |
| `actions()` → `{name: Action}` | structure generation |
| `metrics()` → `{name: Metric}` | structure generation |
| `onRegister()` | before start: dynamic handlers |
| `onStart()` | sync start |
| `onStartAsync()` | async start; the container WAITS for all |
| `onStop()` | sync stop hook (default: no-op) |
| `onStopAsync()` | async stop hook; the container waits for it |
| `onBeforeAction(action, data)` | before each action invocation (after arg validation); `false` vetoes |
| `onDestroy()` | when the device is removed from the service |

### Methods to CALL (working API)

| Method | What |
|---|---|
| `render()` | emit `device.render` with the **current `shares` (live reference — subscribers treat it as read-only)** |
| `save()` | emit `device.save` → the storage boot-class persists `storage` to a file |
| `metric(path, value, modify = 'last')` | write a metric; `modify`: `last \| first \| max \| min \| avg \| sum` |
| `terminal(data, trace, ...args)` | a service message (debug) |
| `notify(data, trace, ...args)` | a service message (a significant action) |
| `event(data, trace, ...args)` | a service message (an event) |
| `alert(data, trace, ...args)` | a service message (a reaction is needed) |
| `error(data, trace, ...args)` | a service message (an error; `trace` — an `Error` or an object) |
| `addInputHandler('port.name', fn)` | a handler for a dynamic input |
| `addActionHandler('action.name', fn)` | an action handler (instead of the `actionXxx` method) |
| `terminate(error, action)` | emit `device.terminate` — a **message** about a critical error (it does NOT stop the device by itself) |
| `getDB(id = 'DB')` | access to the service database (a `BootDatabase` instance) — see the "Database" section |
| `makeEvent(type, data, trace, args)` | a low-level emit of a device event |

> The old `sharesSnapshot()`, `attachSharesRender()`, `detachSharesRender()` and the `works` field are **gone** (removed in 2.0.0). `shares` is a plain object now and `render()` is the only way to push it out.

## State and data

### storage — persistent state

```js
class MyDevice extends Device {
  inputs()  { return { 'set.cache': Port.standard() }; }
  storage   = { cache: {} };                    // automatically restored before onStart()

  inputSetCache(data) {
    this.storage.cache = data;
    this.save();                                // written to storage/<service-id>/<DeviceID>.json (default dir: ./storage)
  }
}
```

- Only JSON-serializable data.
- ⚠️ **Don't save often** — it's bad for the SSD.

### shares + render — live data for the UI

`shares` is a **plain object** (no reactivity). The subclass declares it as its own typed field — initial state + shape:

```js
class MyDevice extends Device {
  shares = { count: 0 };                        // the full structure right away (typed in the IDE)

  onStart() { this.render(); }                  // send the initial state

  inputConsoleLog(data) {
    this.shares.count++;
    this.render();                              // REQUIRED — mutating shares emits nothing
  }
}
```

How it works:

1. Describe the `shares` structure fully at creation (the UI relies on it).
2. **No auto-render**: mutating `shares` (writing a field, adding a key, `delete`, or reassigning the whole object) sends **nothing** — the device calls `render()` after the change.
3. In the `device.render` event, `trace` is a **live reference** to `shares`: the subscriber must treat it as read-only (mutating it changes the device state) and clone it itself (`structuredClone`) before sending it across a serialization boundary (postMessage, worker reply).
4. Keep only plain JSON data in `shares` (`Date`, `Map`, class instances pass as-is — no wrapper).
5. Sends are **queued** and not instant: batched per device (~200 ms by default — the service's `renderDelay` option, 10…3000 ms).
6. `render()` works at any point in the lifecycle, even after `removeDevice()`.

The data goes to clients over the `services.<id>.devices.<DeviceID>.render` channel.

> **Typing `options` (TS).** Base `options` is `Record<string, any>`. To get IDE hints inside the class, narrow the type by declaration only — `declare` emits no runtime code:
>
> ```ts
> type MyOptions = { scale: number }
> class Counter extends Device {
>   declare options: MyOptions
>   work() { const s: number = this.options.scale }   // IDE hints
> }
> ```

## Metrics

Every `this.metric()` call emits a `device.metric` container event. On the VRack2 platform the worker forwards it to the master, where the unified journal (device `vrack2.Journal`, [vrack2-journal-db](https://github.com/ponikrf/vrack2-journal-db) store `journals/vrack2`, table `service_metric`) stores it; reading — the `serviceDeviceMetric` command ([04-platform](./04-platform.md)). The core boot-class `DeviceMetrics` ([VRackDB](https://github.com/ponikrf/VRackDB), round-robin storage) is only used by standalone services started without the platform.

```js
metrics() {
  return {
    'test.metric': Metric.inS()
      .retentions('1s:6h')                    // precision 1 s, retention 6 h; '1s:6h, 15s:1d' is possible too
      .description('Metric description'),
  };
}

onStart() {
  setInterval(() => this.metric('test.metric', Math.sin(Date.now() / 100000)), 1000);
}
```

### Metrics API (complete)

| Method | What |
|---|---|
| `Metric.inS()` / `Metric.inMs()` / `Metric.inUs()` | Factories: the minimal time unit is s / ms / µs (ALL that exist) |
| `.retentions('5s:10m, 1m:2h, ...')` | Precision/retention layers (Graphite style); default `5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y`. Only honored by the standalone `DeviceMetrics` storage — on the platform, retention is set once by the journal option `metricRetention` |
| `.description(md)` | Description (visible in Manager) |
| `.valueStorage(StorageTypes.X)` / `.timeStorage(StorageTypes.X)` | Storage type of the value / of the time (default: `Float` / `Uint64`) |
| `.additional(obj)` | Arbitrary extra data |

**Writing a value**: `this.metric(path, value, modify = 'last')` — `path` from `metrics()`, `modify`: `last | first | max | min | avg | sum`. Writing an unregistered metric is ignored.

- Name: `[a-zA-Z0-9._*]`, short; the pattern is `domain.<id>.reading`. **`<id>` is a placeholder (not part of the name)**: in a real name it is replaced entirely by a concrete value — `boilers.<id>.temp` → `boilers.42.temp`, `boilers.7.temp`.
- Viewing — in the VRack2 Manager.

## Actions

Async methods of a device, invoked via the API (including from Manager):

```js
actions() {
  return {
    'test.action': Action.global()
      .requirements({ num: Rule.number().integer().default(1) }),   // input data validation (checked on EVERY call)
  };
}

// Name = 'action' + CamelCase: 'test.action' → actionTestAction
async actionTestAction(data) {
  // data is ALWAYS a single object; you can switch on data.command
  return { ok: true, echo: data };    // you must return something JSON-serializable
}
```

### Actions API (complete)

| Method | What |
|---|---|
| `Action.global()` | The only factory (the action type for today — `global`) |
| `.requirements({key: Rule})` | Validation of the input `data` — **checked on every call** (fail-closed: any error → the action is not executed) |
| `.returns({key: Rule})` | The **recommended** structure of the reply (documentation; the reply is NOT validated) |
| `.description(md)` | Description (visible in Manager) |

Handler: the method `action` + CamelCase (`get.state` → `actionGetState`) **or** `this.addActionHandler('get.state', fn)` in `onRegister()`.

Invocation (`Container.deviceAction(device, action, data)`), in order:

1. the device exists (`CONT_DEVICE_NF`);
2. the device is running (`CONT_DEVICE_STOPPED` if stopped);
3. the action is declared (`CONT_DEVICE_ACTION_NF`);
4. the handler exists (`CONT_DEVICE_ACTION_HANDLER_NF`);
5. `Validator.validate(action.requirements, data)` — fail-closed;
6. the `onBeforeAction(action, data)` hook runs — returning `false` vetoes the action (`CONT_DEVICE_ACTION_VETOED`);
7. the handler is called; its return value is the reply.

**Invoked from outside** (from the platform API, MCP, Manager) — commands unknown to the main process's Master are passed to the worker via `submaster`: `serviceDeviceAction` (level 2), `serviceDevicePush` (level 1), `serviceDeviceShares` (level 1). Device lifecycle is controlled by separate commands: `deviceProcess`, `deviceStop`, `deviceStatus` (all level 1). Metrics are read at the master level (`serviceDeviceMetric`, the unified journal — not a submaster command). Rules, the `data` formats, and replies — [04-platform](./04-platform.md), the "How commands are executed inside a service (submaster)" section.

## Service messages

The purposes of `terminal`/`notify`/`event`/`alert`/`error` — in the "Methods to CALL" table above.

- They go to clients over the `services.<id>.devices.<DeviceID>.<type>` channels; if nobody is subscribed — nobody gets them.
- Intercepting inside a service (subscribe in `onStart()`):

```js
onStart() {
  this.Container.on('device.alert', ({ device, data, trace }) => {
    // e.g. send to Telegram / save to a DB / notify another service
  });
}
```

`settings()` declares the channels a device uses — by default all of them: `terminal`, `notify`, `event`, `action`, `alert`, `error`, `render`, `status`.

The **`status`** channel is automatic — the device never calls or handles it in code. The container maintains a systematized status per device and emits a full snapshot on `device.status` at every change (fields and triggers — the "Container" section below).

## Database (`getDB()`)

A service-wide database — a boot-class declared in the `bootstrap` section (see [04-platform](./04-platform.md) for the platform's own use). A device reaches it via:

```js
getDB(id = 'DB')   // → BootDatabase
```

- `id` — the boot-class id from the bootstrap list; default `'DB'`. Not declared → `BTSP_CLASS_ID_NOT_FOUND`.
- Returns the **interface** `BootDatabase`, not a concrete adapter; if you need adapter methods, get its class via `Container.Bootstrap.getBootClass()`.
- The DB is guaranteed started **before** the device's `onStartAsync()` (boot-classes finish starting before devices).
- A device cannot close/stop the DB — it's a process-level resource, stopped only by `Bootstrap.destroyAll()`. Liveness check — `ping()` (throws if not alive).

Public API: `query(sql, params?)` → rows · `get(sql, params?)` → first row or `undefined` · `execute(sql, params?)` → `{ affectedRows, insertId? }` · `transaction(fn)` — auto `COMMIT`, on error in `fn` → `ROLLBACK` + `BDB_TRANSACTION_FAILED` · `ping()`. Params are positional (`?`) only. Errors are coded (`BDB_*`).

```js
class Track extends Device {
  async onStartAsync() {
    const db = this.getDB();
    const row = await db.get('SELECT * FROM tracks WHERE id = ?', [this.options.id]);
    this.shares.title = row && row.title;
  }

  actionPlay() {
    return this.getDB().transaction(async (tx) => {
      await tx.execute('INSERT INTO listens (track_id, ts) VALUES (?, ?)', [this.id, Date.now()]);
      await tx.execute('UPDATE tracks SET plays = plays + 1 WHERE id = ?', [this.id]);
    });   // atomic: either both, or neither
  }
}
```

## Container (this.Container)

`this.Container` — access to the service's container (EventEmitter) from any device.

Startup events (in the order they are generated):

1. `service.start.begin` → 2. `device.start` (per device) → 3. `service.start.end` →
4. `service.startAsync.begin` → 5. `device.startAsync` (per device) → 6. `service.startAsync.end` →
7. `service.ready.begin` → 8. `service.ready`

Stop / hot events:

- `service.stop.begin` → `device.stop` (per device, reverse order) → `service.stop.end`
- `service.connection` (on `addConnection`) · `device.remove` (on `removeDevice`)
- `device.metric.register` (on `registerDevice`)
- `device.action.before` (before an action handler)
- `device.status` (automatic, on every status change)

Device messages: `device.terminal`, `device.notify`, `device.event`, `device.alert`, `device.error`, `device.render`, `device.save`, `device.metric`, `device.terminate`.

### Device status (container-maintained)

The container keeps one `IDeviceStatus` record per registered device:

| Field | Meaning |
|---|---|
| `id`, `type` | device id / `vendor.Class` |
| `state` | `registered` / `started` / `stopped` (the single source of lifecycle info; `Device.running` and the started-set are derived from it) |
| `since` | `Date.now()` (ms) of the last status change |
| `lastAlert`, `lastError` | last alert/error message — `{ data, trace, at }`, or `null` |
| `alertCount`, `errorCount` | counts since registration (terminate counts as an error) |

On every change a **full snapshot** is emitted on `device.status` (envelope `{ device, data: 'status', trace: <IDeviceStatus> }`): on registration, on successful start, on successful stop, and on `device.alert` / `device.error` / `device.terminate`.

Container accessors:

```js
this.Container.getDevice(id)          // the device instance or undefined
this.Container.hasDevice(id)          // registered?
this.Container.deviceList()           // array of all device ids
this.Container.getDeviceStatus(id)    // a copy of the status, or undefined
this.Container.deviceStatusList()     // copies of all statuses
this.Container.isRunning(id)          // true unless stopped/removed
this.Container.isStarted(id)          // passed onStart()+onStartAsync()?
this.Container.getStructure()         // the live structure (devices, actions, ports, metrics)
```

Access to other devices (rarely needed; usually ports are better):

```js
for (const deviceId in this.Container.devices) {
  const dev = this.Container.devices[deviceId];
  if (dev.type === 'my-vendor.MyDevice') dev.someMethod();
}
```

## Errors and service termination

Registration of typed errors (at the top of the device file):

```js
const { ErrorManager, Rule } = require('vrack2-core');

ErrorManager.register(
  'MyVendor',          // group (component/domain) — common for the errors of this module
  'MY_SHORT_CODE',     // the short unique identifier (this is what make()/isCode() use)
  'A human-readable description',
  { param: Rule.string().description('…') }   // rules documenting the additional data (NOT validated)
);

// Usage:
throw ErrorManager.make('MY_SHORT_CODE', { param: 'x' }).setTrace(new Error());
```

### ErrorManager / CoreError API (complete)

| Method | What |
|---|---|
| `ErrorManager.register(name, short, description, rules?)` | register an error; identical re-registration — no-op, a conflicting one (same `short`, different data) — throws `EM_CODE_EXISTS`. There is **no** `code` parameter |
| `ErrorManager.registerMany(name, list)` | atomic bulk registration (`list` = array of `{ short, description, rules? }`); if any entry conflicts or duplicates a `short` inside the list — nothing is registered and `EM_CODE_EXISTS` is thrown |
| `ErrorManager.make(short, additional = {})` → `CoreError` | create an error; the `additional` fields are added to the object; unknown code — `EM_CODE_NOT_FOUND` |
| `ErrorManager.convert(error)` → `CoreError` | convert a plain `Error`; a VRack error is returned as-is |
| `ErrorManager.isCode(error, short)` → `bool` | match an error by its `vShort` |
| `ErrorManager.isError(error)` → `bool` | is the object a VRack error |
| `ErrorManager.getRegistered(short)` → `record \| null` | find a registration (marked private — use with care) |

**CoreError** (extends `Error`):
- fields: `vError`, `vShort` (the **only** canonical identifier), `vAdd` (extra data keys), `vAddErrors` (nested errors). There is **no `vCode` field** (removed in 2.0.0);
- methods: `setTrace(err)`, `add(err)` (a nested error), `import(obj)`, `export()`, `getUnknownProperty(field)`, the static `CoreError.objectify(error)`.

Error codes are now namespaced by module (old common prefixes are gone — **no back-compat aliases**):

- `EM_*` (ErrorManager): `EM_CODE_EXISTS`, `EM_CODE_NOT_FOUND`, `EM_ERROR_CONVERT`.
- `VR_*` (Validator): `VR_NOT_PASS`, `VR_ERROR_REQUIRED`, `VR_IS_NOT_NUMBER`, … (full list — `node_modules/vrack2-core/docs/08-Errors.md`).
- `CONT_*` (Container): `CONT_DEVICE_NF`, `CONT_DEVICE_STOPPED`, `CONT_IGNORE_SERVICE_AUTORELOAD`, `CONT_INPUT_HANDLER_NF`, `CONT_DEVICE_PROCESS_EXCEPTION`, `CONT_DEVICE_PROCESS_PROMISE_EXCEPTION`, `CONT_DEVICE_ACTION_VETOED`, …
- `SLDR_*` (ServiceLoader): `SLDR_CONF_EXTENDS_PROBLEM`, `SLDR_ERROR_INIT_DEVICE`, `SLDR_ERROR_INIT_CONNECTION`, `SLDR_ERROR_PREPARE_OPTIONS`, `SLDR_INCORRECT_DEVICE_ID`.
- `BTSP_*` (Bootstrap): `BTSP_CLASS_ID_NOT_FOUND`, `BTSP_BAD_BOOTLIST`, …
- `BDB_*` (BootDatabase): `BDB_NOT_READY`, `BDB_CLOSED`, `BDB_CONNECT_FAILED`, `BDB_QUERY_FAILED`, `BDB_BUSY`, `BDB_TX_LOCKED`, `BDB_TRANSACTION_FAILED`.
- `DM_*` / `SS_*` / `IM_*` (DeviceManager / StructureStorage / ImportManager).

> The old `CTR_*` codes are **renamed** (not aliased): `CTR_DEVICE_STOPPED` → `CONT_DEVICE_STOPPED`, `CTR_IGNORE_SERVICE_AUTORELOAD` → `CONT_IGNORE_SERVICE_AUTORELOAD`, the ServiceLoader ones → `SLDR_*`, and so on. `ErrorManager.isCode()` and the docs accept **only** the new names.

Service termination:

```js
this.terminate(new Error('I cannot go on like this'));
```

> **Note:** `Device.terminate(error, action)` emits the `device.terminate` message — it does **not** stop the device by itself. Stopping a device is `Container.stopDevice()` / `stopAll()`; graceful shutdown of the whole service is `MainProcess.stop()`.

- Auto-reload kicks in only if **both** `meta.autoReload` **and** the global `autoReload` option of `ServiceManager` are on (the full condition, the exceptions, and the timer — [04-platform](./04-platform.md) § ServiceManager).
- To **forbid auto-reload** (a human needs to step in):

```js
const nError = ErrorManager.make('CONT_IGNORE_SERVICE_AUTORELOAD').add(err);
this.terminate(nError);
```

- Auto-reload **does not kick in anyway** for errors before the container is fully loaded:
  `SLDR_CONF_EXTENDS_PROBLEM`, `SLDR_ERROR_INIT_DEVICE`, `CONT_DEVICE_PROCESS_EXCEPTION`, `CONT_DEVICE_PROCESS_PROMISE_EXCEPTION`, `SLDR_ERROR_INIT_CONNECTION`.
- Unhandled exceptions kill the service (`uncaughtTerminate: true` by default, an option of the `Service` device; disabled with `uncaughtTerminate: false`).

## Self-documentation

- The device's `description()` — markdown, visible in Manager.
- Fill in `.description()` for every port/option/metric/action.
- `default(v)` — the default value (applied); `example(v)` — an example for documentation (does not become a default). If you don't fill in `default` — fill in `example`.
- The service schema and the API are generated from the running code — the documentation is always up to date, nothing needs to be "documented by hand".

## TypeScript

- Sources — `src/*.ts`, the result — `devices/*.js` + `*.d.ts`; the mapping — `list.json` with paths (an example — the platform itself: `devices/vrack2`).
- Import: `import { Device, Port, Rule, Metric, Action, ErrorManager } from 'vrack2-core'`.
- Declare `shares` as a typed field and narrow `options` with `declare` for IDE hints (see the "shares + render" and "Typing options" notes).
- For the IDE: autocompletion of the links to `vrack2-core/lib/...` gives the types (BasicPort, BasicType, BasicMetric).

## Exports of `require('vrack2-core')` (complete list)

A typical import for a device:

```js
const { Device, Port, Action, Rule, Metric, ErrorManager, CoreError } = require('vrack2-core');
```

All the names available at runtime — verified via `Object.keys(require('vrack2-core'))`; the `I*` types exist only in the `.d.ts` and are absent from the runtime. This list is pinned by a strict set test in core (`test/smoke.test.ts`) and documented in `docs/11-API.md`:

| Group | Names |
|---|---|
| For devices (usually enough) | `Device`, `Port`, `Action`, `Rule`, `Metric`, `ErrorManager`, `CoreError` |
| Validation | `Validator` (`.validate(rules, data)`), `BasicType`, `SubruleNames` |
| Infrastructure | `ImportManager`, `Container`, `MainProcess`, `UniversalWorker`, `ReactiveRef`, `ServiceLoader`, `Utility` |
| Bootstrap | `Bootstrap`, `BootClass`, `DeviceFileStorage`, `DeviceManager`, `StructureStorage`, `DeviceMetrics` |
| Database | `BootDatabase`, `BootDatabaseSqlite`, `BootDatabaseMemory` (and the `IExecResult` type) |
| Bootstrap config | `mergeBootList` (layered merge of the boot-list config) |
| Base types (ports) | `BasicPort`, `StandardPort`, `ReturnPort` (the port with `.return(rule)`) |
| Base types (actions/metrics) | `BasicAction`, `BasicMetric` |
| Device connections/ports | `DeviceConnect`, `DevicePort` |
| Storage (re-export of `vrack-db`) | `StorageTypes` (`Float`, `Uint64`, …) |

> The `I*` interfaces (`IDeviceStatus`, `IDeviceStatusMessage`, `ICheckResult`, `IServiceStructure`, `IBootListConfig`, `IBootstrapEntry`, `IMainProcessOptions`, `IMetricSettings`, `IPort`, `IDeviceEvent`, `IValidationProblem`, `IValidationRule`, `IValidationSubrule`, `SubruleName`, `IStructureDevice`) are compile-only — they never appear in `Object.keys(require('vrack2-core'))`.
>
> Removed in 2.0.0: the `StandartPort`/`Port.standart()` aliases and the old lifecycle hooks `preProcess`/`process`/`processPromise`/`stop`/`stopPromise`/`beforeTerminate`.
