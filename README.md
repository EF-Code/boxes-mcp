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
- ⚡ **Fast & Lightweight** - Minimal overhead, direct virsh integration

## Quick Start

### Prerequisites

- Ubuntu 22.04/24.04 (or compatible Linux distribution)
- libvirt-daemon-system, qemu-kvm installed
- Node.js 18+ and npm
- User in `libvirt` and `kvm` groups

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
        "LIBVIRT_URI": "qemu:///system"
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
│   ├── libvirt.ts        # virsh operations & parsers
│   ├── exec.ts           # Safe command execution
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

**Test Coverage**: 33 tests, 100% passing

- `exec.ts`: 100% statements
- `libvirt.ts`: 81.3% statements, 92.85% branches
- Comprehensive unit and integration tests

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
- ✅ **Storage Preservation**: VM storage not deleted by default
- ✅ **LIBVIRT_URI Isolation**: Respects environment-specified libvirt connection
- ⚠️ **Permissions Required**: User must have libvirt group membership
- ⚠️ **Network Exposure**: Not designed for remote access without additional security

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
