'use strict'
const util = require('util')
const { delay, retry } = require('otherlib')
const mob = require('../../mob.js')

class ScriptResult {
	setExitCode(n, isWindows) {
		this.exitCode = n
		if (isWindows && n !== 0 && n !== undefined) {
			try {
				this.reason = this.msg = require('child_process').execSync(`net helpmsg ${n}`).toString()
			} catch (err) {
				this.msg = 'Unknown exit code: ' + n
			}
		}
	}

	toString() {
		function format(text, prefix) {
			let formatted
			if (typeof text === 'string') {
				let lines = text.split('\n')
				formatted = lines.reduce((a, c) => {return a += prefix + c + '\r\n'}, '\r\n')
			} else {
				formatted = prefix + text
			}				
			return formatted
		}

		let str = '\r\n'
		if (this.hasOwnProperty('exitCode'))
			str += 'SCRIPT EXIT   >>: ' + this.exitCode
		if (this.reason)
			str += ': ' + this.reason
		str += '\r\n'
		
		if (this.stdout)
			str += format(this.stdout, 'SCRIPT STDOUT >>: ')
		if (this.stderr)
			str += format(this.stderr, 'SCRIPT STDERR >>: ')
		if (this.error) {
			function dumpError(e) {
				let ret
				if (e.stack) {
					ret = e.stack
				} else {
					ret = e.toString()
				}
				return ret
			}
			let errorText = dumpError(this.error)
			str += format(errorText, 'SCRIPT ERROR >>: ')
		}
			
		return str
	}
}

class ProcessManager {
	constructor (guest, options) {
		Object.defineProperty(this, 'guest', {value: guest})
		this.options = options
	}

	log() {
		if (this.options && this.options.log === false)
			return
		let text = `ProcessManager [${this.guest.vm.mor.value}] ` + util.format.apply(null, arguments)
		console.log(text)
	}

	//////////////////////////////////////////////////////////////////////////////////////////////
	//	Process operations
	//////////////////////////////////////////////////////////////////////////////////////////////

	async run(programPath, args, workingDirectory, envVariables) {

		let vm = this.guest.vm
		this.log(`run ${programPath} ${args}`)

		let svc = vm._service
		let vim = svc.vim
		let vimPort = svc.vimPort
		let guestMgr = mob(svc, svc.serviceContent.guestOperationsManager)
		let auth = this.guest._auth()
		let spec = vim.GuestProgramSpec({
			programPath: programPath,
			arguments: args
		})
		if (workingDirectory)
			spec.workingDirectory = workingDirectory
		if (envVariables)
			spec.envVariables = envVariables		//Array<string>		

		let impl = async () => {
			let authMgr = await guestMgr.get('authManager')
			let processMgr = await guestMgr.get('processManager')
			await vimPort.validateCredentialsInGuest(authMgr.mor, vm.mor, auth)
			let pid = await vimPort.startProgramInGuest(processMgr.mor, vm.mor, auth, spec)
			return pid
		}

		return retry(impl, {			
			name: `Run ${programPath} ${args}`,
			filterReject: e => e.toString().includes('3016'),
			retry: 5,			
			intervalMs: 30000,
		})
	}

	async waitForProcess(pid, timeoutMs) {
		if (!pid)
			throw 'waitProgramComplete: pid not specified'
		if (!timeoutMs)
			throw 'waitProgramComplete: timeoutMs not specified'

		this.log(`Waiting for process ${pid}...`)
		let vm = this.guest.vm
		let svc = vm._service
		let vimPort = svc.vimPort

		let auth = this.guest._auth()

		let guestMgr = mob(svc, svc.serviceContent.guestOperationsManager)
		let processMgr = await guestMgr.get('processManager')

		let impl = async () => {
			let processInfo = await vimPort.listProcessesInGuest(processMgr.mor, vm.mor, auth, [pid])

			let p = processInfo[0]
			if (!p)
				return 0	//process not found. We are good.

			if (p.endTime)
				return p.exitCode	//process exited normally
			return Promise.reject('retry')
		}

		return retry(impl, {
			name: `Wait for process ${pid}`,
			filterReject: e => e === 'retry' || e.toString().includes('3016') || e.toString().includes('ECONNRESET'),
			intervalMs: 10000,
			timeoutMs: timeoutMs
		})
	}

	async runAndWait(cmd, args, workingDir, envVars, timeoutMillis) {
		let pid = await this.run(cmd, args, workingDir, envVars)
		await delay(1000)
		return await this.waitForProcess(pid, timeoutMillis)
	}

	async runScript(scriptText, timeoutMs) {

		let fileMgr = this.guest.file(this.options)

		let workingDir = await fileMgr.tempPath()
		let guestPath
		let stdoutFile
		let stderrFile
		let cmd
		let args

		let isWindows = await this.guest.vm.isWindows()
		if (isWindows) {
			guestPath = workingDir + '\\task.bat'
			stdoutFile = workingDir + '\\out'
			stderrFile = workingDir + '\\err'
			cmd = 'C:\\Windows\\system32\\cmd.exe'
			args = `/c ${guestPath} >${stdoutFile} 2>${stderrFile}`
		} else {
			guestPath = workingDir + '/task.sh'
			stdoutFile = workingDir + '/out'
			stderrFile = workingDir + '/err'
			cmd = '/bin/sh'
			args = `${guestPath} >${stdoutFile} 2>${stderrFile}`
		}
		
		await fileMgr.uploadText(scriptText, guestPath)

		let exitCode
		let ret = new ScriptResult()
		
		try {
			exitCode = await this.runAndWait(cmd, args, workingDir, null, timeoutMs)
			ret.setExitCode(exitCode, isWindows)
		} catch (e) {
			ret.error = e
		}

		try {
			ret.stderr = await fileMgr.downloadText(stderrFile)
		} catch (e) {
			//ignore
		}
		
		try {
			ret.stdout = await fileMgr.downloadText(stdoutFile)
		} catch (e) {
			//ignore
		}		

		if (exitCode !== 0 || ret.stderr !== '' || ret.error) {
			this.log(ret.toString())
		} else {
			try {
				await fileMgr.delete(workingDir)
			} catch (e) {
				this.log(`Error cleaning up directory: ${workingDir}, error=${e.toString()}`)
			}
		}

		return ret
	}
}

module.exports = ProcessManager