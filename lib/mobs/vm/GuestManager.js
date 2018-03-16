'use strict'

const FileManager = require('./FileManager.js')
const ProcessManager = require('./ProcessManager.js')
const { retry } = require('otherlib')

class GuestManager {
	constructor (vm, user, password, options) {
		this.vm = vm
		this.user = user
		this.password = password
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

	async run(scriptText, timeoutMs) {

		if (await this.vm.isWindows())
			scriptText = formalizeScript(scriptText)

		return this.process().runScript(scriptText, timeoutMs)
	}

	async testSanity() {

		let isWindows = await this.vm.isWindows()
		let cmd
		let args

		if (isWindows) {
			cmd = 'c:\\Windows\\system32\\cmd.exe'
			args = '/c time /t'
		} else {
			cmd = '/bin/date'
			args = ''
		}
		
		let impl = () => this.process({log:false}).runAndWait(cmd, args, null, null, 10000)

		return retry(impl, {
			name: `Guest sanity test ${this.vm.mor.value}`,
			filterReject: e => e.toString().includes('EHOSTUNREACH'),
			retry: 5,
			intervalMs: 10000
		})
	}
}

function formalizeScript(text) {
	return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
}

module.exports = GuestManager