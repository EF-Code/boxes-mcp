# Input controls: support, examples, and evidence

This document is the operational companion to the interaction implementation. It
intentionally separates source-level and local-process verification from proof that
requires a live libvirt domain, QEMU monitor, SPICE channel, guest agent, or target
application.

## Safety boundary

Interaction operations accept typed fields only. They do not expose shell commands,
raw virsh flags, QMP JSON, SPICE protocol messages, helper arguments, guest commands,
or arbitrary transfer destinations. New operations require a running domain and use
stable capability/error codes when the external backend is unavailable.

The opt-in live suite requires all of these values, with no default VM selection:

```text
BOXES_INTEGRATION=1
BOXES_TEST_VM=<explicit-domain-name>
BOXES_TEST_VM_DISPOSABLE=1
```

Transfer and drag evidence additionally require `BOXES_TRANSFER_ROOT` and
`BOXES_TEST_SOURCE_PATH`. Guest-agent-disconnect coverage requires an operator to
manually disconnect `spice-vdagent` in that disposable guest and set
`BOXES_TEST_AGENT_DISCONNECTED=1`; the harness never stops a guest service itself.

## Request and response examples

These are shapes, not claims that the corresponding live dependency is available.

### Capabilities

Request:

```json
{
  "nameOrUuid": "ubuntu-24.04",
  "probeQmp": true,
  "probeSpice": true
}
```

Response fields include observed state rather than configuration-only claims:

```json
{
  "nameOrUuid": "ubuntu-24.04",
  "display": { "protocol": "spice", "host": "127.0.0.1", "port": 5900 },
  "backends": {
    "qmp": { "state": "connected" },
    "spice": { "state": "connecting" },
    "clipboard": { "state": "agent-disconnected" },
    "fileTransfer": { "state": "capability-missing" }
  }
}
```

States are `unconfigured`, `configured`, `connecting`, `connected`,
`agent-disconnected`, and `capability-missing`. A configured helper is not reported as
connected until the helper status operation observes the required channels.

### Screenshot

Request:

```json
{ "nameOrUuid": "ubuntu-24.04", "screen": 0, "backend": "libvirt" }
```

The MCP response contains an image content block, for example
`{ "type": "image", "mimeType": "image/png", "data": "..." }`. Temporary paths
are not returned. Public backend values are currently only `auto` and `libvirt`.

### Keyboard

Request:

```json
{ "nameOrUuid": "ubuntu-24.04", "keys": ["CTRL", "ALT", "DELETE"], "holdMs": 100 }
```

Successful response:

```json
{ "ok": true, "backend": "virsh", "keys": ["CTRL", "ALT", "DELETE"], "holdMs": 100 }
```

The complete canonical allowlist is `ALT`, `BACKSPACE`, `CAPSLOCK`, `CTRL`, `DELETE`,
`DIGIT_0` through `DIGIT_9`, `DOWN`, `END`, `ENTER`, `ESC`, `ESCAPE`, `F1` through
`F12`, `HOME`, `INSERT`, `LEFT`, `META`, `NUMLOCK`, `PAGEDOWN`, `PAGEUP`, `PAUSE`,
`PRINT`, `RIGHT`, `SHIFT`, `SPACE`, `SUPER`, `TAB`, `UP`, and `A` through `Z`.
Names are accepted case-insensitively and returned canonically; duplicate names are
rejected. The fixed codeset is Linux, so guest keyboard layout affects the resulting
character.

### Mouse

Request:

```json
{
  "nameOrUuid": "ubuntu-24.04",
  "action": "click",
  "x": 0.42,
  "y": 0.68,
  "coordinateSpace": "normalized",
  "button": "left",
  "backend": "auto"
}
```

The response identifies the backend and coordinate context:

```json
{
  "ok": true,
  "backend": "qmp",
  "action": "click",
  "display": "spice://127.0.0.1:5900",
  "head": 0,
  "qmpDevice": "QEMU USB Tablet"
}
```

`auto` chooses SPICE only after status proves main, display, inputs, and geometry are
ready. Otherwise it probes QMP and requires `input-send-event` plus an absolute
pointer. A requested operation never switches backend after sending its first event.
Standalone button-down/button-up actions are intentionally absent until persistent
state can guarantee cleanup. Clicks and drag cleanup release held buttons exactly once
within the helper's operation.

### Clipboard

Read:

```json
{ "nameOrUuid": "ubuntu-24.04", "operation": "read", "selection": "clipboard" }
```

Write:

```json
{
  "nameOrUuid": "ubuntu-24.04",
  "operation": "write",
  "selection": "clipboard",
  "text": "hello from the host"
}
```

The operation is UTF-8 text only and uses the actual SPICE agent grab/request,
notify, and release signals. A write completion has the shape
`{ "backend": "spice", "completed": true }`; a read independently validates the
returned UTF-8 byte count. The host desktop clipboard is not changed by this tool.

### File transfer and drag/drop

The typed `file.transfer` operation is an internal helper operation used by the
drag/drop path; it is not exposed as arbitrary MCP passthrough. The helper completion
must report the exact source byte count:

```json
{
  "transportCompleted": true,
  "bytes": 1234
}
```

The source must be a readable regular file beneath `BOXES_TRANSFER_ROOT`, with no
symlink escape, and within `BOXES_MAX_TRANSFER_BYTES`. The result describes transport
completion, not guest application acceptance.

Drag/drop request:

```json
{
  "nameOrUuid": "ubuntu-24.04",
  "sourcePath": "/approved-root/report.pdf",
  "x": 0.50,
  "y": 0.40,
  "coordinateSpace": "normalized",
  "timeoutMs": 30000
}
```

Drag/drop response:

