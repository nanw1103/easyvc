'use strict'
const util = require('util')
const { delay, retry } = require('otherlib')
const mob = require('../../mob.js')

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
			filter: e => e.toString().includes('3016'),
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

			if (processInfo && Array.isArray(processInfo)) {
				if (processInfo.length == 0)
					return 0	//process not found. We are good.

				if (processInfo[0] && processInfo[0].endTime)
					return processInfo[0].exitCode	//process exited normally
			}
			this.log(`waitForProcess ${pid}`, processInfo)
		}

		return retry(impl, {
			name: `Wait for process ${pid}`,
			filter: () => true,
			intervalMs: 10000,
			timeoutMs: timeoutMs
		})
	}

	async runAndWait(cmd, args, workingDir, envVars, timeoutMillis) {
		let pid = await this.run(cmd, args, workingDir, envVars)
		await delay(1000)
		return await this.waitForProcess(pid, timeoutMillis)
	}

	async runScript(scriptText, timeoutMillis) {

		let fileMgr = this.guest.file(this.options)

		let workingDir = fileMgr.tempPath()
		let guestPath
		let stdoutFile
		let stderrFile
		let cmd
		let args

		if (this.guest.isWindows) {
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

		let envVars
		let exitCode = await this.runAndWait(cmd, args, workingDir, envVars, timeoutMillis)
		let ret = {
			exitCode: exitCode
		}

		if (this.guest.isWindows && exitCode !== 0) {
			try {
				ret.msg = require('child_process').execSync(`net helpmsg ${exitCode}`).toString()
			} catch (err) {
				ret.msg = 'Unknown exit code: ' + exitCode
			}
		}

		ret.stderr = await fileMgr.downloadText(stderrFile)
		ret.stdout = await fileMgr.downloadText(stdoutFile)
		ret.toString = function() {
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

			let str = '\r\nSCRIPT EXIT   >>: ' + this.exitCode + '\r\n'
			str += format(this.stdout, 'SCRIPT STDOUT >>: ')
			str += format(this.stderr, 'SCRIPT STDERR >>: ')
			return str
		}

		if (exitCode !== 0 || ret.stderr !== '') {
			this.log(ret)
		}

		try {
			await fileMgr.delete(workingDir)
		} catch (e) {
			this.log(`Error cleaning up directory: ${workingDir}, error=${e.toString()}`)
		}

		return ret
	}
}

module.exports = ProcessManager