# 03 — Device (component)

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

> A device = a class extending `Device` from `vrack2-core`. All the logic — in input handlers and lifecycle methods.

```js
const { Device, Port, Rule } = require('vrack2-core');

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

   // ── LIFECYCLE (call order)
   preProcess() {}                                      // before connections: dynamic ports, addInputHandler
   process() {}                                         // after connections: sync start
   async processPromise() {}                            // async start; the container WAITS for all
   stop() {}                                            // optional: called when the container stops the device
   async stopPromise() {}                               // optional: async counterpart of stop()
}

module.exports = MyDevice;
```

Rules that break startup/runtime if violated:

| Where | Rule | Example |
|---|---|---|
| port name | one word, lowercase Latin, no leading digits; 1 level of groups via `.` | ✅ `timers.gate1` ❌ `gate-1`, `a.b.c` |
| handler | `input` + CamelCase of the port name | `control.start` → `inputControlStart` |
| connections | only `source.output -> target.input`; the port types must match | `A.out -> B.in` |
| device id | CamelCase, unique in the service, short | `Interval1` |
| handlers | **every input must have a handler** (otherwise the service will not start) | — |

## Options and Rule

`checkOptions()` returns an object of rules — a map `{ [name: string]: BasicType }`, where `BasicType` is the result of the `Rule.*()` factories (e.g. `Rule.number().default(10)`). **It is not callable**: the container applies the rules itself (`Validator.validate(rules, options)`); the result is available as `this.options.<name>`.

Full API (static factories + fluent methods). **Verified against `vrack2-core` 1.1.2 (07.09.2026)**: there are no more public methods. The ultimate source of truth — `node_modules/vrack2-core/lib/` (validator/ports/actions/metrics/errors/service):

| Rule method | What |
|---|---|
| `Rule.number()` / `.string()` / `.boolean()` / `.object()` / `.array()` / `.any()` / `.function()` | Static type factories (ALL that exist) |
| `.required()` | A required field (without it and without a `default` — a validation error) |
| `.default(v)` | The default value (applied when absent); present on number/string/boolean/object/array/any/function |
| `.example(v)` | An example for documentation (does NOT become a default) |
| `.description(md)` | Description (markdown, visible in Manager) |
| `.message(template)` | Custom error text; `{description}` `{value}` `{default}` `{example}` are substituted |
| `.integer()` / `.min(n)` / `.max(n)` | `number` only |
| `.minLength(n)` / `.maxLength(n)` | `string` only |
| `.fields({key: Rule})` | `object` only — rules for the inner fields |
| `.content(Rule)` | `array` only — a rule for each element |

`.require()` — a deprecated alias of `.required()`. `Validator.validate(rules, data)` — static validation of an object against rules (used inside core for options and for the `requirements` of actions).

## Ports

Ports are the only way devices interact with each other (plus API/actions — for the outside).

| | `Port.standard()` | `Port.return()` |
|---|---|---|
| Connections | 1 output → **N** inputs | 1 output → **1** input |
| Return value | none | `const res = await out.push(data)` |
| Typical use | passing data, logging, statuses, triggers | local services, API-like interaction, DB |

**Ports of different types are incompatible** — you cannot connect a standard to a return.

> ℹ️ The correct method name is **`standard`** (`Port.standard()`). The old spelling is marked `@deprecated` in core and will be removed — use only `Port.standard()`.

### Port fluent API (complete)

| Method | Where | What |
|---|---|---|
| `.description(md)` | both | Description (markdown, visible in Manager) |
| `.requirement(rule)` | both | A validation rule for the data arriving at the port |
| `.dynamic(N)` | both | Dynamic ports `1..N` (the name contains a `%d` mask) |
| `.return(rule)` | `Port.return()` only | The recommended structure of the returned data |

Access to ports: `this.ports.input['name']`, `this.ports.output['name']`. Sending:

```js
if (this.ports.output['result'].connected) {
  this.ports.output['result'].push(data);                       // standard
  const res = await this.ports.output['api'].push({command, data}); // return — wait for the reply
}
```

### Dynamic ports

The number of ports depends on an option. The `%d` mask is replaced by the number 1..N:

