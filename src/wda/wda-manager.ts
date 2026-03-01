import { spawn, type ChildProcess, exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { log } from '../logger.js'
import { childEnv } from '../child-env.js'
import { WDAClient } from './wda-client.js'

const execAsync = promisify(exec)

export type WDASetupStep =
  | 'connecting'
  | 'building_wda'
  | 'installing_wda'
  | 'establishing_connection'
  | 'ready'

export interface WDASetupProgress {
  step: WDASetupStep
  message: string
  error?: string
}

type ProgressCallback = (progress: WDASetupProgress) => void

export class WDAManager {
  private static instance: WDAManager | null = null
  private wdaProcesses: Map<string, ChildProcess> = new Map()

  static getInstance(): WDAManager {
    if (!WDAManager.instance) {
      WDAManager.instance = new WDAManager()
    }
    return WDAManager.instance
  }

  private getWdaProjectPath(): string {
    const mcpPath = join(homedir(), '.blitz-iphone-mcp', 'wda-build', 'WebDriverAgent')
    if (existsSync(join(mcpPath, 'WebDriverAgent.xcodeproj'))) return mcpPath

    const blitzPath = join(homedir(), '.blitz', 'wda-build', 'WebDriverAgent')
    if (existsSync(join(blitzPath, 'WebDriverAgent.xcodeproj'))) return blitzPath

    throw new Error('WebDriverAgent not found. Run `npx @blitzdev/iphone-mcp --setup` to install it.')
  }

  private async ensureWdaSource(): Promise<string> {
    try {
      return this.getWdaProjectPath()
    } catch {
      const targetDir = join(homedir(), '.blitz-iphone-mcp', 'wda-build')
      mkdirSync(targetDir, { recursive: true })
      const wdaDir = join(targetDir, 'WebDriverAgent')

      log('WDAManager', 'log', 'Cloning WebDriverAgent from GitHub...')
      await execAsync(
        `git clone --depth 1 https://github.com/appium/WebDriverAgent.git "${wdaDir}"`,
        { timeout: 120_000, env: childEnv() }
      )
      log('WDAManager', 'log', 'WebDriverAgent cloned successfully')
      return wdaDir
    }
  }

  private getDerivedDataPath(): string {
    const dir = join(homedir(), '.blitz-iphone-mcp', 'wda-build')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  private async detectTeamId(): Promise<string> {
    try {
      const { stdout } = await execAsync('defaults read com.apple.dt.Xcode IDEProvisioningTeams', { env: childEnv() })
      const match = stdout.match(/teamID\s*=\s*([A-Z0-9]{10})/)
      if (match) return match[1]
    } catch {
      // Xcode prefs not available
    }
    throw new Error('No development team found. Sign in to Xcode with your Apple ID first (Xcode -> Settings -> Accounts).')
  }

  async getTunnelAddress(udid: string): Promise<string> {
    try {
      const { stdout } = await execAsync('xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null', { env: childEnv() })
      const jsonStart = stdout.indexOf('{')
      if (jsonStart < 0) throw new Error('No JSON in devicectl output')
      const json = JSON.parse(stdout.substring(jsonStart))
      const devices = json?.result?.devices ?? []

      for (const d of devices) {
        const devUdid = d.hardwareProperties?.udid
        if (devUdid !== udid) continue
        const tunnelIP = d.connectionProperties?.tunnelIPAddress
        if (tunnelIP) {
          log('WDAManager', 'log', `Tunnel IP for ${udid}: ${tunnelIP}`)
          return tunnelIP
        }
      }
    } catch (e) {
      log('WDAManager', 'error', `Failed to get tunnel address: ${(e as Error).message}`)
    }
    throw new Error('No CoreDevice tunnel found. Ensure iPhone is connected via USB and trusted.')
  }

  async isWDARunning(udid: string, port: number = 8100): Promise<boolean> {
    try {
      const tunnelIP = await this.getTunnelAddress(udid)
      const client = WDAClient.getInstance(udid, port, tunnelIP)
      return client.isReachable()
    } catch {
      return false
    }
  }

  async setupDevice(
    udid: string,
    onProgress?: ProgressCallback,
    port: number = 8100,
  ): Promise<WDAClient> {
    const report = (step: WDASetupStep, message: string) => {
      log('WDAManager', 'log', `[${udid}] ${step}: ${message}`)
      onProgress?.({ step, message })
    }

    report('connecting', 'Verifying device connection...')
    await this.verifyDeviceConnected(udid)
    report('connecting', 'Device connected.')

    if (await this.isWDARunning(udid, port)) {
      report('establishing_connection', 'WDA already running, creating session...')
      const tunnelIP = await this.getTunnelAddress(udid)
      const client = WDAClient.getInstance(udid, port, tunnelIP)
      await client.createSession()
      report('ready', 'Connected to device.')
      return client
    }

    report('building_wda', 'Building WebDriverAgent...')
    await this.buildWDA(udid)
    report('building_wda', 'Build complete.')

    report('installing_wda', 'Launching WebDriverAgent on device...')
    await this.launchWDA(udid)
    report('installing_wda', 'WebDriverAgent launched.')

    report('establishing_connection', 'Waiting for WebDriverAgent...')
    const tunnelIP = await this.getTunnelAddress(udid)
    await this.waitForWDA(udid, port, tunnelIP)

    const client = WDAClient.getInstance(udid, port, tunnelIP)
    await client.createSession()
    report('ready', 'Connected to device.')

    return client
  }

  async quickConnect(
    udid: string,
    onProgress?: ProgressCallback,
    port: number = 8100,
  ): Promise<WDAClient> {
    const report = (step: WDASetupStep, message: string) => {
      log('WDAManager', 'log', `[${udid}] ${step}: ${message}`)
      onProgress?.({ step, message })
    }

    report('establishing_connection', 'Connecting to WebDriverAgent...')
    const tunnelIP = await this.getTunnelAddress(udid)
    await this.waitForWDA(udid, port, tunnelIP)
    const client = WDAClient.getInstance(udid, port, tunnelIP)
    await client.createSession()
    report('ready', 'Connected to device.')
    return client
  }

  private async verifyDeviceConnected(udid: string): Promise<void> {
    try {
      const { stdout } = await execAsync('xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null', { env: childEnv() })
      const jsonStart = stdout.indexOf('{')
      if (jsonStart < 0) throw new Error(`Device ${udid} not found. Connect your iPhone via USB.`)
      const json = JSON.parse(stdout.substring(jsonStart))
      const devices = json?.result?.devices ?? []
      const found = devices.some((d: { hardwareProperties?: { udid?: string }; identifier?: string }) =>
        d.hardwareProperties?.udid === udid || d.identifier === udid
      )
      if (!found) throw new Error(`Device ${udid} not found. Connect your iPhone via USB.`)
    } catch (e) {
      if ((e as Error).message.includes('not found')) throw e
      throw new Error(`Failed to verify device connection: ${(e as Error).message}`)
    }
  }

  private async buildWDA(udid: string): Promise<void> {
    const wdaPath = await this.ensureWdaSource()
    const derivedData = this.getDerivedDataPath()
    const teamId = await this.detectTeamId()

    const args = [
      'build-for-testing',
      '-project', join(wdaPath, 'WebDriverAgent.xcodeproj'),
      '-scheme', 'WebDriverAgentRunner',
      '-destination', `id=${udid}`,
      '-derivedDataPath', derivedData,
      '-allowProvisioningUpdates',
      `DEVELOPMENT_TEAM=${teamId}`,
    ]

    log('WDAManager', 'log', `Building WDA: xcodebuild ${args.join(' ')}`)

    return new Promise<void>((resolve, reject) => {
      const proc = spawn('xcodebuild', args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() })
      let stderr = ''

      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

      proc.on('close', (code) => {
        if (code === 0) {
          log('WDAManager', 'log', 'WDA build succeeded')
          resolve()
        } else {
          log('WDAManager', 'error', `WDA build failed (code ${code}): ${stderr.slice(-500)}`)
          if (stderr.includes('Developer Mode')) {
            reject(new Error('Enable Developer Mode on your iPhone: Settings -> Privacy & Security -> Developer Mode'))
          } else if (stderr.includes('provisioning')) {
            reject(new Error('Provisioning error. Ensure your Apple ID is signed into Xcode.'))
          } else if (stderr.includes('Trust This Computer')) {
            reject(new Error('Tap "Trust This Computer" on your iPhone.'))
          } else {
            reject(new Error(`WDA build failed with code ${code}`))
          }
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to start xcodebuild: ${err.message}`))
      })
    })
  }

  private async launchWDA(udid: string): Promise<void> {
    const existing = this.wdaProcesses.get(udid)
    if (existing) {
      existing.kill('SIGTERM')
      this.wdaProcesses.delete(udid)
    }

    const wdaPath = this.getWdaProjectPath()
    const derivedData = this.getDerivedDataPath()

    const args = [
      'test-without-building',
      '-project', join(wdaPath, 'WebDriverAgent.xcodeproj'),
      '-scheme', 'WebDriverAgentRunner',
      '-destination', `id=${udid}`,
      '-derivedDataPath', derivedData,
    ]

    log('WDAManager', 'log', `Launching WDA: xcodebuild ${args.join(' ')}`)

    const proc = spawn('xcodebuild', args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() })
    this.wdaProcesses.set(udid, proc)

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      if (text.includes('ServerURLHere')) {
        log('WDAManager', 'log', `WDA server started on device ${udid}`)
      }
    })

    proc.on('exit', (code, signal) => {
      log('WDAManager', 'log', `WDA process exited for ${udid}: code=${code} signal=${signal}`)
      this.wdaProcesses.delete(udid)
    })

    proc.on('error', (err) => {
      log('WDAManager', 'error', `WDA process error for ${udid}: ${err.message}`)
      this.wdaProcesses.delete(udid)
    })

    await new Promise(resolve => setTimeout(resolve, 3000))
  }

  private async waitForWDA(udid: string, port: number, tunnelIP: string, maxRetries: number = 30): Promise<void> {
    const client = WDAClient.getInstance(udid, port, tunnelIP)
    for (let i = 0; i < maxRetries; i++) {
      if (await client.isReachable()) {
        log('WDAManager', 'log', `WDA reachable on attempt ${i + 1}`)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('WebDriverAgent did not become reachable in time. Check that your iPhone is unlocked.')
  }

  async teardownDevice(udid: string): Promise<void> {
    const wdaProc = this.wdaProcesses.get(udid)
    if (wdaProc) {
      wdaProc.kill('SIGTERM')
      this.wdaProcesses.delete(udid)
    }
    const client = WDAClient.getInstance(udid)
    await client.shutdown()
    log('WDAManager', 'log', `[${udid}] Device torn down`)
  }

  async shutdownAll(): Promise<void> {
    for (const [udid, proc] of this.wdaProcesses) {
      proc.kill('SIGTERM')
      log('WDAManager', 'log', `Killed WDA process for ${udid}`)
    }
    this.wdaProcesses.clear()
  }
}

export const wdaManager = WDAManager.getInstance()
