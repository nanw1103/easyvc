'use strict'

const BaseMob = require('../BaseMob.js')

class HttpNfcLease extends BaseMob {
	waitReady(timeoutMillis) {
		let vim = this._service.vim
		return this.waitState('state', vim.HttpNfcLeaseState.ready.toString(), timeoutMillis)
	}
}


module.exports = HttpNfcLease