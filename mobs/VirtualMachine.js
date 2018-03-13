'use strict'

const mob = require('../mob')
const BaseMob = require('../BaseMob.js')
const fs = require('fs')
const path = require('path')
const request = require('request')
const execSync = require('child_process').execSync
const streamBuffer = require('stream-buffers')
const Readable = require('stream').Readable

function delayPromise(data, millis) {
	return new Promise(resolve => setTimeout(() => resolve(data), millis))
}

class VirtualMachine extends BaseMob {
	async powerOn(timeoutMillis) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort

		try {
			let taskMor = await vimPort.powerOnVMTask(this.mor)
			let task = mob(this._service, taskMor)
			let ret = await task.waitState('info.state', vim.TaskInfoState.success.toString(), timeoutMillis)

			return delayPromise(ret, 1000)

		} catch (err) {
			return Promise.reject(err)
		}
	}

	async powerOff(timeoutMillis) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort

		try {
			let taskMor = await vimPort.powerOffVMTask(this.mor)
			let task = mob(this._service, taskMor)
			let ret = await task.waitState('info.state', vim.TaskInfoState.success.toString(), timeoutMillis)
			return delayPromise(ret, 1000)

		} catch (err) {
			return Promise.reject(err)
		}

	}

	async waitPowerOn(timeoutMillis) {
		let vim = this._service.vim
		try {
			let ret = await this.waitState('runtime.powerState', vim.VirtualMachinePowerState.poweredOn.toString(), timeoutMillis)
			return delayPromise(ret, 5000)
		} catch (err) {
			return Promise.reject(err)
		}
	}

	async waitPowerOff(timeoutMillis) {
		let vim = this._service.vim
		try {
			let ret = await this.waitState('runtime.powerState', vim.VirtualMachinePowerState.poweredOff.toString(), timeoutMillis)
			return delayPromise(ret, 5000)
		} catch (err) {
			return Promise.reject(err)
		}
	}

	async isPowerOff() {
		try {
			let stat = await this.get('runtime.powerState')
			return stat === this._service.vim.VirtualMachinePowerState.poweredOff.toString()
		} catch (err) {
			return Promise.reject(err)
		}
	}

	async destroy() {
		let vim = this._service.vim
		let vimPort = this._service.vimPort
		try {
			let deleteVMTaskMor = await vimPort.destroyTask(this.mor)
			let task = mob(this._service, deleteVMTaskMor)
			let data = await task.waitState('info.state', vim.TaskInfoState.success.toString())
			return delayPromise(data, 1000)

		} catch (err) {
			return Promise.reject(err)
		}
	}


	async getCdromInfo() {
		try {
			let cdroms = []
			let devices = await this.get('config.hardware.device')

			if (!Array.isArray(devices)) {
				console.log(devices)
				return Promise.reject('Not found hardware device')
			}

			devices.forEach((device) => {
				let label = device.deviceInfo.label
				let unitNumber = device.unitNumber
				if (label.indexOf('CD') > -1) {
					let cdrom = {
						key: device.key,
						controllerKey: device.controllerKey,
						unitNumber: unitNumber
					}

					cdroms.push(cdrom)
				}
			})

			return cdroms

		} catch (err) {
			return Promise.reject(err)
		}
	}


	async detachCD() {
		let vim = this._service.vim
		let vimPort = this._service.vimPort

		try {
			let cdroms = await this.getCdromInfo()
			let deviceChange = []
			cdroms.forEach((cdrom) => {
				let device = vim.VirtualDeviceConfigSpec({
					operation: vim.VirtualDeviceConfigSpecOperation.edit,
					device: vim.VirtualCdrom({
						backing: vim.VirtualCdromRemoteAtapiBackingInfo({
							deviceName: ''
						}),
						key: cdrom.key,
						connectable: vim.VirtualDeviceConnectInfo({
							allowGuestControl: true,
							connected: false,
							startConnected: false
						}),
						controllerKey: cdrom.controllerKey,
						unitNumber: cdrom.unitNumber
					})
				})
				deviceChange.push(device)
			})

			let vmConfigSpec = vim.VirtualMachineConfigSpec({
				deviceChange: deviceChange
			})

			// start detach CDrom
			let task = await vimPort.reconfigVMTask(this.mor, vmConfigSpec)
			let vmTask = mob(this._service, task)
			return await vmTask.waitState('info.state', vim.TaskInfoState.success.toString())

		} catch (err) {
			return Promise.reject(err)
		}
	}


	async attachCD(key, datastoreMoid, isoPath) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort

		let datastoreMor = vim.ManagedObjectReference({
			value: datastoreMoid,
			type: 'Datastore'
		})

		try {
			let cdroms = await this.getCdromInfo()
			for (let i = 0; i < cdroms.length; i++) {
				let cdrom = cdroms[i]
				if (cdrom.key === key) {
					let vmConfigSpec = vim.VirtualMachineConfigSpec({
						deviceChange: [
							vim.VirtualDeviceConfigSpec({
								operation: vim.VirtualDeviceConfigSpecOperation.edit,
								device: vim.VirtualCdrom({
									backing: vim.VirtualCdromIsoBackingInfo({
										datastore: datastoreMor,
										fileName: isoPath
									}),
									key: cdrom.key,
									connectable: vim.VirtualDeviceConnectInfo({
										allowGuestControl: true,
										connected: true,
										startConnected: true
									}),
									controllerKey: cdrom.controllerKey,
									unitNumber: cdrom.unitNumber
								})
							})
						]
					})

					// start attach CDrom
					let task = await vimPort.reconfigVMTask(this.mor, vmConfigSpec)
					let vmTask = mob(this._service, task)
					await vmTask.waitState('info.state', vim.TaskInfoState.success.toString())
					break
				}
			}

			return

		} catch (err) {
			return Promise.reject(err)
		}
	}

	async waitVMwareToolsRun(timeoutMillis) {
		let vim = this._service.vim
		let ret = await this.waitState('summary.guest.toolsRunningStatus', vim.VirtualMachineToolsRunningStatus.guestToolsRunning.toString(), timeoutMillis)
		return delayPromise(ret, 5000)
	}

	installVMwareTools() {
		return this._service.vimPort
			.mountToolsInstaller(this.mor)
			.then(this.waitVMwareToolsRun.bind(this))
	}


	getIPAddress() {
		return this.get('summary.guest.ipAddress')
	}

	async initiateFileTransferToGuest(vmUser, vmPassword, vmFilePath, fileSize) {

		let vim = this._service.vim
		let vimPort = this._service.vimPort
		let guestOperationsManager = this._service.serviceContent.guestOperationsManager

		let guestMgr = mob(this._service, guestOperationsManager)
		let auth = vim.NamePasswordAuthentication({
			username: vmUser,
			password: vmPassword,
			interactiveSession: false
		})
		try {
			let fileMgr = await guestMgr.get('fileManager')
			let url = await vimPort.initiateFileTransferToGuest(fileMgr.mor, this.mor, auth, vmFilePath, vim.GuestFileAttributes(), fileSize, true)
			return url

		} catch (err) {
			console.error('initiateFileTransferToGuest failed, error: ', err)
			return Promise.reject(err)
		}
	}

	async initiateFileTransferFromGuest(vmUser, vmPassword, vmFilePath) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort
		let guestOperationsManager = this._service.serviceContent.guestOperationsManager

		let guestMgr = mob(this._service, guestOperationsManager)
		let auth = vim.NamePasswordAuthentication({
			username: vmUser,
			password: vmPassword,
			interactiveSession: false
		})
		try {
			let fileMgr = await guestMgr.get('fileManager')
			let info = await vimPort.initiateFileTransferFromGuest(fileMgr.mor, this.mor, auth, vmFilePath)
			return info
		} catch (err) {
			console.error('initiateFileTransferFromGuest failed, error: ', err)
			return Promise.reject(err)
		}
	}


	async uploadStream(esxiHost, vmUser, vmPassword, vmFilePath, stream, streamSize) {
		try {
			let url = await this.initiateFileTransferToGuest(vmUser, vmPassword, vmFilePath, streamSize)
			url = url.replace('//*', '//' + esxiHost)
			let req = request.put({
				url: url,
				headers: {
					'Content-Type': 'application/octet-stream', // binary file type
					'Content-Length': streamSize // file will not create if don't have this
				}
			})

			return new Promise((resolve, reject) => {
				try {
					let pipe = stream.pipe(req)
					pipe.on('end', () => {
						resolve()
					}).on('error', (e) => {
						console.error('uploadStream error ', e)
						reject(e)
					})

				} catch (err) {
					console.error('stream pipe error ', err)
					reject(err)
				}
			})
		} catch (err) {
			if (err.toString().includes('EHOSTUNREACH')) {
				return this.uploadStream(esxiHost, vmUser, vmPassword, vmFilePath, stream, streamSize)
			} else {
				console.error('uploadStream failed, error: ', err)
				return Promise.reject(err)
			}
		}
	}


	uploadFile(esxiHost, vmUser, vmPassword, vmFilePath, localFilePath) {
		let fileSize = fs.statSync(localFilePath).size
		let stream = fs.createReadStream(localFilePath)
		return this.uploadStream(esxiHost, vmUser, vmPassword, vmFilePath, stream, fileSize)
	}

	async downloadStream(esxiHost, vmUser, vmPassword, vmFilePath, dstStream) {
		try {
			let info = await this.initiateFileTransferFromGuest(vmUser, vmPassword, vmFilePath)
			let url = info.url
			url = url.replace('//*', '//' + esxiHost)

			return new Promise((resolve, reject) => {
				request(url)
					.on('end', resolve)
					.on('error', err => {
						console.error('request get ${url} failed, error: ', err)
						reject(err)
					})
					.pipe(dstStream)
			})

		} catch (err) {
			console.error('downloadStream failed, error: ', err)
			return Promise.reject(err)
		}
	}

	async downloadText(esxiHost, vmUser, vmPassword, vmFilePath) {
		let buffer = new streamBuffer.WritableStreamBuffer()
		await this.downloadStream(esxiHost, vmUser, vmPassword, vmFilePath, buffer)
		return buffer.getContentsAsString('utf8')
	}

	async downloadFile(esxiHost, vmUser, vmPassword, vmFilePath, dstFilePath) {
		let dir = path.dirname(dstFilePath)
		if (!fs.existsSync(dir))
			fs.mkdirSync(dir)
		let file = fs.createWriteStream(dstFilePath, {
			autoClose: true
		})
		return this.downloadStream(esxiHost, vmUser, vmPassword, vmFilePath, file)
	}

	async runProgramInGuest(vmUser, vmPassword, programPath, args) {
		console.log(`run ${programPath} ${args} in guest`)
		let vim = this._service.vim
		let vimPort = this._service.vimPort
		let guestOperationsManager = this._service.serviceContent.guestOperationsManager

		let guestMgr = mob(this._service, guestOperationsManager)
		let auth = vim.NamePasswordAuthentication({
			username: vmUser,
			password: vmPassword,
			interactiveSession: false
		})
		let spec = vim.GuestProgramSpec({
			programPath: programPath,
			arguments: args
		})
		try {
			let authMgr = await guestMgr.get('authManager')
			let processMgr = await guestMgr.get('processManager')
			await vimPort.validateCredentialsInGuest(authMgr.mor, this.mor, auth)
			let pid = await vimPort.startProgramInGuest(processMgr.mor, this.mor, auth, spec)

			return pid
		} catch (err) {
			if (err.toString().includes('3016')) {
				setTimeout(() => {
					return this.runProgramInGuest(vmUser, vmPassword, programPath, args)
				}, 30000)
			} else {
				console.error(`Run ${programPath} failed, error: `, err)
				return Promise.reject(err)
			}
		}
	}


	async waitProgramCompleteInGuest(vmUser, vmPassword, pid, timeoutMillis) {
		if (!pid)
			throw 'waitProgramCompleteInGuest: pid not specified'
		if (!timeoutMillis)
			throw 'timeoutMillis not specified'

		console.log(`Waiting for process ${pid} exit`)
		let me = this
		let vim = this._service.vim
		let vimPort = this._service.vimPort
		let guestOperationsManager = this._service.serviceContent.guestOperationsManager
		let guestMgr = mob(this._service, guestOperationsManager)
		let auth = vim.NamePasswordAuthentication({
			username: vmUser,
			password: vmPassword,
			interactiveSession: false
		})

		let start = Date.now()

		let processMgr = await guestMgr.get('processManager')

		return new Promise((resolve, reject) => {

			let retryTimes = 0
			let processCmdLine = undefined
			let waitImpl = function () {
				let now = Date.now()
				if (now - start > timeoutMillis)
					return reject(`${me.mor.value} waitProgramCompleteInGuest ${pid} timeoutMillis`)

				vimPort.listProcessesInGuest(processMgr.mor, me.mor, auth, [pid])
					.then((processInfo) => {
						console.log('processInfo', JSON.stringify(processInfo))
						if (processInfo && Array.isArray(processInfo)) {
							if (processInfo.length == 0)
								return resolve(0)
							else if (processInfo[0] && processInfo[0].endTime)
								return resolve(processInfo[0].exitCode)
							else {
								// check command Line
								let cl = processInfo[0].cmdLine
								if (processCmdLine && cl && (processCmdLine != cl)) {
									return resolve(0)
								} else {
									processCmdLine = cl
								}
							}
						}
						setTimeout(waitImpl, 10000)
					})
					.catch((err) => {
						if (err.toString().includes('3016')) // VIX_E_TOOLS_NOT_RUNNING Guest tools is not running.
						{
							console.log(`listProcessesInGuest ${pid}, `, err)
							console.log(`continue to wait process ${pid} exit`)

							setTimeout(waitImpl, 10000)
						}
						else {
							retryTimes++
							if (retryTimes > 5) {
								console.error(`listProcessesInGuest ${pid} failed, error: `, err)
								reject(err)

							} else {
								// retry 5 times at most after failed
								console.log(`retry to listProcessesInGuest ${pid} `, err)
								setTimeout(waitImpl, 10000)
							}
						}
					})
			}

			waitImpl()
		})
	}


	async execFileInGuest(esxiHost, vmUser, vmPassword, filePath, timeoutMillis) {
		try {
			let pid = await this.runProgramInGuest(vmUser, vmPassword, 'C:\\Windows\\system32\\cmd.exe', `/c ${filePath} >C:\\out.txt 2>C:\\err.txt`)
			let exitCode = await this.waitProgramCompleteInGuest(vmUser, vmPassword, pid, timeoutMillis)

			let ret = {
				exitCode: exitCode
			}

			if (exitCode !== 0) {
				try {
					ret.msg = execSync(`net helpmsg ${exitCode}`).toString()
				}
				catch (err) {
					ret.msg = 'Unknown exit code: ' + exitCode
				}
			}

			ret.stderr = await this.downloadText(esxiHost, vmUser, vmPassword, 'C:\\err.txt')
			ret.stdout = await this.downloadText(esxiHost, vmUser, vmPassword, 'C:\\out.txt')
			if (exitCode !== 0 || ret.stderr !== '') {
				console.log('>> SCRIPT STDOUT >>:', ret.stdout)
				console.log('>> SCRIPT STDERR >>:', ret.stderr)
			}

			return Promise.resolve(ret)

		} catch (err) {
			if (err.message && err.message === 'The guest operations agent could not be contacted.') {
				return Promise.resolve({
					exitCode: 0,
					msg: 'reboot'
				})
			} else {
				console.error(`execFileInGuest ${filePath} failed, error: `, err)
				return Promise.reject(err)
			}
		}
	}


	/**
	 * [runScriptInGuest  execute script in vm]
	 * @param  {[string]} esxiHost   
	 * @param  {[string]} vmUser     
	 * @param  {[string]} vmPassword 
	 * @param  {[string]} script     
	 * @return {[object]} {exitCode, msg}            
	 */
	async runScriptInGuest(esxiHost, vmUser, vmPassword, script, timeoutMillis) {
		let str2Stream = function (str) {
			let s = new Readable()
			s._read = function noop() { }
			s.push(str)
			s.push(null)
			return s
		}

		let stream = str2Stream(script)
		let streamSize = script.length
		let targetPathInGuest = 'C:\\temp.bat'

		try {
			await this.uploadStream(esxiHost, vmUser, vmPassword, targetPathInGuest, stream, streamSize)
			return await this.execFileInGuest(esxiHost, vmUser, vmPassword, targetPathInGuest, timeoutMillis)
		} catch (err) {
			if (err.toString().includes('EHOSTUNREACH')) {
				return this.runScriptInGuest(esxiHost, vmUser, vmPassword, script, timeoutMillis)
			} else {
				console.error('Run script in vm failed, error: ', err)
				return Promise.reject(err)
			}
		}
	}

	/**
	 * [reboot reboot the vm]
	 * @param  {[String]} esxiHost      
	 * @param  {[String]} vmUser        
	 * @param  {[String]} vmPassword    
	 * @param  {[Number]} timeoutMillis 
	 * @return {[Void]}               
	 */
	async reboot(esxiHost, vmUser, vmPassword, timeoutMillis) {
		timeoutMillis = timeoutMillis ? timeoutMillis : 5 * 60 * 1000
		try {
			let script = 'shutdown /r /t 15'
			let ret = await this.runScriptInGuest(esxiHost, vmUser, vmPassword, script, 5 * 60 * 1000)
			if (ret.exitCode !== 0) {
				console.log('reboot vm script ret ', ret)
				return Promise.reject(ret)
			}

			let vmIP = await this.getIPAddress()
			const checkReboot = require('launchpad-commonlib').checkReboot

			return new Promise((resolve, reject) => {
				setTimeout(() => checkReboot.waitConnect(vmIP)
					.then(resolve)
					.catch(reject),
				timeoutMillis)
			})
		} catch (err) {
			console.error('reboot vm failed, error: ', err)
			return Promise.reject(err)
		}
	}
}

module.exports = VirtualMachine