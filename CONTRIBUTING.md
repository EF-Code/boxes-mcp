# Contributing to boxes-mcp

Thank you for considering contributing to boxes-mcp! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Environment details** (OS, Node.js version, libvirt version)
- **Relevant logs** or error messages

### Suggesting Enhancements

Enhancement suggestions are welcome! Please provide:

- **Clear use case** for the enhancement
- **Detailed description** of proposed functionality
- **Why this would be useful** to other users
- **Potential implementation approach** (if applicable)

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following our coding standards
3. **Add tests** for new functionality
4. **Ensure all tests pass** (`npm test`)
5. **Update documentation** as needed
6. **Submit a pull request** with clear description

## Development Setup

### Prerequisites

```bash
# Install system dependencies
sudo apt install -y libvirt-daemon-system qemu-kvm virt-manager

# Add your user to required groups
sudo usermod -aG libvirt,kvm "$USER"
newgrp libvirt
```

### Local Development

```bash
# Clone your fork
git clone https://github.com/your-username/boxes-mcp.git
cd boxes-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run tests in watch mode during development
npm run test:watch
```

## Coding Standards

### TypeScript Guidelines

- Use **strict TypeScript** - no `any` types without justification
- Prefer **interfaces over types** for object shapes
- Use **async/await** over promises for readability
- Add **JSDoc comments** for public APIs
- Follow **functional programming** patterns where appropriate

### Code Style

- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Line length**: Maximum 100 characters
- **Naming**:
  - camelCase for variables and functions
  - PascalCase for types and interfaces
  - UPPER_CASE for constants

### Testing Requirements

- **Unit tests** for all new functions and modules
- **Integration tests** for virsh interactions
- **Minimum 80% code coverage** for new code
- Test files should be named `*.test.ts`

Example test structure:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { myFunction } from './myModule.js';

describe('myFunction()', () => {
  it('should handle valid input correctly', () => {
    const result = myFunction('test');
    expect(result).toBe('expected');
  });

  it('should throw error for invalid input', () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): subject

body (optional)

footer (optional)
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test additions or modifications
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks

### Examples

```
feat(snapshots): add snapshot description support

Add optional description parameter to snapshot creation
to provide better context for VM state backups.

Closes #123
```

```
fix(libvirt): correct parseVirshList regex for shut-off VMs

Previous regex incorrectly skipped lines starting with '-',
which caused shut-off VMs (with ID '-') to not be parsed.

Fixes #456
```

## Project Structure

```
boxes-mcp/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── libvirt.ts        # virsh operations
│   ├── exec.ts           # Command execution
│   └── *.test.ts         # Test files
├── systemd/              # Service configuration
├── .github/              # GitHub workflows
└── docs/                 # Additional documentation
```

## Testing Guidelines

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Writing Tests

1. **Test behavior, not implementation** - Focus on what functions do, not how
2. **Use descriptive test names** - Test names should explain what is being tested
3. **Follow AAA pattern** - Arrange, Act, Assert
4. **Mock external dependencies** - Use vitest mocking for virsh calls
5. **Test edge cases** - Include error conditions and boundary cases

### Coverage Requirements

- **Minimum overall coverage**: 80%
- **New features**: 90% coverage required
- **Critical paths**: 100% coverage required

## Documentation

### Code Documentation

- Add **JSDoc comments** for all exported functions
- Include **parameter types and descriptions**
- Document **return types** and possible errors
- Provide **usage examples** for complex functions

```typescript
/**
 * Creates a snapshot for a virtual machine domain.
 *
 * @param nameOrUuid - Domain name or UUID
 * @param snapName - Name for the new snapshot
 * @param description - Optional description of the snapshot
 * @returns Promise resolving to success status
 * @throws Error if snapshot creation fails
 *
 * @example
 * ```typescript
 * await createSnapshot('ubuntu-vm', 'pre-update', 'Before system update');
 * ```
 */
export async function createSnapshot(
  nameOrUuid: string,
  snapName: string,
  description?: string
): Promise<{ ok: boolean }> {
  // Implementation
}
```

### README Updates

Update README.md when adding:
- New tools or features
- Configuration options
- Usage examples
- Troubleshooting steps

## Release Process

1. **Version bumping** follows [Semantic Versioning](https://semver.org/)
   - MAJOR: Breaking changes
   - MINOR: New features (backward compatible)
   - PATCH: Bug fixes

2. **Changelog** - Update CHANGELOG.md with all changes

3. **Testing** - Ensure all tests pass and coverage meets requirements

4. **Documentation** - Update README and any relevant docs

## Getting Help

- **Questions**: Open a [Discussion](https://github.com/your-org/boxes-mcp/discussions)
- **Issues**: Check [existing issues](https://github.com/your-org/boxes-mcp/issues)
- **Chat**: Join our community discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to boxes-mcp! 🎉
