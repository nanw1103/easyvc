'use strict'

const mob = require('../mob.js')
const BaseMob = require('../BaseMob.js')
const GuestManager = require('./vm/GuestManager.js')

class VirtualMachine extends BaseMob {

	//////////////////////////////////////////////////////////////////////////////////
	//	Power operations
	//////////////////////////////////////////////////////////////////////////////////
	async powerOn(timeoutMillis) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort
		let taskMor = await vimPort.powerOnVMTask(this.mor)
		let task = mob(this._service, taskMor)
		let ret = await task.waitState('info.state', vim.TaskInfoState.success.toString(), timeoutMillis)
		return ret
	}

	async powerOff(timeoutMillis) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort
		let taskMor = await vimPort.powerOffVMTask(this.mor)
		let task = mob(this._service, taskMor)
		let ret = await task.waitState('info.state', vim.TaskInfoState.success.toString(), timeoutMillis)
		return ret
	}

	async waitPowerOn(timeoutMillis) {
		let vim = this._service.vim
		let ret = await this.waitState('runtime.powerState', vim.VirtualMachinePowerState.poweredOn.toString(), timeoutMillis)
		return ret
	}

	async waitPowerOff(timeoutMillis) {
		let vim = this._service.vim
		let ret = await this.waitState('runtime.powerState', vim.VirtualMachinePowerState.poweredOff.toString(), timeoutMillis)
		return ret
	}

	async isPowerOff() {
		let stat = await this.get('runtime.powerState')
		return stat === this._service.vim.VirtualMachinePowerState.poweredOff.toString()
	}

	//////////////////////////////////////////////////////////////////////////////////
	//	Lifecycle
	//////////////////////////////////////////////////////////////////////////////////
	async destroy() {
		let svc = this._service
		let deleteVMTaskMor = await svc.vimPort.destroyTask(this.mor)
		let task = mob(svc, deleteVMTaskMor)
		let data = await task.waitState('info.state', svc.vim.TaskInfoState.success.toString())
		return data
	}

	//////////////////////////////////////////////////////////////////////////////////
	//	CD operations
	//////////////////////////////////////////////////////////////////////////////////
	async getCdromInfo() {
		let cdroms = []
		let devices = await this.get('config.hardware.device')

		if (!Array.isArray(devices)) {
			console.log(devices)
			return Promise.reject('Not found hardware device')
		}

		devices.forEach(device => {
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
	}

	async detachCD() {
		let vim = this._service.vim
		let vimPort = this._service.vimPort

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
	}


	async attachCD(key, datastoreMoid, isoPath) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort

		let datastoreMor = vim.ManagedObjectReference({
			value: datastoreMoid,
			type: 'Datastore'
		})

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
	}

	//////////////////////////////////////////////////////////////////////////////////
	//	VM Tools
	//////////////////////////////////////////////////////////////////////////////////
	async waitForVmTools(timeoutMillis) {
		let vim = this._service.vim
		let ret = await this.waitState('summary.guest.toolsRunningStatus', vim.VirtualMachineToolsRunningStatus.guestToolsRunning.toString(), timeoutMillis)
		return ret
	}

	installVmTools(timeoutMillis) {
		return this._service.vimPort
			.mountToolsInstaller(this.mor)
			.then(() => this.waitForVmTools(timeoutMillis))
	}

	//////////////////////////////////////////////////////////////////////////////////
	//	Properties
	//////////////////////////////////////////////////////////////////////////////////
	getIPAddress() {
		return this.get('summary.guest.ipAddress')
	}

	//////////////////////////////////////////////////////////////////////////////////
	//	Guest operations (file, process, ...)
	//////////////////////////////////////////////////////////////////////////////////
	async guest(user, password, esxiAddress, options) {
		let guest = new GuestManager(this, user, password, esxiAddress, options)
		await guest.testSanity()
		return guest
	}
}

module.exports = VirtualMachine