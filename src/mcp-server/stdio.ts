import path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { findWorkspaceRoot } from '@guildhall/config'
import { getProjectStateDir } from '@guildhall/sessions'

import { createGuildhallMcpServer } from './server.js'

export async function serveGuildhallMcpStdio(projectPath: string): Promise<void> {
  const projectRoot = findWorkspaceRoot(projectPath) ?? path.resolve(projectPath)
  const server = await createGuildhallMcpServer({
    projectRoot,
    projectStateDir: getProjectStateDir(projectRoot),
    runtime: { kind: 'host' },
  })
  await server.connect(new StdioServerTransport())
}
