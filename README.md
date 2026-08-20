# boxes-mcp

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](.)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A lightweight Model Context Protocol (MCP) server that enables Claude Code to manage GNOME Boxes virtual machines through libvirt/virsh. Provides safe, reversible VM operations with comprehensive snapshot management.

## Features

- 🖥️ **VM Lifecycle Management** - Start, stop, reboot, suspend, and resume VMs
- 📸 **Snapshot Operations** - Create, list, revert, and delete VM snapshots
- 🔍 **VM Discovery** - List and inspect all VMs with detailed information
- 🔒 **Safe Operations** - Storage preservation by default, no destructive actions
- 🎯 **GNOME Boxes Compatible** - Works seamlessly with GNOME Boxes VMs
- 🖱️ **Controlled Interaction** - Screenshot, allowlisted keyboard, and typed mouse tools
- 🔌 **Capability-Gated SPICE** - Optional native helper protocol for SPICE input, clipboard, and transfer
- ⚡ **Fast & Lightweight** - Minimal overhead, direct virsh integration

## Quick Start

### Prerequisites

- Ubuntu 22.04/24.04 (or compatible Linux distribution)
- libvirt-daemon-system, qemu-kvm installed
- Node.js 18+ and npm
- User in `libvirt` and `kvm` groups
- `virsh` available on `PATH` for lifecycle, screenshot, keyboard, and QMP fallback operations

SPICE-backed tools additionally require a SPICE display, a guest virtio-serial agent
channel, and a running `spice-vdagent` (or equivalent guest agent). Build the optional
native helper only when the host provides `spice-client-glib`, `json-glib`, and GLib
development files:

```bash
npm run build:spice-helper
BOXES_SPICE_HELPER="$PWD/native/boxes-spice-helper" npm test
```

The helper is not installed or selected automatically. Set `BOXES_SPICE_HELPER` only
to the reviewed executable built from this repository or another process implementing
the versioned protocol below.

```bash
# Install dependencies
sudo apt install -y libvirt-daemon-system qemu-kvm virt-manager

# Add your user to required groups
sudo usermod -aG libvirt,kvm "$USER"
newgrp libvirt
```

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/boxes-mcp.git
cd boxes-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Configuration

Add to your Claude Code config (`~/.claude/config.json`):

```json
{
  "mcpServers": {
    "boxes": {
      "command": "node",
      "args": ["/absolute/path/to/boxes-mcp/dist/src/index.js"],
      "env": {
        "LIBVIRT_URI": "qemu:///system",
        "BOXES_INPUT_BACKEND": "auto"
      }
    }
  }
}
```

## Available Tools

### VM Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `boxes.list` | List all VMs | - |
| `boxes.info` | Get VM details | `nameOrUuid: string` |
| `boxes.start` | Start a VM | `nameOrUuid: string` |
| `boxes.shutdown` | Shutdown VM (graceful) | `nameOrUuid: string, force?: boolean` |
| `boxes.reboot` | Reboot a VM | `nameOrUuid: string` |
| `boxes.suspend` | Suspend a VM | `nameOrUuid: string` |
| `boxes.resume` | Resume suspended VM | `nameOrUuid: string` |
| `boxes.undefine` | Remove VM (keeps storage) | `nameOrUuid: string, keepStorage?: boolean` |
| `boxes.display` | Get SPICE/VNC address | `nameOrUuid: string` |

### Snapshot Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `boxes.snapshots.list` | List VM snapshots | `nameOrUuid: string` |
| `boxes.snapshots.create` | Create snapshot | `nameOrUuid: string, snapshot: string, description?: string` |
| `boxes.snapshots.revert` | Revert to snapshot | `nameOrUuid: string, snapshot: string` |
| `boxes.snapshots.delete` | Delete snapshot | `nameOrUuid: string, snapshot: string` |

### Display and interaction

