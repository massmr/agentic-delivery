import type { McpServerSelection } from './provider-capability.js';

export interface McpConnectorPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly server: McpServerSelection;
}

export const atlassianJiraMcpPreset: McpConnectorPreset = {
  id: 'atlassian-local',
  label: 'Atlassian local MCP',
  description: 'Uses the locally installed mcp-atlassian stdio server.',
  server: {
    id: 'atlassian',
    command: 'mcp-atlassian',
    args: [],
    envVarNames: ['ATLASSIAN_BASE_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN']
  }
};

export const railwayCliMcpPreset: McpConnectorPreset = {
  id: 'railway-cli-local',
  label: 'Railway CLI local MCP',
  description: 'Uses the locally installed and authenticated Railway CLI stdio MCP server.',
  server: {
    id: 'railway',
    command: 'railway',
    args: ['mcp'],
    envVarNames: []
  }
};

export const jiraMcpConnectorPresets: readonly McpConnectorPreset[] = [atlassianJiraMcpPreset];
export const railwayMcpConnectorPresets: readonly McpConnectorPreset[] = [railwayCliMcpPreset];