```js
inputs() {
  return {
    'console.log%d': Port.standard().dynamic(this.options.logs).description('…'),
    'group%d.log':   Port.standard().dynamic(this.options.groups),  // groups: group1.log, group2.log …
  };
}

// Handlers for dynamic inputs are assigned manually in preProcess():
preProcess() {
  for (let i = 1; i <= this.options.logs; i++)
    this.addInputHandler('console.log' + i, (data) => this.inputConsoleLog(data, i));
}
```

⚠️ **Every input port must have a handler — otherwise the service will not start.**

## Lifecycle

```
preProcess()  →  [connections created]  →  process()  →  processPromise()  →  WORKING
▲ here: dynamic ports, addInputHandler, subscriptions      ▲ sync start, setInterval, timers  ▲ async start; the container WAITS for ALL to finish
```

- `preProcess()` — before the connections are created. The set of ports/handlers can also be changed here.
- `process()` — the main start, after all connections have been initialized.
- `processPromise()` — the async counterpart; the container waits for all `processPromise()` to finish before `loaded`.
- **Stopping and restarting a device** (core ≥ 1.1.x):
  - `stop()` / `stopPromise()` — overridable hooks called when the container stops the device (`Container.stopDevice(id)`); the container emits `beforeStop` → `stop(DeviceID)` → `afterStop`.
  - `Container.startDevice(id)` restarts a stopped device — re-runs `process()` + `processPromise()`.
  - `Container.removeDevice(id)` removes the device from the service (calls `beforeTerminate()`, cleans up ports and storage).
  - A **stopped** device silently drops input pushes, and its actions are rejected with `CTR_DEVICE_STOPPED`.
- The only "switch off" for the whole service is `this.terminate(err)` (the service dies, see § Errors).

## Base Device class API (complete)