| Tool | Description | Parameters |
|------|-------------|------------|
| `boxes.screenshot` | Capture a running domain display as MCP image content | `nameOrUuid, screen?: number, backend?: auto|libvirt` |
| `boxes.keyboard` | Send a bounded allowlisted Linux key sequence through virsh | `nameOrUuid, keys: string[], holdMs?: number` |
| `boxes.mouse` | Send typed move/button/click/scroll input | `nameOrUuid, action, x, y, coordinateSpace?, button?, width?, height?, deltaX?, deltaY?, backend?` |
| `boxes.clipboard` | Explicit UTF-8 clipboard read/write through the SPICE helper | `nameOrUuid, operation, selection?, text?` |
| `boxes.drag_drop` | Experimental confined transfer plus pointer sequence and separate evidence | `nameOrUuid, sourcePath, x, y, coordinateSpace?, width?, height?, timeoutMs?` |

Interaction tools never accept shell fragments, raw QMP JSON, arbitrary virsh
flags, guest commands, or arbitrary transfer destinations. New operations require
a running domain and return a stable capability/error code when their backend is
not available.

### Optional environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIBVIRT_URI` | `qemu:///system` | Libvirt connection used by every domain operation |
| `BOXES_INPUT_BACKEND` | `auto` | Default mouse backend preference: `auto`, `spice`, or `qmp` |
| `BOXES_SPICE_HELPER` | unset | Explicit executable implementing the versioned SPICE helper protocol |
| `BOXES_SPICE_OPERATION_TIMEOUT_MS` | `30000` | Maximum one helper request duration |
| `BOXES_ARTIFACT_DIR` | process temp directory | Controlled parent directory for temporary screenshots |
| `BOXES_MAX_SCREENSHOT_BYTES` | `20971520` | Screenshot payload limit |
| `BOXES_TRANSFER_ROOT` | unset | Required canonical host root for drag/drop source files |
| `BOXES_MAX_TRANSFER_BYTES` | `104857600` | Transfer source size limit |
| `BOXES_MAX_CLIPBOARD_BYTES` | `1048576` | UTF-8 clipboard payload limit |

`BOXES_TRANSFER_ROOT` is deliberately required rather than inferred. Paths are
canonicalized and symlink escapes, directories, and special files are rejected.

`boxes.capabilities` reports observed states. Configuration alone is not treated as
connected: use `probeQmp: true` and/or `probeSpice: true` when an external status
probe is required. SPICE clipboard and transfer require a connected guest agent;
`boxes.drag_drop` reports `applicationAccepted: "unknown"` unless an external viewer
harness supplies application-level evidence.

Keyboard input uses one fixed Linux virsh codeset. Public key names are
case-insensitive and canonicalized to uppercase, but each key may occur only once
per bounded chord. The allowlist is: `ALT`, `BACKSPACE`, `CAPSLOCK`, `CTRL`,
`DELETE`, `DIGIT_0` through `DIGIT_9`, `DOWN`, `END`, `ENTER`, `ESC`, `ESCAPE`,
`F1` through `F12`, `HOME`, `INSERT`, `LEFT`, `META`, `NUMLOCK`, `PAGEDOWN`,
`PAGEUP`, `PAUSE`, `PRINT`, `RIGHT`, `SHIFT`, `SPACE`, `SUPER`, `TAB`, `UP`,
and `A` through `Z`. Guest keyboard layout determines the resulting character;
the key allowlist does not guarantee text independent of that layout.

## Usage Examples

### With Claude Code

```
User: "List all my VMs"
Claude: [Uses boxes.list tool]

User: "Start ubuntu-24.04"
Claude: [Uses boxes.start with nameOrUuid="ubuntu-24.04"]

User: "Create a snapshot called 'before-update' for my fedora VM"
Claude: [Uses boxes.snapshots.create]
```

### Direct Usage

```bash
# Run the MCP server
LIBVIRT_URI=qemu:///system node dist/src/index.js
```

## Development

### Project Structure

