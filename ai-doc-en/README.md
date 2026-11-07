# AI-DOCS (English) — a quick VRack2 guide for AI

These docs are meant to give an AI a working context on VRack2 in 5–10 minutes, without reading all the source code. Written concretely, code-first, without "about the platform in general" fluff.

## How to read

| I have a task to… | Start with |
|---|---|
| …start working NOW — AI quickstart: tools, workflows, traps | [00-ai-start](./00-ai-start.md) |
| …understand what is going on at all | [01-basics](./01-basics.md) |
| …create / modify a service | [02-service](./02-service.md) |
| …write a device (component), the core API | [03-device](./03-device.md) |
| …understand the platform (API, service startup, events) | [04-platform](./04-platform.md) |
| …quickly check a rule / command / name | [05-cheatsheet](./05-cheatsheet.md) |

## What's not here

- The depths of vrack2-core (Container/Bootstrap internals) — only what's needed to develop devices and services.
- **The full public API of vrack2-core is here** (in [03-device](./03-device.md)): `Device` properties/hooks/methods, the full `Rule`/`Port`/`Action`/`Metric` API, `ErrorManager`/`CoreError`, the `BootDatabase`/`getDB()` API, the export list. **Verified against the installed `vrack2-core` (API table = `node_modules/vrack2-core/docs/11-API.md`, CHANGELOG 2026.09.29; re-checked 02.10.2026)** — you can write devices without opening `node_modules`; the ultimate source on any mismatch — `node_modules/vrack2-core/lib/*.d.ts`.
- The unified metrics journal (vrack2-journal-db) — a couple of paragraphs in [03-device](./03-device.md) and [04-platform](./04-platform.md).
- VRack2 Manager (the web UI) — a couple of paragraphs in [04-platform](./04-platform.md).

## Deep documentation (source docs)

All files below **exist in this repository** (checked 02.10.2026):

| Question | File |
|---|---|
| Introduction, philosophy | `devices/vrack2/docs/Introduction.md` |
| Service files | `devices/vrack2/docs/ServiceFile.md` |
| Devices (full API) | `devices/vrack2/docs/Devices.md` |
| Design principles | `devices/vrack2/docs/Service.md` |
| I²C / Serial / workers | `devices/vrack2/docs/LLHardware.md` |
| API (WS, auth) | `devices/vrack2/docs/Api.md` |
| System events | `devices/vrack2/docs/SystemEvents.md` |
| Errors | `devices/vrack2/docs/Errors.md` |
| First service | `devices/vrack2/docs/FirstService.md` |
| Installation / environment | `devices/vrack2/docs/Install.md`, `devices/vrack2/docs/DevelopmentEnvironment.md` |
