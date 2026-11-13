# Migrating vendors to `vrack2-core` 2.0.0

AI-facing brief for migrating or reviewing a vendor (`devices/<vendor>/`) in this workspace. Not prose: every line is an assertion, a command with its expected result, or a dated measured fact.

Ground truth: `node_modules/vrack2-core/lib/**/*.d.ts` and `node_modules/vrack2-core/CHANGELOG.md` (section `## 2026.11.12 — 2.0.0 (breaking)` and above). On any mismatch with this file, the `.d.ts` wins. All facts below verified 2026-11-13 against the installed core 2.0.0.

---

## 0. Two failure classes — `tsc` catches only one

| Class | What happens | Caught by `tsc`? | Examples |
|---|---|---|---|
| **API rename / removal** | the old name is gone from `.d.ts` → compile error | **yes** | `Port.standart`, `Rule….require`, `Metric.inS`, `BasicMetric` |
| **Hidden semantic / runtime-contract change** | the old code still **compiles** but is no longer called or no longer works | **no** | `preProcess()` is never called by the core; `this.error(str, rawError)` breaks the contract |

A `tsc`-green vendor may be silently degraded on 2.0.0. Never treat a clean typecheck as "migrated" — run the checklist in §9.

---

## 1. Migration recipe (per vendor)

1. **Migrate base vendors first.** Cross-vendor inheritance exists: `vrack2-other-rtu` extends `vrack2-modbus/devices/DeviceRTU`. A dependent vendor typechecked against a stale base `.d.ts` hides the real breakage.
2. `cd devices/<vendor> && npm install` — devDeps only (`@types/node`, `typescript`). `vrack2-core` is resolved from the workspace root (`node_modules/vrack2-core@2.0.0`), not installed into the vendor.
3. Typecheck without writing output: `npx --no-install tsc -p tsconfig.json --noEmit` → expected exit 0 after fixing **class 1** findings.
4. Hand-fix **class 2** items (§3–§7). `tsc` will not report them.
5. Rebuild the committed output: `npx --no-install tsc -p tsconfig.json` (`outDir: ./devices`). Never hand-edit `devices/*.js` — they are git-tracked and are what the platform loads.
   - Build-vs-source drift is a real failure mode (measured 2026-11-13): a committed `devices/Mixer.js` older than `src/Mixer.ts` named FX outputs `fx1.mix` while the code validated `fx1.mixed` → graph load failed with `CONT_CONNECTION_PORT_NF`, and production was running the stale build. After any source edit: `ls -la devices/<X>.js src/<X>.ts` — the build must be newer.
6. Review `git diff` of the build output; commit in **the vendor's own git repo** (each vendor is a separate repo); restart the worker/master to pick it up.
7. If the vendor has tests, run them from the vendor directory: `cd devices/<vendor> && npm test` → expected: `PASS` line per fixture, exit 0.

---

## 2. API renames and removals (class 1 — `tsc` reports these)

| `vrack2-core` 1.x | `vrack2-core` 2.0.0 | Where |
|---|---|---|
| `Port.standart()` | **`Port.standard()`** | port factory |
| `Rule.string().require()` (and `.require()` on other types) | **`.required()`** | `BasicType.required()` |
| `Metric.inS()` / `Metric.inMs()` | **`Metric.one()`** (`MetricOne`) | metric declaration |
| `Metric.inUs()` | **removed** | smallest unit is ms |
| `BasicMetric`, `IvS`, `IvMS` (exports) | **removed**; use `MetricOne` / `MetricGroup` | core exports |
| `Metric.one().description(x)` | **`Metric.one().descriptions(x)`** | `MetricOne` |
| `this.metric(path, value, modify?)` | **`this.metric(path, value)`** — two arguments | metric write |
| `beforeAction()` | **`onBeforeAction()`** | hook |
| `ErrorManager.register(name, code, short, description)` | **`register(name, short, description, rules?)`** | code registration |
| `CoreError.vCode` | **removed**; the canonical field is `vShort` | `ErrorManager.isCode()` |
| `Device.works` | **`Device.running`** | property |
| `DB_*` / `BS_*` / `CTR_*` error codes (`Container`, `ServiceLoader`, …) | **`DBL_*` / `BSL_*` / `SLDR_*` / `CONT_*`** — prefix = owning module | error codes |

Verified 2026-11-13: `grep -n "MetricOne\|MetricGroup" node_modules/vrack2-core/lib/index.d.ts` → present; `BasicMetric`, `inS`, `inUs` → absent. `running` is a **read-only getter derived from container state** (`Device.d.ts`), not a field a device assigns: stopping happens through `Container.stopDevice()` / `stopAll()`.