```json
{
  "ok": true,
  "backend": "spice",
  "source": { "basename": "report.pdf", "bytes": 1234 },
  "result": {
    "transferCompleted": true,
    "mouseReleased": true,
    "applicationAccepted": "unknown",
    "evidence": [
      "SPICE file-transfer completion observed",
      "SPICE pointer release observed"
    ],
    "postActionScreenshot": { "captured": false, "errorCode": "SPICE_UNAVAILABLE" }
  }
}
```

The native helper currently coordinates completed SPICE file transfer with a bounded
pointer press/move/release sequence. It does not claim that a target application
accepted the drop. A real viewer/desktop harness is required to change
`applicationAccepted` from `unknown`.

## Evidence matrix

| Boundary | Source and focused tests | Local/native proof | Live proof | Status |
| --- | --- | --- | --- | --- |
| Capability XML and state mapping | `src/capabilities.ts`, `src/capabilities.test.ts`, `src/display.test.ts` | Mocked libvirt/QMP/SPICE status | Active `ubuntu24.04` XML and structured capability snapshot | VERIFIED |
| Screenshot | `src/screenshot.ts`, `src/screenshot.test.ts` | Mocked virsh, bounded artifact cleanup and failure paths | `virsh screenshot` against named disposable VM | VERIFIED |
| Keyboard | `src/keyboard.ts`, `src/keyboard.test.ts` | Mocked exact virsh argument arrays and errors | Harmless `ESC` against named disposable VM | VERIFIED |
| QMP mouse | `src/qmp.ts`, `src/mouse.ts`, `src/qmp.test.ts`, `src/mouse.test.ts` | Mocked query/event JSON and absolute-pointer rejection | QMP discovery and movement on disposable VM | VERIFIED |
| Persistent TypeScript helper | `src/spice.ts`, `src/spice.test.ts` | Local persistent fake helper, correlation, crash, timeout, malformed/oversized frames | Real SPICE endpoint | IMPLEMENTED-UNVERIFIED-LIVE |
| Native helper framing/session | `native/spice-helper.c`, `src/native-helper.test.ts` | Native compile and local process malformed/status failure checks | Real SPICE channel | IMPLEMENTED-UNVERIFIED-LIVE |
| SPICE mouse | Native inputs channel and `src/mouse.ts` | Typed status/result validation and source build | Real inputs channel and visible target | IMPLEMENTED-UNVERIFIED-LIVE |
| Guest-agent clipboard | Native agent callbacks, `src/clipboard.ts`, `src/clipboard.test.ts` | Reducer fixtures and helper protocol failure boundary | Both directions plus manually disconnected-agent error | IMPLEMENTED-UNVERIFIED-LIVE |
| SPICE file transfer | Native async file-copy path, `src/transfer.ts`, `src/transfer.test.ts` | Path confinement, exact completion validation, native build | Disposable Linux guest destination semantics | IMPLEMENTED-UNVERIFIED-LIVE |
| Drag/drop | Native coordinator, `src/drag-drop.ts`, `src/drag-drop.test.ts` | State/evidence fixtures and cleanup path | Real target application acceptance | BLOCKED-LIVE |
| Opt-in harness | `src/integration.test.ts` | Safe default: 9 live tests skipped | Explicit disposable VM: 4 passed, 5 honest skips | VERIFIED |

## Current live-boundary result

The live runs used explicitly named, explicitly disposable domains on
`qemu:///session`:

- `ubuntu24.04`, title `Kali`, Boxes `os-state=live`, attached Kali Live ISO;
- `archlinux`, title `Omarchy`, Boxes `os-state=installed`, attached Omarchy 4.0.0 ISO.

No VM definition was changed and no guest service was stopped.

Environment and dependency evidence:

```text
virsh --version                         12.6.0
qemu-system-x86_64 --version            QEMU 11.0.3
spice-client-glib-2.0                   0.42
json-glib-1.0                           1.10.8
gio-unix-2.0                            2.88.3
node/npm                                v26.7.0 / 12.0.2
```

Observed live operations:

```text
libvirt screenshot                      PASS on ubuntu24.04 and archlinux
virsh send-key ESC                      PASS on ubuntu24.04 and archlinux
QMP query-commands/query-mice           PASS on ubuntu24.04 and archlinux
QMP normalized move                     PASS on ubuntu24.04 and archlinux (0.5, 0.5; backend=qmp)
SPICE mouse                             SKIPPED: no usable display endpoint
SPICE clipboard                         SKIPPED: no usable display endpoint
SPICE file transfer                     SKIPPED: no approved source/root and no usable endpoint
drag/drop                               SKIPPED: no approved source/root/target and no usable endpoint
guest-agent disconnect                  SKIPPED: not manually staged
```

The exact SPICE boundary blocker is reproducible:

```text
virsh -c qemu:///session domdisplay archlinux
error: No graphical display found
```

Both active XML documents contain
`<graphics type='spice'><listen type='none'/></graphics>` and a connected
`com.redhat.spice.0` channel. The fixed QMP `query-spice` probe for `archlinux`
reported SPICE enabled with Unix channels but no usable URI/path; the structured
capability result was `qmp=connected`, `spice=unconfigured`, and
`clipboard/fileTransfer=capability-missing`. Therefore the implementation does not
infer SPICE readiness from XML or the agent channel alone; clipboard, file-transfer,
and SPICE mouse remain unverified at the real SPICE boundary. `spice-gtk-3.0`,
`remote-viewer`, and `virt-viewer` are unavailable on this host.

The remaining blocked live work requires a reachable SPICE endpoint (or an
authorized libvirt graphics-FD integration), an approved confined transfer fixture,
and a controlled target application if application-level drag acceptance is required.
