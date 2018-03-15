'use strict'

const BaseMob = require('../BaseMob.js')
const mob = require('../mob.js')

class HostSystem extends BaseMob {
	async findNetworkByName(name) {
		try {
			let networks = await this.get('network')
			let network
			for (let i=0; i<networks.length; i++) {
				let curNetwork = networks[i]
				let curName = await curNetwork.get('name')
				if (curName === name) {
					network = curNetwork
					break
				}
			}

			return network

		} catch(err) {
			return Promise.reject(err)
		}
	}
    
	recommendDatastore(freeSpaceFirst) {
		return new Promise((resolve, reject) => {
			this.get('datastore').then((datastores) => {

				this.get('config').then((config) => {

					function isDatastoreReadonly(name) {
						if (!(config && config.fileSystemVolume && config.fileSystemVolume.mountInfo))
							return

						var mountInfo = config.fileSystemVolume.mountInfo
						//for (m of mountInfo) {
						for (var i = 0; i < mountInfo.length; i++) {
							var m = mountInfo[i]
							if (m.volume.name === name) {
								return m.mountInfo.accessMode === 'readOnly'
							}
						}
					}

					var best
					var bestSSD
					var processed = 0

					for (var i = 0; i < datastores.length; i++) {

						var ds = datastores[i]
						ds.get(['summary', 'info']).then((props) => {

							//TODO------
							//check mount info to get readonly state, from host: 
							//  config  HostConfigInfo
							//      fileSystemVolume (HostFileSystemVolumeInfo)
							//          mountInfo   (HostFileSystemMountInfo[])
							//config.fileSystemVolume.mountInfo

							//console.log(props);
							var isReadonly = isDatastoreReadonly(props.summary.name)
							if (isReadonly)
								console.log('READONLY: ' + props.summary.name)

							if (props.summary.accessible && !isReadonly) {
								if (!best || props.summary.freeSpace > best.summary.freeSpace)
									best = props
								if (!freeSpaceFirst && props.info.vmfs && props.info.vmfs.ssd && props.summary.freeSpace > 1024 * 1024 * 1024 * 100 && (!bestSSD || props.summary.freeSpace > bestSSD.summary.freeSpace))
									bestSSD = props
							}

							if (++processed == datastores.length) {
								best = bestSSD ? bestSSD : best
								var ret = mob(this._service, best.summary.datastore)
								ret.summary = best.summary
								ret.info = best.info
								resolve(ret)
							}
						}).catch((err) => {
							this._redirectErrorToConsole && console.log(err)
							reject(err)
						})
					}
				}).catch((err) => {
					this._redirectErrorToConsole && console.log(err)
					reject(err)
				})
			}).catch((err) => {
				this._redirectErrorToConsole && console.log(err)
				reject(err)
			})
		})         
	}


	// appended by huang.
	async selectedDatastoreByName(datastoreName) {
		console.log('datastoreName in selectedDatastoreByName(): ', datastoreName)
		try {
			let datastores = await this.get('datastore')
			for (let i = 0; i < datastores.length; i++) {
				let ds = datastores[i]
				let props = await ds.get(['summary', 'info'])
				if (props.summary.name == datastoreName) {
					console.log('datastore props.summary.name: ', props.summary.name, '; datastoreName: ', datastoreName)
					let ret = mob(this._service, props.summary.datastore)
					ret.summary = props.summary
					ret.info = props.info
					return ret
				}
			}

		} catch(err) {
			return Promise.reject(err)
		}
	}

	// to list all the datastore.
	async listAllDatastoresName() {
		try {
			let datastores = await this.get('datastore')
			let config = await this.get('config')
			function isDatastoreReadonly(name) {
				if (!(config && config.fileSystemVolume && config.fileSystemVolume.mountInfo))
					return

				let mountInfo = config.fileSystemVolume.mountInfo
				for (let i = 0; i < mountInfo.length; i++) {
					let m = mountInfo[i]
					if (m.volume.name === name)
						return m.mountInfo.accessMode === 'readOnly'
				}
			}

			let datastoresNameList = []
			for (let i = 0; i < datastores.length; i++) {
				let datastoreInfo = await datastores[i].get(['summary', 'info'])
				let isReadonly = isDatastoreReadonly(datastoreInfo.summary.name)
				if (isReadonly)
					console.log('DATASTORE READONLY: ' + datastoreInfo.summary.name)
				else
					datastoresNameList.push(datastoreInfo.summary.name)
			}

			return datastoresNameList

		} catch(err) {
			return Promise.reject(err)
		}
	}

	async isNetworkDownLink(network) {
		try {
			let name = await network.get('name')
			let configInfo = await network.get('config')
			if ((configInfo != null) && configInfo['uplink'])
				return {'uplink': true, 'name' : name}
			else
				return {'uplink' : false, 'name' : name}

		} catch(err) {
			return Promise.reject(err)
		}
	}

	async listAllNetworks() {
		try {
			let me = this
			let networks = await me.get('network')
			let networkDownlink = []
			for (let i = 0; i < networks.length; i++) {
				let res =  await me.isNetworkDownLink(networks[i])
				if (res && (!res.uplink))
					networkDownlink.push(res.name)
			}

			return networkDownlink

		} catch(err) {
			return Promise.reject(err)
		}
	}

	async listAllVMs() {
		try {
			let machines = await this.get('vm')
			let vms = []
			for (let i=0; i<machines.length; ++i) {
				let machine = machines[i]
				let name = await machine.get('name')
				let vm = {
					name: name,
					mor: machine.mor
				}
				vms.push(vm)
			}

			return vms
		} catch(err) {
			return Promise.reject(err)
		}
	}

	getDatacenter() {
		return this.parent('Datacenter')
	}

	async getDatacenterVmFolder() {
		try {
			let datacenter = await this.getDatacenter()
			let vmFolder = await datacenter.get('vmFolder')

			return vmFolder

		} catch(err) {
			return Promise.reject(err)
		}
	}

	async getResourcePool() {
		try {
			let resource = await this.parent('ClusterComputeResource')
			if (resource === undefined)
				resource = await this.parent('ComputeResource')

			let pool = await resource.get('resourcePool')

			return pool

		} catch(err) {
			return Promise.reject(err)
		}
	}

	getHostDatastoreSystem() {
		return this.get('configManager.datastoreSystem')
	}

	async createNasDatastore(name, remoteHost, remotePath) {
		let vim = this._service.vim
		let vimPort = this._service.vimPort
		let storage = vim.HostNasVolumeSpec({
			accessMode: 'readOnly', // 'readWrite'
			localPath: name,
			remoteHost: remoteHost,
			remotePath: remotePath
		})

		try {
			let dssystem = await this.getHostDatastoreSystem()
			let datastore = await vimPort.createNasDatastore(dssystem.mor, storage)

			return datastore

		} catch(err) {
			return Promise.reject(err)
		}
	}
}


module.exports = HostSystem
