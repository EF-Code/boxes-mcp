import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseVirshList } from './libvirt.js';
import * as libvirt from './libvirt.js';
import * as exec from './exec.js';

vi.mock('./exec.js');

describe('libvirt.parseVirshList()', () => {
  it('should parse running VMs correctly', () => {
    const output = `
 Id   Name           State
-----------------------------
 3    ubuntu-24.04   running
 5    fedora-39      running
`;

    const result = parseVirshList(output);

    expect(result).toEqual([
      { id: '3', name: 'ubuntu-24.04', uuid: '', state: 'running' },
      { id: '5', name: 'fedora-39', uuid: '', state: 'running' }
    ]);
  });

  it('should parse shut off VMs correctly', () => {
    const output = `
 Id   Name      State
-----------------------
 -    win10     shut off
 -    debian    shut off
`;

    const result = parseVirshList(output);

    expect(result).toEqual([
      { id: undefined, name: 'win10', uuid: '', state: 'shut off' },
      { id: undefined, name: 'debian', uuid: '', state: 'shut off' }
    ]);
  });

  it('should parse mixed state VMs', () => {
    const output = `
 Id   Name           State
-----------------------------
 3    ubuntu-24.04   running
 -    win10          shut off
 4    fedora-39      paused
`;

    const result = parseVirshList(output);

    expect(result).toEqual([
      { id: '3', name: 'ubuntu-24.04', uuid: '', state: 'running' },
      { id: undefined, name: 'win10', uuid: '', state: 'shut off' },
      { id: '4', name: 'fedora-39', uuid: '', state: 'paused' }
    ]);
  });

  it('should handle empty list', () => {
    const output = `
 Id   Name   State
-------------------
`;

    const result = parseVirshList(output);

    expect(result).toEqual([]);
  });

  it('should ignore header and separator lines', () => {
    const output = `
 Id   Name           State
-----------------------------
---
 3    ubuntu-24.04   running
`;

    const result = parseVirshList(output);

    expect(result).toHaveLength(1);
  });
});

describe('libvirt.listDomains()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should list domains and enrich with UUIDs', async () => {
    const mockSh = vi.mocked(exec.sh);

    // Mock virsh list --all
    mockSh.mockResolvedValueOnce({
      stdout: ` Id   Name     State
-------------------
 3    vm1      running`,
      stderr: ''
    });

    // Mock virsh domuuid vm1
    mockSh.mockResolvedValueOnce({
      stdout: 'abc-123-def\n',
      stderr: ''
    });

    const result = await libvirt.listDomains();

    expect(result).toEqual([
      { id: '3', name: 'vm1', uuid: 'abc-123-def', state: 'running', uri: 'qemu:///system' }
    ]);
  });

  it('should handle UUID fetch failures gracefully', async () => {
    const mockSh = vi.mocked(exec.sh);

    mockSh.mockResolvedValueOnce({
      stdout: ` Id   Name     State
-------------------
 3    vm1      running`,
      stderr: ''
    });

    // UUID fetch fails
    mockSh.mockRejectedValueOnce(new Error('UUID fetch failed'));

    const result = await libvirt.listDomains();

    expect(result).toEqual([
      { id: '3', name: 'vm1', uuid: '', state: 'running', uri: 'qemu:///system' }
    ]);
  });
});

describe('libvirt.domainInfo()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should parse domain info correctly', async () => {
    const mockSh = vi.mocked(exec.sh);

    // URI resolution probe
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    mockSh.mockResolvedValueOnce({
      stdout: `Id:             3
Name:           ubuntu-24.04
UUID:           abc-123-def
OS Type:        hvm
State:          running
CPU(s):         2
Max memory:     4194304 KiB
Used memory:    2097152 KiB`,
      stderr: ''
    });

    const result = await libvirt.domainInfo('ubuntu-24.04');

    expect(result).toMatchObject({
      'Id': '3',
      'Name': 'ubuntu-24.04',
      'UUID': 'abc-123-def',
      'State': 'running',
      'CPU(s)': '2'
    });
  });
});