Everything a `Device` subclass has. **If it's not in these tables, it doesn't exist in core (don't invent it).**

### Properties (created in the constructor)

| Property | What |
|---|---|
| `this.id` / `this.type` | ID in the service / type `vendor.ClassName` |
| `this.options` | Options after validation (defaults applied) |
| `this.shares` | `{}` — live data; sent to clients after `render()` |
| `this.storage` | `{}` — persistent state; restored before `process()` |
| `this.ports` | `{input: {}, output: {}}` — ports (filled in by the container) |
| `this.Container` | The service's container (EventEmitter) |
| `this.running` | boolean, managed by the container: `true` while the device is running, `false` after it was stopped (`stopDevice()`) — there is no more `this.works` in core 1.1.x |

### Methods to OVERRIDE (all have a default)

| Method | When it is called |
|---|---|
| `description()` → `string` | once: documentation (markdown) |
| `settings()` → `{channels: [...]}` | once: the device's channels |
| `prepareOptions()` | before options validation |
| `checkOptions()` → `{name: Rule}` | options validation |
| `inputs()` / `outputs()` → `{name: Port}` | port creation |
| `actions()` → `{name: Action}` | structure generation |
| `metrics()` → `{name: Metric}` | structure generation |
| `preProcess()` | before connections: dynamic ports, `addInputHandler` |
| `process()` | after connections: sync start |
| `processPromise()` | async start; the container WAITS for all |
| `stop()` | sync hook when the container stops the device (default: no-op) |
| `stopPromise()` | async counterpart of `stop()`; the container waits for it to finish |
| `beforeAction(action, data)` | before each action invocation |
| `beforeTerminate()` | called when the device is removed from the service (`Container.removeDevice()`) or on termination (may not be called) |

### Methods to CALL (working API)

| Method | What |
|---|---|
| `render()` | put `shares` in the queue for sending to clients |
| `sharesSnapshot()` | a plain deep copy of `shares` (safe across process boundaries, e.g. for command replies / `structuredClone`) |
| `attachSharesRender()` / `detachSharesRender()` | re-attach / detach the automatic render on `shares` changes |
| `save()` | save `storage` to a file |
| `metric(path, value, modify = 'last')` | write a metric; `modify`: `last \| first \| max \| min \| avg \| sum` |
| `terminal(data, trace, ...args)` | a service message (debug) |
| `notify(data, trace, ...args)` | a service message (a significant action) |
| `event(data, trace, ...args)` | a service message (an event) |
| `alert(data, trace, ...args)` | a service message (a reaction is needed) |
| `error(data, trace, ...args)` | a service message (an error; `trace` — an `Error` or an object) |
| `addInputHandler('port.name', fn)` | a handler for a dynamic input |
| `addActionHandler('action.name', fn)` | an action handler (instead of the `actionXxx` method) |
| `terminate(error, action)` | terminate the service |
| `makeEvent(type, data, trace, args)` | a low-level emit of a device event |

## State and data

### storage — persistent state

```js
class MyDevice extends Device {
  inputs()  { return { 'set.cache': Port.standard() }; }
  storage   = { cache: {} };                    // automatically restored before process()

  inputSetCache(data) {
    this.storage.cache = data;
    this.save();                                // written to storage/<service-id>/<DeviceID>.json (default dir: ./storage)
  }
}
```

- Only JSON-serializable data.
- ⚠️ **Don't save often** — it's bad for the SSD.

### shares + render — reactive data for the UI

```js
class MyDevice extends Device {
  shares = { count: 0 };                        // the full structure right away

  process() { this.render(); }                  // send the initial state

  inputConsoleLog(data) {
    this.shares.count++;
    this.render();                              // join the update queue
  }
}
```

How it works:

1. Describe the `shares` structure fully at creation (the UI relies on it).
2. **Auto-render** (core ≥ 1.1.x): after `preProcess()` the container subscribes changes of `shares` — any modification (writing a field, adding a key, deleting one, or even reassigning the whole object) triggers a render automatically. An explicit `this.render()` is still useful for the initial flush in `process()` and for manual updates.
3. Sends are **queued** and not instant: they are batched per device (~200 ms by default — the service's `renderDelay` option, 10…3000 ms).
4. Only JSON data, recommended size < 10KB.

The data goes to clients over the `services.<id>.devices.<DeviceID>.render` channel.

## Metrics

Under the hood — [VRackDB](https://github.com/ponikrf/VRackDB) (round-robin storage).

```js
metrics() {
  return {
    'test.metric': Metric.inS()
      .retentions('1s:6h')                    // precision 1 s, retention 6 h; '1s:6h, 15s:1d' is possible too
      .description('Metric description'),
  };
}

process() {
  setInterval(() => this.metric('test.metric', Math.sin(Date.now() / 100000)), 1000);
}
```

### Metrics API (complete)

| Method | What |
|---|---|
| `Metric.inS()` / `Metric.inMs()` / `Metric.inUs()` | Factories: the minimal time unit is s / ms / µs (ALL that exist) |
| `.retentions('5s:10m, 1m:2h, ...')` | Precision/retention layers (Graphite style) |
| `.description(md)` | Description (visible in Manager) |
| `.valueStorage(StorageTypes.X)` / `.timeStorage(StorageTypes.X)` | Storage type of the value / of the time (default: `Float` / `Uint64`) |
| `.additional(obj)` | Arbitrary extra data |

**Writing a value**: `this.metric(path, value, modify = 'last')` — `path` from `metrics()`, `modify`: `last | first | max | min | avg | sum`.

- Name: `[a-zA-Z0-9._*]`, short; the pattern is `domain.<id>.reading`. **`<id>` is a placeholder (not part of the name)**: in a real name it is replaced entirely by a concrete value — `boilers.<id>.temp` → `boilers.42.temp`, `boilers.7.temp`.
- `retentions` — precision/retention layers; without it — the default is `5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y`.
- Viewing — in the VRack2 Manager.

## Actions

Async methods of a device, invoked via the API (including from Manager):

```js
actions() {
  return {
    'test.action': Action.global()
      .requirements({ num: Rule.number().integer().default(1) }),   // input data validation
  };
}

// Name = 'action' + CamelCase: 'test.action' → actionTestAction
async actionTestAction(data) {
  // data is ALWAYS an object; you can switch on data.command
  return { ok: true, echo: data };    // you must return something JSON-serializable
}
```

### Actions API (complete)

| Method | What |
|---|---|
| `Action.global()` | The only factory (the action type for today — `global`) |
| `.requirements({key: Rule})` | Validation of the input `data` (always an object) |
| `.returns({key: Rule})` | The recommended structure of the reply (documentation; the reply is NOT validated) |
| `.description(md)` | Description (visible in Manager) |

Handler: the method `action` + CamelCase (`get.state` → `actionGetState`) **or** `this.addActionHandler('get.state', fn)` in `preProcess()`.

**Invoked from outside** (from the platform API, MCP, Manager) — commands unknown to the main process's Master are passed to the worker via `submaster`: `serviceDeviceAction` (level 2), `serviceDevicePush` (level 1), `serviceDeviceShares` (level 1), `serviceDeviceMetric` (level 3). Device lifecycle is controlled by separate commands: `deviceProcess`, `deviceStop`, `deviceStatus` (all level 1); there are also `serviceShares` (level 3), `serviceMetric`, and `serviceDeviceOutputListen`. Rules, the `data` formats, and replies — [04-platform](./04-platform.md), the "How commands are executed inside a service (submaster)" section.

## Service messages

The purposes of `terminal`/`notify`/`event`/`alert`/`error` — in the "Methods to CALL" table above.

- They go to clients over the `services.<id>.devices.<DeviceID>.<type>` channels; if nobody is subscribed — nobody gets them.
- Intercepting inside a service (subscribe in `process()`):

```js
process() {
  this.Container.on('device.alert', ({ device, data, trace }) => {
    // e.g. send to Telegram / save to a DB / notify another service
  });
}
```

## Container (this.Container)

`this.Container` — access to the service's container (EventEmitter) from any device.

Lifecycle events (in the order they are generated):

1. `configure` → 2. `beforeInit` → 3. `init` → 4. `initDevice(device)` → 5. `afterInit` →
6. `beforeConnections` → 7. `connections` → 8. `connection(conn)` → 9. `afterConnections` →
10. `beforeProcess` → 11. `process(DeviceID)` → 12. `afterProcess` →
13. `beforeProcessPromise` → 14. `processPromise(DeviceID)` → 15. `afterProcessPromise` →
16. `beforeLoaded` → 17. `loaded`

Device events: `device.terminal`, `device.notify`, `device.event`, `device.alert`, `device.error`, `device.render`, `device.save`, `device.metric`, `device.terminate`, plus a container-maintained `device.status` — a full status snapshot (state `registered/started/stopped`, timestamps, last alert/error, counters) emitted on every state change.

Runtime stop events: `beforeStop` → `stop(DeviceID)` → `afterStop` (when the container stops a device).

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
ErrorManager.register(
  'MyVendor',          // group (component/domain) — common for the errors of this module
  'MY_SHORT_CODE',     // the short unique identifier (this is what make()/isCode() use; there is no separate "code" parameter in core 1.1.x)
  'A human-readable description',
  { param: Rule.string().description('…') }   // rules for the additional data
);

// Usage:
throw ErrorManager.make('MY_SHORT_CODE', { param: 'x' }).setTrace(new Error());
```

### ErrorManager / CoreError API (complete)

| Method | What |
|---|---|
| `ErrorManager.register(name, short, description, rules = {})` | register an error; an identical re-registration — silently ignored, a conflicting one (same `short`, different data) — throws `EM_CODE_EXISTS`. Note: there is **no** `code` parameter in core 1.1.x |
| `ErrorManager.registerMany(name, list)` | atomic bulk registration (`list` = array of `{ short, description, rules? }`); if any entry conflicts with a registered error or duplicates a `short` inside the list — nothing is registered and `EM_CODE_EXISTS` is thrown |
| `ErrorManager.make(short, additional = {})` → `CoreError` | create an error; the `additional` fields are added to the object |
| `ErrorManager.convert(error)` → `CoreError` | convert a plain `Error` |
| `ErrorManager.isCode(error, code)` → `bool` | match an error by its short identifier (`vShort`) |
| `ErrorManager.isError(error)` → `bool` | is the object a VRack error |
| `ErrorManager.getRegistered(short)` → `record \| null` | find a registration by `code`/`short` (marked `private` in `.d.ts` — use with care) |

**CoreError** (extends `Error`):
- fields: `vError`, `vShort` (the canonical identifier), `vAdd` (extra data keys), `vAddErrors` (nested errors). There is **no `vCode` field** in core 1.1.x (the `.d.ts` says so explicitly);
- methods: `setTrace(err)`, `add(err)` (a nested error), `import(obj)`, `export()`, `getUnknownProperty(field)` (TS helper for dynamic fields after an import), the static `CoreError.objectify(error)`.

Built-in codes of core: `EM_CODE_EXISTS`, `EM_CODE_NOT_FOUND`, `EM_ERROR_CONVERT`, `CTR_*` (the container, e.g. `CTR_IGNORE_SERVICE_AUTORELOAD`, `CTR_DEVICE_STOPPED`, `CTR_INPUT_HANDLER_NF`).

Service termination:

```js
this.terminate(new Error('I cannot go on like this'));
```

- Auto-reload kicks in only if **both** `meta.autoReload` **and** the global `autoReload` option of `ServiceManager` are on (the full condition, the exceptions, and the timer — [04-platform](./04-platform.md) § ServiceManager).
- To **forbid auto-reload** (a human needs to step in):

```js
const nError = ErrorManager.make('CTR_IGNORE_SERVICE_AUTORELOAD').add(err);
this.terminate(nError);
```

- Auto-reload **does not kick in anyway** for errors before the container is fully loaded:
  `CTR_CONF_EXTENDS_PROBLEM`, `CTR_ERROR_INIT_DEVICE`, `CTR_DEVICE_PROCESS_EXCEPTION`, `CTR_DEVICE_PROCESS_PROMISE_EXCEPTION`, `CTR_ERROR_INIT_CONNECTION`.
- Unhandled exceptions kill the service (`uncaughtTerminate: true` by default, an option of the `Service` device; disabled with `uncaughtTerminate: false`).

## Self-documentation

- The device's `description()` — markdown, visible in Manager.
- Fill in `.description()` for every port/option/metric/action.
- `default(v)` — the default value (applied); `example(v)` — an example for documentation (does not become a default). If you don't fill in `default` — fill in `example`.
- The service schema and the API are generated from the running code — the documentation is always up to date, nothing needs to be "documented by hand".

## TypeScript

- Sources — `src/*.ts`, the result — `devices/*.js` + `*.d.ts`; the mapping — `list.json` with paths (an example — the platform itself: `devices/vrack2`).
- Import: `import { Device, Port, Rule, Metric, Action, ErrorManager } from 'vrack2-core'`.
- For the IDE: autocompletion of the links to `vrack2-core/lib/...` gives the types (BasicPort, BasicType, BasicMetric).

## Exports of `require('vrack2-core')` (complete list)

A typical import for a device:

```js
const { Device, Port, Action, Rule, Metric, ErrorManager, CoreError } = require('vrack2-core');
```

All the names available in `require('vrack2-core')` — verified via `Object.keys(require('vrack2-core'))` (1.1.2): exactly this list; the `I*` types exist only in the `.d.ts` and are absent from the runtime:

| Group | Names |
|---|---|
| For devices (usually enough) | `Device`, `Port`, `Action`, `Rule`, `Metric`, `ErrorManager`, `CoreError` |
| Validation | `Validator` (`.validate(rules, data)`), `BasicType`, `SubruleNames` |
| Infrastructure | `ImportManager`, `Container`, `MainProcess`, `UniversalWorker`, `ReactiveRef`, `ServiceLoader` |
| Bootstrap | `Bootstrap`, `BootClass`, `DeviceFileStorage`, `DeviceManager`, `StructureStorage`, `DeviceMetrics` |
| Base types (ports) | `BasicPort`, `ReturnPort` (the port with `.return(rule)`), `StandardPort` / `StandartPort` (`@deprecated` aliases of the standard port) |
| Base types (actions/metrics) | `BasicAction`, `BasicMetric` |
| Device connections/ports | `DeviceConnect`, `DevicePort` |
| Storage (re-export of `vrack-db`) | `StorageTypes` (`Float`, `Uint64`, …) |
| Other | `EDeviceMessageTypes` |
