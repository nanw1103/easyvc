'use strict'

const mob = require('../mob.js')
const BaseMob = require('../BaseMob.js')
const GuestManager = require('./vm/GuestManager.js')

class VirtualMachine extends BaseMob {

	//////////////////////////////////////////////////////////////////////////////////
	//	Power operations
	//////////////////////////////////////////////////////////////////////////////////
	async powerOn(timeoutMs) {
		let vim = this._service.vim
		let current = await this.get('runtime.powerState')
		if (current === vim.VirtualMachinePowerState.poweredOn.toString())
			return

		let vimPort = this._service.vimPort
		let taskMor = await vimPort.powerOnVMTask(this.mor)
		let task = mob(this._service, taskMor)
		await task.waitState('info.state', vim.TaskInfoState.success.toString(), 30 * 1000)

		if (timeoutMs === undefined)
			return
		return this.waitPowerOn(timeoutMs)
	}

	async powerOff(timeoutMs) {
		let vim = this._service.vim
		let current = await this.get('runtime.powerState')
		if (current === vim.VirtualMachinePowerState.poweredOff.toString())
			return

		let vimPort = this._service.vimPort
		let taskMor = await vimPort.powerOffVMTask(this.mor)
		let task = mob(this._service, taskMor)
		await task.waitState('info.state', vim.TaskInfoState.success.toString(), 30 * 1000)

		if (timeoutMs === undefined)
			return
		return this.waitPowerOff(timeoutMs)
	}

	async isPowerOff() {
		let stat = await this.get('runtime.powerState')
		return stat === this._service.vim.VirtualMachinePowerState.poweredOff.toString()
	}

	async waitPowerOn(timeoutMs) {
		return this.waitState('runtime.powerState', this._service.vim.VirtualMachinePowerState.poweredOn.toString(), timeoutMs)
	}
	async waitPowerOff(timeoutMs) {
		return this.waitState('runtime.powerState', this._service.vim.VirtualMachinePowerState.poweredOff.toString(), timeoutMs)
	}

	async shutdownGuest(timeoutMs) {
		let vim = this._service.vim
		let current = await this.get('runtime.powerState')
		if (current === vim.VirtualMachinePowerState.poweredOff.toString())
			return

		await this.waitForVmTools(10 * 1000)
		await this._service.vimPort.shutdownGuest(this.mor)

		if (timeoutMs === undefined)
			return
		
		return this.waitPowerOff(timeoutMs)
	}

	/**
	 * [forceRebootGuest reboot the vm]
	 * @param  {[Number]} timeoutMs
	 * @return {[promise]}
	 */
	async forceRebootGuest(timeoutMs) {
		let start = Date.now()
		let timeLeft = () => timeoutMs - (Date.now() - start)
		try {
			await this.shutdownGuest((timeoutMs/2)|0)
		} catch (e) {
			await this.powerOff(timeLeft())
		}
		
		await this.powerOn(timeLeft())
		await this.waitForVmTools(timeLeft())
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
	async waitForVmTools(timeoutMs) {
		let vim = this._service.vim
		return this.waitState('summary.guest.toolsRunningStatus', vim.VirtualMachineToolsRunningStatus.guestToolsRunning.toString(), timeoutMs)
	}

	async installVmTools(timeoutMs) {
		return this._service.vimPort
			.mountToolsInstaller(this.mor)
			.then(() => this.waitForVmTools(timeoutMs))
	}

	//////////////////////////////////////////////////////////////////////////////////
	//	Properties
	//////////////////////////////////////////////////////////////////////////////////
	async getIPAddress() {
		return this.get('summary.guest.ipAddress')
	}
	
	//////////////////////////////////////////////////////////////////////////////////
	//	Guest operations (file, process, ...)
	//////////////////////////////////////////////////////////////////////////////////
	async guest(user, password, options) {
		let guest = new GuestManager(this, user, password, options)
		await guest.testSanity()
		return guest
	}
}

module.exports = VirtualMachine