describe('libvirt.startDomain()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should call virsh start with correct arguments', async () => {
    const mockSh = vi.mocked(exec.sh);
    // URI resolution probe
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await libvirt.startDomain('test-vm');

    expect(result).toEqual({ ok: true });
    const callArgs = mockSh.mock.calls[1][1];
    expect(callArgs).toContain('start');
    expect(callArgs).toContain('test-vm');
  });
});

describe('libvirt.shutdownDomain()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should call virsh shutdown for graceful shutdown', async () => {
    const mockSh = vi.mocked(exec.sh);
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await libvirt.shutdownDomain('test-vm', false);

    expect(result).toEqual({ ok: true });
    const callArgs = mockSh.mock.calls[0][1];
    expect(callArgs).toContain('shutdown');
    expect(callArgs).toContain('test-vm');
  });

  it('should call virsh destroy for force shutdown', async () => {
    const mockSh = vi.mocked(exec.sh);
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await libvirt.shutdownDomain('test-vm', true);

    expect(result).toEqual({ ok: true });
    const callArgs = mockSh.mock.calls[0][1];
    expect(callArgs).toContain('destroy');
    expect(callArgs).toContain('test-vm');
  });
});

describe('libvirt.undefineDomain()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should call virsh undefine with --keep-nvram by default', async () => {
    const mockSh = vi.mocked(exec.sh);
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await libvirt.undefineDomain('test-vm');

    const callArgs = mockSh.mock.calls[0][1];
    expect(callArgs).toContain('undefine');
    expect(callArgs).toContain('test-vm');
    expect(callArgs).toContain('--keep-nvram');
  });

  it('should omit --keep-nvram when keepStorage is false', async () => {
    const mockSh = vi.mocked(exec.sh);
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await libvirt.undefineDomain('test-vm', false);

    const callArgs = mockSh.mock.calls[0][1];
    expect(callArgs).toContain('undefine');
    expect(callArgs).toContain('test-vm');
    expect(callArgs).not.toContain('--keep-nvram');
  });
});

describe('libvirt.listSnapshots()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should parse snapshot list correctly', async () => {
    const mockSh = vi.mocked(exec.sh);

    mockSh.mockResolvedValueOnce({
      stdout: `Name         Creation Time
* snap1      2024-10-01 12:00:00 +0000
  snap2      2024-10-02 13:30:00 +0000`,
      stderr: ''
    });

    const result = await libvirt.listSnapshots('test-vm');

    expect(result).toEqual([
      { name: 'snap1', current: true, creationTime: '2024-10-01 12:00:00 +0000' },
      { name: 'snap2', current: false, creationTime: '2024-10-02 13:30:00 +0000' }
    ]);
  });

  it('should handle empty snapshot list', async () => {
    const mockSh = vi.mocked(exec.sh);

    mockSh.mockResolvedValueOnce({
      stdout: 'Name         Creation Time\n',
      stderr: ''
    });

    const result = await libvirt.listSnapshots('test-vm');

    expect(result).toEqual([]);
  });
});

describe('libvirt.createSnapshot()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should create snapshot without description', async () => {
    const mockSh = vi.mocked(exec.sh);
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await libvirt.createSnapshot('test-vm', 'snap-name');

    expect(result).toEqual({ ok: true });
    const callArgs = mockSh.mock.calls[0][1];
    expect(callArgs).toContain('snapshot-create-as');
    expect(callArgs).toContain('test-vm');
    expect(callArgs).toContain('snap-name');
  });

  it('should create snapshot with description', async () => {
    const mockSh = vi.mocked(exec.sh);
    mockSh.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await libvirt.createSnapshot('test-vm', 'snap-name', 'Test snapshot');

    const callArgs = mockSh.mock.calls[0][1];
    expect(callArgs).toContain('snapshot-create-as');
    expect(callArgs).toContain('test-vm');
    expect(callArgs).toContain('snap-name');
    expect(callArgs).toContain('--description');
    expect(callArgs).toContain('Test snapshot');
  });
});

describe('libvirt.displayAddress()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return display address', async () => {
    const mockSh = vi.mocked(exec.sh);

    mockSh.mockResolvedValueOnce({
      stdout: 'spice://127.0.0.1:5900\n',
      stderr: ''
    });

    const result = await libvirt.displayAddress('test-vm');

    expect(result).toEqual({ display: 'spice://127.0.0.1:5900' });
  });
});
