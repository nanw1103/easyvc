'use strict'

const FileManager = require('./FileManager.js')
const ProcessManager = require('./ProcessManager.js')
const { delay, retry } = require('otherlib')

class GuestManager {
	constructor (vm, user, password, esxiAddress, options) {
		this.vm = vm
		this.user = user
		this.password = password
		this.esxiAddress = esxiAddress
		this.options = options
	}

	//////////////////////////////////////////////////////////////////////////////////////////////
	//	Helper
	//////////////////////////////////////////////////////////////////////////////////////////////
	_auth() {
		return this.vm._service.vim.NamePasswordAuthentication({
			username: this.user,
			password: this.password,
			interactiveSession: false
		})
	}

	file(options) {
		let effective = Object.assign({}, this.options, options)
		return new FileManager(this, effective)
	}

	process(options) {
		let effective = Object.assign({}, this.options, options)
		return new ProcessManager(this, effective)
	}

	async testSanity() {

		let guestId = await this.vm.get('config.guestId')
		if (!guestId)
			throw 'Can not determine OS: ' + guestId
		this.isWindows = guestId.toLowerCase().indexOf('windows') >= 0

		let cmd
		let args

		if (this.isWindows) {
			cmd = 'c:\\Windows\\system32\\cmd.exe'
			args = '/c time /t'
		} else {
			cmd = '/bin/date'
			args = ''
		}
		
		let impl = () => this.process({log:false}).runAndWait(cmd, args, null, null, 10000)

		return retry(impl, {
			name: `Guest sanity test ${this.vm.mor.value}`,
			filter: e => e.toString().includes('EHOSTUNREACH'),
			retry: 5,
			intervalMs: 10000
		})
	}

	/**
	 * [reboot reboot the vm]
	 * @param  {[Number]} timeoutMillis
	 * @return {[Void]}
	 */
	async reboot(timeoutMillis) {
		timeoutMillis = timeoutMillis ? timeoutMillis : 5 * 60 * 1000
		try {
			let script = 'shutdown /r /t 15'
			let ret = await this.runScriptInGuest(this.vm.getEsxiHost(), this.user, this.assword, script, 5 * 60 * 1000)
			if (ret.exitCode !== 0) {
				console.log('reboot vm script ret ', ret)
				return Promise.reject(ret)
			}

			//wait
			await delay(10000)

			//get ip

			let vmIP = await this.vm.getIPAddress()
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

module.exports = GuestManager