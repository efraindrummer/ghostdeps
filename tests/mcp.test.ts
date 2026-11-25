import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createAuditToolDefinition, executeMcpAudit } from '../src/mcp/server.js';

describe('MCP Server', () => {
  it('createAuditToolDefinition expone el schema correcto para MCP', () => {
    const tool = createAuditToolDefinition();
    expect(tool.name).toBe('ghostdeps_audit');
    expect(tool.description).toContain('Audita la salud social');
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.properties).toHaveProperty('path');
    expect(tool.inputSchema.properties).toHaveProperty('dev');
    expect(tool.inputSchema.properties).toHaveProperty('transitive');
    expect(tool.inputSchema.properties).toHaveProperty('depth');
    expect(tool.inputSchema.properties).toHaveProperty('failUnder');
    expect(tool.inputSchema.properties).toHaveProperty('ignore');
  });

  it('executeMcpAudit ejecuta una auditoría y devuelve reporte Markdown', async () => {
    // Apuntamos al package.json de ghostdeps
    const ghostdepsDir = path.resolve(__dirname, '..');
    const result = await executeMcpAudit({ path: ghostdepsDir, dev: false }, '0.2.0');

    expect(typeof result).toBe('string');
    expect(result).toContain('## 👻 GhostDeps');
    expect(result).toContain('dependencias');
  });
});