```
boxes-mcp/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── tools.ts          # Side-effect-free tool registry and handler boundary
│   ├── libvirt.ts        # virsh operations & parsers
│   ├── virsh.ts          # Shared executable and libvirt URI arguments
│   ├── exec.ts           # Safe command execution
│   ├── screenshot.ts     # Controlled libvirt screenshot capture
│   ├── keyboard.ts       # Allowlisted virsh send-key adapter
│   ├── mouse.ts/qmp.ts   # Typed mouse actions and QMP fallback
│   ├── spice.ts          # Versioned companion-helper protocol client
│   ├── clipboard.ts      # Explicit SPICE clipboard orchestration
│   ├── transfer.ts       # Confined host-file validation
│   ├── drag-drop.ts      # Experimental transfer/input coordination
│   ├── *.test.ts         # Unit tests
├── systemd/
│   └── boxes-mcp.service # Systemd user service
├── dist/                 # Compiled JavaScript
├── coverage/             # Test coverage reports
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

**Local test coverage**: the current checkout runs 80 passing tests and 9 gated live
tests skipped by default. The default suite is safe to run without libvirt access.

- `exec.ts`: 100% statements
- `libvirt.ts`: 81.3% statements, 92.85% branches
- Interaction validation, command construction, QMP response mapping, artifact cleanup,
  helper framing, capability discovery, and path-confinement tests

Run the explicit local native-helper process checks with:

```bash
npm run test:spice-helper
```

Run the disposable-VM suite only with all three safety variables set:

```bash
BOXES_INTEGRATION=1 \
BOXES_TEST_VM=an-explicit-disposable-domain \
BOXES_TEST_VM_DISPOSABLE=1 \
npm run test:integration
```

The live suite never selects a listed VM, changes VM definitions, or stops a guest
service. Guest-agent disconnect coverage requires the operator to manually disconnect
`spice-vdagent` in the explicitly disposable guest and add
`BOXES_TEST_AGENT_DISCONNECTED=1`.

The default suite is mocked/local: it does not prove that QMP, SPICE, clipboard,
or drag-and-drop works against a real VM. Live tests must be opt-in and target a
specifically named disposable VM with snapshots; no arbitrary first-listed domain
is ever selected by the interaction tools.

### Building

```bash
# Build TypeScript
npm run build

# Watch mode for development
npm run dev
```

## Systemd Service

Install as a user service for automatic startup:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/boxes-mcp.service ~/.config/systemd/user/
sed -i "s|%h/projects/virtmcp|$HOME/boxes-mcp|g" ~/.config/systemd/user/boxes-mcp.service
systemctl --user daemon-reload
systemctl --user enable --now boxes-mcp
journalctl --user -fu boxes-mcp
```

## Security Considerations

- ✅ **Sandboxed Execution**: Uses Node.js `execFile` with timeout and buffer limits
- ✅ **No Arbitrary Commands**: Only predefined virsh operations allowed
- ✅ **Typed Input Boundary**: QMP commands and SPICE operations are internal enums with validated arguments
- ✅ **Bounded Payloads**: Key counts, hold durations, coordinates, scroll deltas, screenshots, clipboard, and transfers are capped
- ✅ **Path Confinement**: Drag/drop sources must remain beneath `BOXES_TRANSFER_ROOT` after canonicalization
- ✅ **Storage Preservation**: VM storage not deleted by default
- ✅ **LIBVIRT_URI Isolation**: Respects environment-specified libvirt connection
- ⚠️ **Permissions Required**: User must have libvirt group membership
- ⚠️ **Network Exposure**: Not designed for remote access without additional security
- ⚠️ **Expanded Control Surface**: Screenshots and guest clipboard data are untrusted; keep the MCP server on local stdio
- ⚠️ **SPICE Helper Trust**: The helper executable is an explicit host dependency and must not log credentials, clipboard contents, or file contents

### SPICE helper protocol

The TypeScript server starts one persistent helper child and sends newline-delimited
version-1 JSON requests over stdin, correlating responses by request ID. The helper is
called with an explicit executable path and no caller-controlled arguments. The
request envelope is shaped like:

```json
{
  "version": 1,
  "id": "request-123",
  "operation": "clipboard.read",
  "domain": "guest-name",
  "display": { "uri": "spice://127.0.0.1:5900" },
  "arguments": { "selection": "clipboard", "maxBytes": 1048576 }
}
```

Supported operation names are internal (`status`, `mouse`, `clipboard.read`,
`clipboard.write`, `file.transfer`, and `drag-drop`). A helper error is mapped to a
stable MCP error such as `SPICE_AGENT_DISCONNECTED`, `SPICE_CAPABILITY_MISSING`, or
`SPICE_UNAVAILABLE`. Payloads, lines, pending requests, transfer sizes, clipboard
bytes, and operation time are bounded. Progress events never complete a request.
The helper does not log clipboard contents, file contents, SPICE tickets, or
credentials.

### Capability matrix

| Capability | Libvirt/virsh | QMP fallback | SPICE helper |
|------------|---------------|--------------|--------------|
| Screenshot | Implemented via `virsh screenshot` | Not used | Adapter reserved, unavailable without helper |
| Keyboard | Implemented via allowlisted `virsh send-key` | Not used | Not used |
| Mouse | Not used | Typed `input-send-event` after QMP discovery | Selected by `auto` only after helper status proves channels and geometry |
| Clipboard | Not available | Not available | Real agent protocol in native helper; live guest-agent proof pending |
| File transfer | Not available | Not available | Real SPICE async file-copy path in native helper; live guest proof pending |
| Drag-and-drop | Not available | Not available | Experimental transfer + pointer evidence; application acceptance remains unknown |

See [the interaction evidence matrix](docs/INPUT_CONTROLS_EVIDENCE.md) for the
boundary-by-boundary status and exact local/live proof distinction.

## Troubleshooting

### No VMs Listed

```bash
# Check libvirt URI
virsh -c qemu:///system list --all
virsh -c qemu:///session list --all

# Verify permissions
groups  # Should include 'libvirt' and 'kvm'
```

### Permission Denied

```bash
# Re-add to groups and re-login
sudo usermod -aG libvirt,kvm "$USER"
# Then logout/login or:
newgrp libvirt
```

### VMs Not Showing in Boxes

Open `virt-manager` and check which connection your VMs use:
- System connection: `qemu:///system`
- User session: `qemu:///session`

Set `LIBVIRT_URI` environment variable accordingly.

### SPICE capability errors

Use `boxes.capabilities` with `probeSpice: true` and inspect the returned state:

- `configured`: a reviewed helper and SPICE endpoint are configured, but connection
  proof has not been requested;
- `connecting`: the helper observed an incomplete channel set;
- `connected`: the required channels are connected;
- `agent-disconnected`: the guest agent is absent or does not announce clipboard;
- `capability-missing`: the backend, channel, helper, or guest capability is absent.

Check the host dependencies and helper directly without sending input to a VM:

```bash
pkg-config --modversion spice-client-glib-2.0 json-glib-1.0 gio-unix-2.0
npm run build:spice-helper
```

The helper's local protocol test intentionally connects to `127.0.0.1:1` and
expects a typed unavailable/disconnected result. That is not live SPICE proof.

## Roadmap

- [ ] VM creation via `virt-install` integration
- [ ] Network management (`virsh net-list`, port forwarding)
- [ ] Storage pool information (`virsh vol-list`)
- [ ] VM import from OVA/QCOW2
- [ ] Remote libvirt connection support
- [ ] Performance metrics and monitoring

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built for [Claude Code](https://claude.com/claude-code)
- Uses [Model Context Protocol SDK](https://github.com/anthropics/mcp)
- Integrates with [libvirt](https://libvirt.org/) virtualization API

## Support

- **Issues**: [GitHub Issues](https://github.com/your-org/boxes-mcp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/boxes-mcp/discussions)
- **Documentation**: [Project Wiki](https://github.com/your-org/boxes-mcp/wiki)

---

**Made with ❤️ for the Claude Code community**
