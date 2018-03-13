'use strict'

const BaseMob = require('../BaseMob.js')

class Datastore extends BaseMob {

	createDirectory(name) {
		let vimPort = this._service.vimPort
		let datastoreNamespaceManager = this._service.serviceContent.datastoreNamespaceManager

		return vimPort.createDirectory(datastoreNamespaceManager, this.mor, name)
	}

	deleteDirectory(datacenterMor, datastorePath) {
		let vimPort = this._service.vimPort
		let datastoreNamespaceManager = this._service.serviceContent.datastoreNamespaceManager

		return vimPort.deleteDirectory(datastoreNamespaceManager, datacenterMor, datastorePath)
	}
}


module.exports = Datastore