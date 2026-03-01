import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './mcp-server.js'
import { createViewerServer } from './viewer/server.js'
import { log } from './logger.js'

const DEFAULT_VIEWER_PORT = 5150

export async function startServer(): Promise<void> {
  log('Server', 'log', 'Starting blitz-iphone-mcp...')

  const { start } = createViewerServer()
  const viewerPort = await start(DEFAULT_VIEWER_PORT)

  const server = createMcpServer(viewerPort)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  log('Server', 'log', `MCP server running (stdio). Viewer at http://localhost:${viewerPort}`)
}
