'use strict'

const { delay } = require('otherlib')
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

		await delay(1000)
		await task.waitState('info.state', vim.TaskInfoState.success.toString(), 30 * 1000)

		if (timeoutMs === -1)
			return
		if (timeoutMs === undefined)
			timeoutMs = 2 * 60 * 1000
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

		await delay(1000)
		await task.waitState('info.state', vim.TaskInfoState.success.toString(), 30 * 1000)

		if (timeoutMs === -1)
			return
		if (timeoutMs === undefined)
			timeoutMs = 2 * 60 * 1000
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

		if (timeoutMs === -1)
			return
		if (timeoutMs === undefined)
			timeoutMs = 2 * 60 * 1000
		return this.waitPowerOff(timeoutMs)
	}

	/**
	 * [reboot reboot the vm]
	 * @param  {[Number]} timeoutMs
	 * @return {[promise]}
	 */
	async reboot(timeoutMs) {

		if (timeoutMs === undefined)
			timeoutMs = 5 * 60 * 1000

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
		return this.waitState('summary.guest.toolsRunningStatus', vim.VirtualMachineToolsRunningStatus.guestToolsRunning.toString(), timeoutMs, )
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
	
	async isWindows() {
		if (this._isWindows === undefined) {
			let guestId = await this.get('config.guestId')
			if (!guestId)
				throw 'Can not determine OS: ' + guestId
			this._isWindows = guestId.toLowerCase().indexOf('windows') >= 0
		}
		return this._isWindows
	}

	//////////////////////////////////////////////////////////////////////////////////
	//	Guest operations (file, process, ...)
	//////////////////////////////////////////////////////////////////////////////////
	guest(user, password, options) {
		return new GuestManager(this, user, password, options)
	}
	/**
	 * Create Snapshot
	 * @param {[string]} name
	 * @param {[string]} description
	 * @param {[boolean]} memory
	 * @param {[boolean]} quiesce
	 */
	async createSnapshot(name, description, memory, quiesce) {
		try {
			let vim = this._service.vim
			let vimPort = this._service.vimPort
			let snapshotTaskMor = await vimPort.createSnapshotTask(this.mor, name, description, memory, quiesce)
			let task = mob(this._service, snapshotTaskMor)
			await task.waitState('info.state', vim.TaskInfoState.success.toString())
		} catch (err) {
			return Promise.reject(err)
		}
	}

	async _snapshot() {
		try {
			let snapshot = await this.get('snapshot')
			return snapshot
		} catch(err) {
			return Promise.reject(err)
		}
	}
	async getCurrentSnapshot() {
		try {
			let snapshot = await this._snapshot()
			if (!snapshot)
				return null

			let currentSnapshot = snapshot.currentSnapshot
			return mob(this._service, currentSnapshot)
		} catch(err) {
			return Promise.reject(err)
		}
	}

	/**
	 *
	 * @param {[array]} snapshotTree
	 * @param {[string]} name
	 * @private
	 */
	_findSnapshotInTree(snapshotTree, name) {
		for (let i = 0; i < snapshotTree.length; ++i) {
			let t = snapshotTree[i];

			let snapshotName = t.name
			if (snapshotName === name)
				return mob(this._service, t.snapshot)

			let snapshot = this._findSnapshotInTree(t.childSnapshotList, name)
			if (snapshot !== null)
				return snapshot
		}

		return null
	}

	async findSnapshotByName(name) {
		try {
			if (!name || name === '')
				return await getCurrentSnapshot()

			let snapshot = await this._snapshot()
			if (!snapshot)
				return null

			let s = this._findSnapshotInTree(snapshot.rootSnapshotList, name)
			return s

		} catch(err) {
			return Promise.reject(err)
		}
	}

	/**
	 *
	 * @param {ManagedObjectReference} snapshotMor
	 * @param {string} cloneVmName
	 * @param {boolean} powerOn
	 * @param {ManagedObjectReference (Optional)} resPoolMor
	 * @returns {Promise<void>}
	 */
	async createLinkedClone(snapshotMor, cloneVmName, powerOn, resPoolMor) {
		let diskKeys = await this.getIndependenetVirtualDiskKeys()
		if (diskKeys.length > 0)
			return Promise.reject('Linked Clone not support for vm contains independent disk')

		if (!resPoolMor) {
			let resPool = await this.get('resourcePool')
			resPoolMor = resPool.mor
		}


		let vim = this._service.vim
		let vimPort = this._service.vimPort

		let rSpec = new vim.VirtualMachineRelocateSpec()
		rSpec.diskMoveType = vim.VirtualMachineRelocateDiskMoveOptions.createNewChildDiskBacking.toString()
		rSpec.pool = resPoolMor

		let cloneSpec = new vim.VirtualMachineCloneSpec()
		cloneSpec.powerOn = powerOn
		cloneSpec.template = false
		cloneSpec.location = rSpec
		if (snapshotMor !== null)
			cloneSpec.snapshot = snapshotMor
		else {
			//no snapshot specified. Copy of the current state disk.
			rSpec.diskMoveType = vim.VirtualMachineRelocateDiskMoveOptions.moveChildMostDiskBacking.toString()
		}
		cloneSpec.config = new vim.VirtualMachineConfigSpec()

		let folder = await this.get('parent')

		try {
			let cloneTaskMor = await vimPort.cloneVMTask(this.mor, folder.mor, cloneVmName, cloneSpec)
			let cloneTask = mob(this._service, cloneTaskMor)
			await cloneTask.waitState('info.state', vim.TaskInfoState.success.toString())

		} catch (err) {
			return Promise.reject(err)
		}
	}

	async getIndependenetVirtualDiskKeys() {
		let devices = await this.get('config.hardware.device')
		let diskKeys = []
		for (let i = 0; i < devices.length; ++i) {
			let device = devices[i]
			if (device.controllerKey === 1000) {
				let diskMode = device.backing.diskMode
				if (diskMode.includes('independent'))
					diskKeys.push(device.key)
			}
		}

		return diskKeys
	}

	async convert2Template() {
		let vimPort = this._service.vimPort
		return vimPort.markAsTemplate(this.mor)
	}
}

module.exports = VirtualMachine