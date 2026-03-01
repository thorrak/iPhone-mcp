#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { exec, execSync } from 'child_process'
import { promisify } from 'util'
import { createInterface } from 'readline'
import { log } from './logger.js'

const execAsync = promisify(exec)

const VERSION = '0.1.0'

function printUsage(): void {
  process.stderr.write(`
blitz-ios-mcp v${VERSION}

Usage:
  blitz-ios-mcp           Start the MCP server (stdio)
  blitz-ios-mcp --setup   Interactive setup (install dependencies, configure MCP)
  blitz-ios-mcp --version Print version
  blitz-ios-mcp --help    Show this help
`)
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function runSetup(): Promise<void> {
  const mcpHome = join(homedir(), '.blitz-ios-mcp')
  const blitzHome = join(homedir(), '.blitz')

  process.stderr.write('\n  blitz-ios-mcp setup\n\n')

  // Step 1: Check Xcode
  process.stderr.write('  [1/6] Checking Xcode... ')
  try {
    execSync('xcode-select -p', { stdio: 'pipe' })
    process.stderr.write('OK\n')
  } catch {
    process.stderr.write('MISSING\n\n')
    process.stderr.write('  Xcode is required. Install from the App Store or run:\n')
    process.stderr.write('    xcode-select --install\n\n')
    process.exit(1)
  }

  // Step 2: Check Homebrew
  process.stderr.write('  [2/6] Checking Homebrew... ')
  try {
    execSync('which brew', { stdio: 'pipe' })
    process.stderr.write('OK\n')
  } catch {
    process.stderr.write('MISSING\n\n')
    process.stderr.write('  Homebrew is required. Install from https://brew.sh\n\n')
    process.exit(1)
  }

  // Step 3: Install idb
  process.stderr.write('  [3/6] Checking idb... ')
  const mcpIdb = join(mcpHome, 'python', 'bin', 'idb')
  const blitzIdb = join(blitzHome, 'python', 'bin', 'idb')
  if (existsSync(mcpIdb)) {
    process.stderr.write('OK (blitz-ios-mcp)\n')
  } else if (existsSync(blitzIdb)) {
    process.stderr.write('found in ~/.blitz, symlinking... ')
    mkdirSync(join(mcpHome, 'python', 'bin'), { recursive: true })
    try {
      symlinkSync(join(blitzHome, 'python'), join(mcpHome, 'python'), 'junction')
    } catch {
      // Symlink may already exist partially, copy bin
      symlinkSync(blitzIdb, mcpIdb)
    }
    // Also symlink idb-companion if available
    const blitzCompanion = join(blitzHome, 'idb-companion')
    if (existsSync(blitzCompanion) && !existsSync(join(mcpHome, 'idb-companion'))) {
      try { symlinkSync(blitzCompanion, join(mcpHome, 'idb-companion'), 'junction') } catch { /* ignore */ }
    }
    process.stderr.write('OK\n')
  } else {
    process.stderr.write('not found\n')
    process.stderr.write('  Installing idb (this may take a few minutes)...\n')

    mkdirSync(join(mcpHome, 'python'), { recursive: true })
    mkdirSync(join(mcpHome, 'idb-companion'), { recursive: true })

    try {
      // Install idb_companion via Homebrew
      process.stderr.write('    Installing idb_companion via Homebrew...\n')
      await execAsync('brew tap facebook/fb && brew install idb-companion', { timeout: 300_000 })

      // Install fb-idb via pip
      process.stderr.write('    Installing fb-idb via pip...\n')
      await execAsync(`python3 -m venv "${join(mcpHome, 'python')}" && "${join(mcpHome, 'python', 'bin', 'pip')}" install fb-idb`, { timeout: 300_000 })

      process.stderr.write('    idb installed successfully\n')
    } catch (e) {
      process.stderr.write(`    Warning: idb installation failed: ${(e as Error).message}\n`)
      process.stderr.write('    You can install manually: brew install idb-companion && pip install fb-idb\n')
    }
  }

  // Step 4: Clone WDA
  process.stderr.write('  [4/6] Checking WebDriverAgent... ')
  const wdaPath = join(mcpHome, 'wda-build', 'WebDriverAgent')
  const blitzWda = join(blitzHome, 'wda-build', 'WebDriverAgent')
  if (existsSync(join(wdaPath, 'WebDriverAgent.xcodeproj'))) {
    process.stderr.write('OK\n')
  } else if (existsSync(join(blitzWda, 'WebDriverAgent.xcodeproj'))) {
    process.stderr.write('found in ~/.blitz, symlinking... ')
    mkdirSync(join(mcpHome, 'wda-build'), { recursive: true })
    try { symlinkSync(blitzWda, wdaPath) } catch { /* ignore */ }
    process.stderr.write('OK\n')
  } else {
    process.stderr.write('not found, cloning...\n')
    mkdirSync(join(mcpHome, 'wda-build'), { recursive: true })
    try {
      await execAsync(`git clone --depth 1 https://github.com/appium/WebDriverAgent.git "${wdaPath}"`, { timeout: 120_000 })
      process.stderr.write('    WebDriverAgent cloned successfully\n')
    } catch (e) {
      process.stderr.write(`    Warning: WDA clone failed: ${(e as Error).message}\n`)
      process.stderr.write('    Physical device support requires WDA. You can clone manually.\n')
    }
  }

  // Step 5: Build ax-scan (optional)
  process.stderr.write('  [5/6] Checking ax-scan... ')
  const mcpAxScan = join(mcpHome, 'bin', 'ax-scan')
  const blitzAxScan = join(blitzHome, 'bin', 'ax-scan')
  if (existsSync(mcpAxScan)) {
    process.stderr.write('OK\n')
  } else if (existsSync(blitzAxScan)) {
    process.stderr.write('found in ~/.blitz, symlinking... ')
    mkdirSync(join(mcpHome, 'bin'), { recursive: true })
    try { symlinkSync(blitzAxScan, mcpAxScan) } catch { /* ignore */ }
    process.stderr.write('OK\n')
  } else {
    process.stderr.write('not found, attempting build...\n')
    try {
      const axScanDir = join(import.meta.dirname, 'idb', 'ax-scan')
      if (!existsSync(join(axScanDir, 'Makefile'))) {
        // In dist, look relative to dist dir
        const distAxScanDir = join(import.meta.dirname, '..', 'src', 'idb', 'ax-scan')
        if (existsSync(join(distAxScanDir, 'Makefile'))) {
          await execAsync(`make -C "${distAxScanDir}" install INSTALL_DIR="${join(mcpHome, 'bin')}"`, { timeout: 60_000 })
          process.stderr.write('    ax-scan built successfully\n')
        } else {
          throw new Error('Makefile not found')
        }
      } else {
        await execAsync(`make -C "${axScanDir}" install INSTALL_DIR="${join(mcpHome, 'bin')}"`, { timeout: 60_000 })
        process.stderr.write('    ax-scan built successfully\n')
      }
    } catch (e) {
      process.stderr.write(`    Warning: ax-scan build failed (will use fallback): ${(e as Error).message}\n`)
    }
  }

  // Step 6: Configure MCP
  process.stderr.write('  [6/6] MCP configuration\n')
  const answer = await prompt('\n  Install MCP config:\n    1. System-wide (~/.claude.json) [recommended]\n    2. Current directory only (.mcp.json)\n  Choose (1/2): ')

  const mcpConfig = {
    mcpServers: {
      'blitz-ios': {
        command: 'npx',
        args: ['blitz-ios-mcp'],
      },
    },
  }

  const configPath = answer === '2'
    ? join(process.cwd(), '.mcp.json')
    : join(homedir(), '.claude.json')

  try {
    let existing: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      existing = JSON.parse(readFileSync(configPath, 'utf8'))
    }
    const merged = {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers as Record<string, unknown> ?? {}),
        ...mcpConfig.mcpServers,
      },
    }
    writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n')
    process.stderr.write(`\n  Config written to ${configPath}\n`)
  } catch (e) {
    process.stderr.write(`\n  Warning: Could not write config: ${(e as Error).message}\n`)
    process.stderr.write(`  Add this to ${configPath} manually:\n`)
    process.stderr.write(`  ${JSON.stringify(mcpConfig, null, 2)}\n`)
  }

  process.stderr.write('\n  Setup complete! Restart Claude Code to activate.\n\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  if (args.includes('--version') || args.includes('-v')) {
    process.stderr.write(`blitz-ios-mcp v${VERSION}\n`)
    process.exit(0)
  }

  if (args.includes('--setup')) {
    await runSetup()
    process.exit(0)
  }

  // Default: start MCP server
  const { startServer } = await import('./index.js')
  await startServer()
}

main().catch(e => {
  log('CLI', 'error', `Fatal error: ${e}`)
  process.exit(1)
})