```ts
// 1.x
'di%d': Port.standart().dynamic(4).description('…')
name: Rule.string().require().description('…')

// 2.0.0
'di%d': Port.standard().dynamic(4).description('…')
name: Rule.string().required().description('…')
```

```ts
// 1.x
import { BasicMetric, Metric } from "vrack2-core";
metrics(): { [key: string]: BasicMetric } {
  const m: { [key: string]: BasicMetric } = {};
  for (const name in this.units) m[name] = Metric.inS().description(name);
  return m;
}

// 2.0.0
import { Metric, MetricOne } from "vrack2-core";
metrics(): { [key: string]: MetricOne } {
  const m: { [key: string]: MetricOne } = {};
  for (const name in this.units) m[name] = Metric.one().descriptions(name);
  return m;
}
// write: this.metric(name, value)   // modify is no longer an argument
```

```ts
// 2.0.0 — register once, throw by code (as already done in ModbusRTU.ts)
ErrorManager.register('ModbusRTU', 'V2MODBUS_CRC_CHECK_FAILED', 'CRC check failed');
throw ErrorManager.make('V2MODBUS_CRC_CHECK_FAILED');
```

---

## 3. `Device` lifecycle hooks (class 1 by name, class 2 by call)

Core 2.0.0 renamed the hooks **and stopped calling the old names**. Public 2.0.0 hooks (`service/Device.d.ts`):

```
prepareOptions() → onRegister() → onStart() → onStartAsync() … onStop() → onStopAsync()
                     ↑ device registration (Container calls onRegister())
```

Plus `onBeforeAction(action, data): boolean` and `onDestroy()` (internal/housekeeping).

| 1.x (core no longer calls it) | 2.0.0 (core calls it) |
|---|---|
| `preProcess()` | **`onRegister()`** |
| `process()` | **`onStart()`** |
| `processPromise()` | **`onStartAsync()`** |
| `stop()` | **`onStop()`** |
| `stopPromise()` | **`onStopAsync()`** |
| `beforeTerminate()` | **`onDestroy()`** (internal) |

> **Trap #1 — the nastiest one.** `grep -rn "preProcess" node_modules/vrack2-core/lib` → **no matches**: the core never calls it. A vendor that puts `shares` initialization or `addInputHandler(...)` in `preProcess()` compiles clean and degrades at runtime: `shares` stays `{}`, dynamic handlers are never attached, the first `update()` breaks. Fix: rename `preProcess()` → `onRegister()`.

---

## 4. `shares` and `render()` (class 2)

- Reactivity is **removed**: `shares` is a plain object; mutating it emits **nothing**. Call `this.render()` explicitly after changes (`Device.d.ts`: `render(): boolean`).
- Removed helpers: `attachSharesRender()`, `detachSharesRender()`, `sharesSnapshot()` — verified absent from `lib/`.
- `this.shares` is no longer a `Proxy`: `render()` emits a **live reference**. A subscriber must treat `trace` as read-only and clone it (`structuredClone`) before serializing.
- Initialization, both valid:

```ts
// class field (preferred: the shape gets typed)
shares = { online: false, di: [0, 0] }

// or assignment in onRegister()
onRegister(): void { this.shares = { online: false, di: [0, 0] } }
```

- `shares: any = { … }` as a class field still compiles; type it instead (drop `: any`).

---

## 5. Device errors and events (class 2 — the `this.error` contract)

2.0.0 signatures (`service/Device.d.ts`, identical shape for `notify`, `alert`, `error`):

```ts
error(data: string, trace: { [key: string]: any }, ...args)
```

Canon: a stable event name in `data`, payload in `trace`, the original error wrapped as a **coded** error via `ErrorManager.make('CODE', {fields}).add(originalError)`, the code registered for the owning module. Never pass a raw `Error` as `trace` for expected failures.

```ts
// 1.x — contract violation on 2.0.0
} catch (err) {
  this.error('Update device error', err as Error)
}

// 2.0.0 — canon
import { ErrorManager, Rule } from "vrack2-core";
ErrorManager.register('DeviceRTU', 'V2MODBUS_UPDATE_ERROR',
  'Modbus RTU device update cycle failed — the device is marked offline', {
  id: Rule.string().example('device-1').description('Device id'),
  address: Rule.number().required().example(1).description('Modbus slave address'),
})
// …
} catch (err) {
  this.error('modbus rtu update failed',
    ErrorManager.make('V2MODBUS_UPDATE_ERROR', { id: this.id, address: this.options.address })
      .add(err as Error))
}
```

---

## 6. Boot classes and metrics (class 2 — defaults changed)

`MainProcess.DEFAULT_BOOTLIST` is exactly (verified 2026-11-13, `MainProcess.js`):

```js
{ DeviceManager:   { path: 'vrack2-core.DeviceManager',      options: { storageDir: './storage' } },
  DeviceStorage:   { path: 'vrack2-core.DeviceFileStorage',  options: {} },
  StructureStorage:{ path: 'vrack2-core.StructureStorage',   options: {} } }
```

`JournalDbMetrics` (metrics), `ServiceLogger` and `PortLogger` are now **opt-in**: declare them in the `bootstrap` section of `service.json` or the conf file. Without them the events are still emitted but nothing listens, and `./journals` is never created. A standalone service that relied on metrics "out of the box" must add the boot class explicitly.

Bootstrap merge order, lowest to highest priority: `DEFAULT_BOOTLIST` → `service.bootstrap` (the conf-file section is merged in here by `ServiceLoader.fillConfFile()`) → constructor `config.bootstrap`.

Metrics model: one table per service (`metrics { ts, dev, met, value }`); a declaration is metadata (wildcard groups: `Metric.group().list()`); writing an unregistered metric name is silent; `retention` is a boot-class option, not a metric option.

---

## 7. Other hidden changes (class 2)

- **Out of the public contract:** `ServiceLoader.addDevice()/removeDevice()/addConnection()`, `Container.startDevice()/removeDevice()/addConnection()`. They still exist in the code — do not depend on them, signatures may change without notice. `Container.stopDevice()` / `startDevice()` are what the platform (and `run/run-test.js`) use; `startDevice` is marked `@internal` in the core.
- **`device.port` event + `noCapture()`:** every **output** port emits `device.port` on each `push` (`{ device, data: portName, trace: data }`) unless declared `Port.standard().noCapture()`. Input ports never emit it.
- **Resource registry:** `publish` / `resolve` maps in `service.json`, `Device.publish(key, val)` / `Device.resolve(key)`. Only relevant if the vendor used them.

---

## 8. Workspace state (measured 2026-11-13)

| vendor | own version | `tsc --noEmit` on core 2.0.0 | vendor tests | notes |
|---|---|---|---|---|
| `vrack2-basic` | 2.0.0 | exit 0 | `npm test` → 11 fixtures, all `PASS` | rebuilt after build-vs-src drift was found; committed and pushed (`8bd890f`); 11 cards in `cards/` |
| `vrack2-modbus` | 1.0.0 (own version not bumped) | exit 0 | none | migrated first (it is the base); `preProcess()` → `onRegister()` in `DeviceRTU`, `Example1`, `UniversalDI`, `UniversalDO`; `this.error('Update device error', err)` → `ErrorManager.make('V2MODBUS_UPDATE_ERROR',{id,address}).add(err)`; `UniversalDO` is git-untracked and absent from `list.json` → not published |
| `vrack2-other-rtu` | 0.0.1 (not bumped) | exit 0 | none | extends `vrack2-modbus/DeviceRTU`; `Port.standart` → `Port.standard`, `.require()` → `.required()`, `Metric.inS().description()`/`BasicMetric` → `Metric.one().descriptions()`/`MetricOne`; `shares` field → hook initialization; `preProcess()` → `onRegister()` in 5 devices |

---

## 9. Per-vendor checklist

Run against `vrack2-basic`, `vrack2-modbus`, `vrack2-other-rtu` on 2026-11-13: every grep below returned 0 matches, and both `tsc --noEmit` runs exited 0.

- [ ] `npx --no-install tsc -p tsconfig.json --noEmit` → exit 0
- [ ] `grep -rn "preProcess" src` → empty (or a base vendor calling it deliberately — it is never core-driven)
- [ ] `grep -rn "standart()\|\.require()\|Metric\.in\|BasicMetric\|beforeAction" src` → empty
- [ ] `grep -rn "this\.error('[^']*', *err" src` → empty (the greedy `this\.error(.*err` is a bad check: it also matches the canonical `…make(CODE).add(err)` — measured against `vrack2-modbus`); only `ErrorManager.make(CODE, {…}).add(err)`
- [ ] `shares` initialized (class field or `onRegister()`); every mutation followed by `render()`
- [ ] `this.metric(name, value)` — two arguments
- [ ] `devices/*.js` + `devices/*.d.ts` rebuilt by `tsc`, not hand-edited; `ls -la devices/<X>.js src/<X>.ts` → build newer than source
- [ ] base vendor migrated before the dependent one
- [ ] standalone services: metric/logger boot classes declared in `bootstrap` where behavior is expected
- [ ] committed in the vendor's own git repo; `npm test` in the vendor dir where tests exist
- [ ] worker/master restarted to pick up the new build
