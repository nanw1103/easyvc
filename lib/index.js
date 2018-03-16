'use strict'

/**
 * Easy wrapper for vSphere operations.
 *
 * nanw@vmware.com
 *
 */

const mob = require('./mob')
const SessionManager = require('./session-manager.js')

class EasyVc {
	
	constructor() {
		Object.defineProperty(this, 'first', {value: o => Array.isArray(o) ? o[0] : o })
		this.host = null
		this._redirectErrorToConsole = false
	}
	
	async login(host, user, password) {
		this.host = host
		let ME = this
		return SessionManager.login(host, user, password).then(() => ME)
	}
	
	async logout() {
		return SessionManager.logout(this.host)
	}
	
	async _service() {
		return SessionManager.ensureSession(this.host)
	}
	
	_serviceDirect() {
		return SessionManager.get(this.host).service
	}
	
	isLoggedIn() {		
		return !!SessionManager.get(this.host)
	}

	enableLog() {
		this._redirectErrorToConsole = true
		return this
	}

	log() {
		this._redirectErrorToConsole && console.log.apply(arguments)
	}

	isVCenter() {
		return this._serviceDirect().serviceContent.about.apiType === 'VirtualCenter'	//'HostAgent'
	}

	async _getProp(mor, name) {
		let svc = await this._service()
		let vimPort = svc.vimPort,
			vim = svc.vim,
			propertyCollector = svc.serviceContent.propertyCollector
		
		let ret = await vimPort.retrievePropertiesEx(propertyCollector, [
			vim.PropertyFilterSpec({
				objectSet: vim.ObjectSpec({
					obj: mor,
					skip: false,
				}),
				propSet: vim.PropertySpec({
					type: mor.type,
					pathSet: [name]
				})
			})
		], vim.RetrieveOptions())

		if (ret.objects[0].propSet[0] === undefined)
			return Promise.resolve()
		return Promise.resolve(ret.objects[0].propSet[0].val)
	}
	
	///////////////////////////////////////////////////////////////////////////////////////
	async findHostByIp(ip, optionalDatacenter) {
		return this.findByIp(ip, false, optionalDatacenter)
	}
	
	async findByIp(ip, findVm, optionalDatacenter) {
		findVm = !!findVm
		let svc = await this._service()
		let mor = await svc.vimPort.findByIp(svc.serviceContent.searchIndex, optionalDatacenter, ip, findVm)
		if (!mor)
			return Promise.reject(`findByIp: not found. ip=${ip}, findVM=${findVm}, dc=${optionalDatacenter}`)
		return mob(svc, mor)
	}

	async validateVC(host, user, password) {
		let ME = this
		function verify() {
			return ME.login(host, user, password)
				.catch(err => Promise.reject('Error validating VC login: host=' + host + ', user=' + user + ', err=' + err))
		}

		//due to a vsphere js sdk limitation, duplicated login always fail. Logout first
		if (this.isLoggedIn()) 
			return this.logout().catch(()=>{}).then(verify)
		return verify()
	}
	
	
	///////////////////////////////////////////////////////////////////////////////////////
	/**
	 * @param {Array<string>} type	
	 * @param {vsphere.vimService.vim.PropertySpec} propertySpec
	 * @return {Object[]} Promise<Array>
	 */
	async retrieveProperties(type, propertySpec) {
		let svc = await this._service()
		let propertyCollector = svc.serviceContent.propertyCollector,
			rootFolder = svc.serviceContent.rootFolder,				
			viewManager = svc.serviceContent.viewManager,
			vim = svc.vim,
			vimPort = svc.vimPort

		let containerView = await vimPort.createContainerView(viewManager, rootFolder, type , true)
		let specs = [
			vim.PropertyFilterSpec({
				objectSet: vim.ObjectSpec({
					obj: containerView,
					skip: true,
					selectSet: vim.TraversalSpec({
						path: 'view',
						type: 'ContainerView'
					})
				}),
				propSet: propertySpec
			})
		]
		
		return vimPort.retrieveProperties(propertyCollector, specs)
	}

	async getResourcePools() {
		let svc = await this._service()
		let propertySpec = svc.vim.PropertySpec({
			type: 'ResourcePool',
			pathSet: ['name']
		})
		return this.retrieveProperties(['ResourcePool'], propertySpec)
	}

	async getResourcePoolByName(name) {
		let pools = await this.getResourcePools()
		for (let i = 0; i < pools.length; i++) {
			let p = pools[i]
			if (p.propSet[0].val === name)
				return mob(this._serviceDirect(), p.obj)
		}
		return Promise.reject(`ResourcePool not found: ${name}`)
	}

	async getDatastores() {
		let svc = await this._service()
		let propertySpec = svc.vim.PropertySpec({
			type: 'Datastore',
			pathSet: ['name']
		})
		return this.retrieveProperties(['Datastore'], propertySpec)
	}

	async getDatastoreByName(name) {
		let datastores = await this.getDatastores()
		for (let i = 0; i < datastores.length; i++) {
			let dt = datastores[i]
			if (dt.propSet[0].val === name)
				return mob(this._serviceDirect(), dt.obj)
		}
		return Promise.reject(`Datastore not found: ${name}`)
	}
	
	async getDatacenter(esxiIp) {	
		let esxiHost = await this.findHostByIp(esxiIp)
		return esxiHost.getDatacenter()
	}

	async getEsxiDatacenterName(esxiIp) {	
		let esxiHost = await this.findHostByIp(esxiIp)
		let datacenter = await esxiHost.getDatacenter()
		return datacenter.get('name')
	}
	
	/**
	 * @param {string} esxiHost
	 * @param {string} name
	 * @return {Object} Promise<string> valid VM name
	 */
	async avoidSameName(esxiHost, name) {	
		let calcUniqueName = function(vms, name, index) {
			let testName = index ? (name + ' (' + index + ')') : name
			if (vms.find(vm => vm.name === testName))
				return calcUniqueName(vms, name, index + 1)
			return testName
		} 
		let vms = await esxiHost.listAllVMs()
		return calcUniqueName(vms, name, 0)
	}

	async findObjByName(propertyType, name) {
		let svc = await this._service()
		
		let vim = svc.vim
		let type = [propertyType]
		let propertySpec = vim.PropertySpec({
			type: propertyType,
			pathSet: ['name']
		})
		let dataArray = await this.retrieveProperties(type, propertySpec)
		for (let i = 0; i < dataArray.length; i++) {
			let dt = dataArray[i]
			if (dt.propSet[0].val === name)
				return dt.obj
		}
		return Promise.reject(`findObjByName: not found. type=${propertyType}, name=${name}`)
	}

	async findNetworkByName(networkName) {
		return this.findObjByName('Network', networkName)
	}

	async createVM(vmName, isoPath, autounattendIsoPath, datastoreName, networkName, networkType, esxiIp) {

		let ME = this
		let memoryMB = 4096
		let cpuNum = 2
		
		let svc = await this._service()
		let vim = svc.vim
		let vimPort = svc.vimPort
		let ctx = {}
		
		async function initNetwork() {
			let virtualE1000 = {
				deviceInfo: vim.Description({
					label: 'Network Adapter 1',
					summary: networkName || 'VM Network'
				}),

				addressType: 'generated', //'assigned' just only support create vm at vcenter, not support create vm at esxi
				connectable: vim.VirtualDeviceConnectInfo({
					allowGuestControl: true,
					connected: true,
					startConnected: true
				}),
				controllerKey: 100,
				key: 4000,
				wakeOnLanEnabled: true
			}
			ctx.networkConfig = virtualE1000
			
			if (networkType === 'DistributedVirtualPortgroup') {

				async function genVirtualPortBackingInfo(networkName) {		
					ME.network = await ME.findNetworkByName(networkName)
					let virtualSwitch = await ME._getProp(ME.network, 'config.distributedVirtualSwitch')
					ME.uuid = await ME._getProp(virtualSwitch, 'uuid')
					let key = await ME._getProp(ME.network, 'key')
					return vim.VirtualEthernetCardDistributedVirtualPortBackingInfo({
						port: vim.DistributedVirtualSwitchPortConnection({			
							portgroupKey: key,
							switchUuid: ME.uuid
						})
					})
				}

				virtualE1000.backing = await genVirtualPortBackingInfo(networkName)
				return virtualE1000
			} else {
				virtualE1000.backing = vim.VirtualEthernetCardNetworkBackingInfo({
					deviceName: networkName || 'VM Network',
					useAutoDetect: false,
					network: await ME.findNetworkByName(networkName)
				})					
				return Promise.resolve(virtualE1000)
			}
		}
		
		async function createVM(esxiHost, name, vmFolder, pool, datastoreMor, networkConfig) {							
			// VMFI
			let vmfi = vim.VirtualMachineFileInfo({
				vmPathName: '[' + datastoreName + ']'
			})

			let virtualSCSI = vim.VirtualLsiLogicSASController({
				key: 1000,
				busNumber: 0,
				sharedBus: vim.VirtualSCSISharing.noSharing
			})

			let SCSISpec = vim.VirtualDeviceConfigSpec({
				device: virtualSCSI,
				operation: vim.VirtualDeviceConfigSpecOperation.add
			})

			let virtualDisk = vim.VirtualDisk({
				capacityInKB: 40000000,
				key: 2000,
				unitNumber: 0,
				controllerKey: 1000,
				backing: vim.VirtualDiskFlatVer2BackingInfo({
					fileName: '[' + datastoreName + ']',// + vmName + '/' + vmName + '.vmdk',
					diskMode: 'persistent',
					thinProvisioned: true,
					datastore: datastoreMor
				})
			}) 

			let DiskSpec = vim.VirtualDeviceConfigSpec({
				device: virtualDisk,
				operation: vim.VirtualDeviceConfigSpecOperation.add,
				fileOperation: vim.VirtualDeviceConfigSpecFileOperation.create
			})
		
			let virtualNic = vim.VirtualE1000(networkConfig)

			let NicSpec = vim.VirtualDeviceConfigSpec({
				device: virtualNic,
				operation: vim.VirtualDeviceConfigSpecOperation.add
			})
			
			let virtualIsoCdrom = vim.VirtualCdrom({
				backing: vim.VirtualCdromIsoBackingInfo({
					datastore: datastoreMor,
					fileName: isoPath
				}),
				connectable: vim.VirtualDeviceConnectInfo({
					allowGuestControl: true,
					connected: true,
					startConnected: true
				}),
				controllerKey: 200,
				key: 3000,
				unitNumber: 0
			})
			let IsoCdromSpec = vim.VirtualDeviceConfigSpec({
				device: virtualIsoCdrom,
				operation: vim.VirtualDeviceConfigSpecOperation.add
			})
			
			let virtualIsoCdrom2 = vim.VirtualCdrom({
				backing: vim.VirtualCdromIsoBackingInfo({
					datastore: datastoreMor,
					fileName: autounattendIsoPath
				}),
				connectable: vim.VirtualDeviceConnectInfo({
					allowGuestControl: true,
					connected: true,
					startConnected: true
				}),
				controllerKey: 200,
				key: 3001,
				unitNumber: 1
			})
			let IsoCdromSpec2 = vim.VirtualDeviceConfigSpec({
				device: virtualIsoCdrom2,
				operation: vim.VirtualDeviceConfigSpecOperation.add
			})

			let virtualAtapiCdrom = vim.VirtualCdrom({
				backing: vim.VirtualCdromRemoteAtapiBackingInfo({
					deviceName: '',
					useAutoDetect: false
				}),
				connectable: vim.VirtualDeviceConnectInfo({
					allowGuestControl: true,
					connected: false,
					startConnected: false
				}),
				controllerKey: 201,
				key: 3002,
				unitNumber: 0
			})

			let AtapiCdromSpec = vim.VirtualDeviceConfigSpec({
				device: virtualAtapiCdrom,
				operation: vim.VirtualDeviceConfigSpecOperation.add
			})

			// key point: specify VM config
			let vmConfigSpec = vim.VirtualMachineConfigSpec({
				name: name,
				annotation: 'VM Annotation',
				memoryMB: memoryMB,
				numCPUs: cpuNum,
				guestId: 'windows7Server64Guest',	//windows8Server64Guest  (2012)
				deviceChange: [						// specify devices
					SCSISpec,
					DiskSpec,
					NicSpec,
					IsoCdromSpec,
					IsoCdromSpec2,
					AtapiCdromSpec							
				],
				files: vmfi
			})
			ME.log('start creating VM')
			// start create VM task
			let task = await vimPort.createVMTask(vmFolder.mor, vmConfigSpec, pool.mor, esxiHost.mor)
			let vmTask = mob(svc, task)
			// wait for task success																				
			await vmTask.waitState('info.state', vim.TaskInfoState.success.toString(), 60 * 1000)
			
			// create VM success								
			// check VM MOR
			let result = await vmTask.get('info')
			
			let vmMor = result.result
			ME.log('create VM complete')		
			return mob(svc, vmMor)
		}
		
		/*
		return ME
			.findHostByIp(null, esxiIp)						.then(host => ctx.esxiHost = host)				
			.then(host => ME.avoidSameName(host, vmName)		.then(name => ctx.name = name))
			.then(() => ctx.esxiHost.getDatacenterVmFolder()	.then(vmFolder => ctx.vmFolder = vmFolder))
			.then(() => ctx.esxiHost.getResourcePool()			.then(pool => ctx.pool = pool))				
			.then(() => ME.getDatastoreByName(datastoreName)	.then(datastore => ctx.datastore = datastore))
			.then(initNetwork)
			.then(() => createVM(ctx.esxiHost, ctx.name, ctx.vmFolder, ctx.pool, ctx.datastore.mor, ctx.networkConfig))
			.catch(err => {
				ME.log('Error creating VM: ctx=' + JSON.stringify(ctx) + ', err=' + err)
				return Promise.reject(err)
			})
		*/
		
		try {
			let host = await this.findHostByIp(esxiIp)
			let name = await this.avoidSameName(host, vmName)
			let vmFolder = await host.getDatacenterVmFolder()
			let pool = await host.getResourcePool()
			let datastore = await this.getDatastoreByName(datastoreName)
			let networkConfig = await initNetwork()
			return createVM(host, name, vmFolder, pool, datastore.mor, networkConfig)
		} catch (e) {
			let msg = 'Error creating VM: ctx=' + JSON.stringify(ctx) + ', err=' + e
			this.log(msg)
			return Promise.reject(e)
		}
	}


	/**	 
	 * @param {string} vmNameOrRegExp
	 * @return {Object} Promise<[VirtualMachine, ...]>
	 */
	async findVMsByName(vmNameOrRegExp) {
		let svc = await this._service()
		let rootFolder = svc.serviceContent.rootFolder
		let viewManager = svc.serviceContent.viewManager
		let propertyCollector = svc.serviceContent.propertyCollector
		let vimPort = svc.vimPort
		let vim = svc.vim

		function retrieveProperty(containerView) {
			let specSet = [
				vim.PropertyFilterSpec({
					objectSet: [
						vim.ObjectSpec({
							obj: containerView,
							skip: true,//false,
							selectSet: [
								vim.TraversalSpec({
									name: 'traverseEntities',
									path: 'view',
									skip: false,
									type: 'ContainerView'
								})
							]
						})
					],
					propSet: [
						vim.PropertySpec({
							type: 'VirtualMachine',
							pathSet: [ 'name' ]
						})
					]
				})
			]
			let retrieveOptions = vim.RetrieveOptions()
			return vimPort.retrievePropertiesEx(propertyCollector, specSet, retrieveOptions)
		}
		
		let finalResults = []
		function processResults(results) {
			let properties = results.objects.map(function(result) {
				if (!result.propSet || !result.propSet[0]) {
					console.error('invalid propSet: ' + JSON.stringify(results) + ' at findVMsByName')
					return
				}

				let mor = result.obj
				let name = result.propSet[0].val
				let vm = mob(svc, mor)
				vm.name = name
				return vm
			})

			const filterByName = p => p.name === vmNameOrRegExp
			const filterByRegExp = p => p.name.match(vmNameOrRegExp)
			let filterFunc = vmNameOrRegExp instanceof RegExp ? filterByRegExp : filterByName
			let tmp = properties.filter(filterFunc)
			finalResults = finalResults.concat(tmp)
		}
		
		function processAndContinue(results) {				
			if (!results || !results.objects)
				return Promise.resolve(finalResults)			
		
			processResults(results)
			
			if (!results.token)
				return Promise.resolve(finalResults)
			
			return vimPort.continueRetrievePropertiesEx(propertyCollector, results.token)
				.then(processAndContinue)			
		}
		
		let recursive = true
		return vimPort.createContainerView(viewManager, rootFolder, ['VirtualMachine'], recursive)
			.then(retrieveProperty)
			.then(processAndContinue)
	}


	async createDatacenter(name) {
		let svc = await this._service()		
		let mor = await svc.vimPort.createDatacenter(svc.serviceContent.rootFolder, name)
		return mob(svc, mor)
	}

	async addStandaloneHost (esxiHost, esxiUser, esxiPassword, esxiLicense, esxiSSLThumbprint, datacenterMor) {
		let svc = await this._service()
		
		let hostFolderMor = await this._getProp(datacenterMor, 'hostFolder')
		let vmFolderMor = await this._getProp(datacenterMor, 'vmFolder')
		let vim = svc.vim
		let vimPort = svc.vimPort
		let hostConnectSpec = vim.HostConnectSpec({
			force: false,
			hostName: esxiHost,
			lockdownMode: vim.HostLockdownMode.lockdownDisabled,
			userName: esxiUser,
			password: esxiPassword,
			port: 443,
			vmFolder: vmFolderMor,
			sslThumbprint: esxiSSLThumbprint || ''
		})

		let computeResourceSpec = vim.ComputeResourceConfigSpec({
			vmSwapPlacement: vim.VirtualMachineConfigInfoSwapPlacementType.vmDirectory
		})

		let taskMor = await vimPort.addStandaloneHostTask(hostFolderMor, hostConnectSpec, computeResourceSpec, true, esxiLicense)
		
		let task = mob(svc, taskMor)
		return task.waitState('info.state', 'success')
	}

	async removeStandaloneHost (esxiHost) {
		let svc = await this._service()
		let vim = svc.vim
		let vimPort = svc.vimPort
		let hostSystem = await this.findHostByIp(esxiHost)
		let computeResource = await hostSystem.get('parent')
		let taskMor = await vimPort.destroyTask(computeResource.mor)
		let destroyTask = mob(svc, taskMor)

		return destroyTask.waitState('info.state', vim.TaskInfoState.success.toString())
	}

	async licenseManager() {
		let svc = await this._service()
		return mob(svc, svc.serviceContent.licenseManager)
	}

	async createVsanDirectory(datastoreName, dirName) {
		let datastore = await this.getDatastoreByName(datastoreName)
		return datastore.createDirectory(dirName)
			.catch(err => {
				console.log('Error creating directory:', dirName, err)
				return Promise.resolve()
			})
	}

	async makeDirectory(datacenterMor, datastoreName, dirName) {
		let svc = await this._service()
		let vimPort = svc.vimPort
		let fileManager = svc.serviceContent.fileManager
		let path = `[${datastoreName}] ${dirName}`
		let createParentDirectories = true
		return vimPort.makeDirectory(fileManager, path, datacenterMor, createParentDirectories)
			.catch(() => Promise.resolve())
	}

	async createImportSpec(vmName, ovfContent, datastoreMor, networkMor, resourePoolMor, vidm, ad) {
		let svc = await this._service()
		let vim = svc.vim
		let vimPort = svc.vimPort
		let ovfManager = svc.serviceContent.ovfManager

		// parameters config
		let vamitimezone = 'Etc/UTC'
		let ceipEnabled = 'False'
		let vamiHostname = vidm.hostName
		let gateway = vidm.gateway
		let domain = ad.domainName
		let searchpath = ''
		let dns = ad.host
		let ip0 = vidm.ip
		let netmask0 = vidm.subnetMask

		if (domain && vamiHostname.indexOf(domain) < 0) {
			if (vamiHostname.indexOf('.', vamiHostname.length - 1) === -1)
				vamiHostname += '.'

			vamiHostname += domain
		}

		let cisp = vim.OvfCreateImportSpecParams({
			deploymentOption: '',
			diskProvisioning: 'Thin',
			entityName: vmName,
			instantiationOst: vim.OvfConsumerOstNode({
				id: '',
				type: vim.OvfConsumerOstNodeType.envelope
			}),
			ipProtocol: 'IPv4',
			locale: 'US',
			networkMapping: [ vim.OvfNetworkMapping({
				name: 'Network 1',
				network: networkMor
			}) ],
			propertyMapping: [
				vim.KeyValue({
					key: 'vamitimezone',
					value: vamitimezone
				}),
				vim.KeyValue({
					key: 'ceip.enabled',
					value: ceipEnabled
				}),
				vim.KeyValue({
					key: 'vami.hostname',
					value: vamiHostname
				}),
				vim.KeyValue({
					key: 'vami.gateway.IdentityManager',
					value: gateway
				}),
				vim.KeyValue({
					key: 'vami.domain.IdentityManager',
					value: domain
				}),
				vim.KeyValue({
					key: 'vami.searchpath.IdentityManager',
					value: searchpath
				}),
				vim.KeyValue({
					key: 'vami.DNS.IdentityManager',
					value: dns
				}),
				vim.KeyValue({
					key: 'vami.ip0.IdentityManager',
					value: ip0
				}),
				vim.KeyValue({
					key: 'vami.netmask0.IdentityManager',
					value: netmask0
				})
			]
		})


		return vimPort.createImportSpec(ovfManager, ovfContent, resourePoolMor, datastoreMor, cisp)
	}

	async importVApp(resourcePoolMor, importSpec, vmFolderMor, hostSystemMor) {
		let svc = await this._service()
		let httpNfcLeaseMor = await svc.vimPort.importVApp(resourcePoolMor, importSpec, vmFolderMor, hostSystemMor)
		return mob(svc, httpNfcLeaseMor)
	}

	Mob(mor) {
		return mob(this._serviceDirect(), mor)
	}

	/**
	 * clone vm through template
	 *
	 * @param {string} templateName
	 * @param {string} cloneVmName
	 * @param {boolean} powerOn
	 * @param {ManagedObjectReference} resPoolMor
	 * @param {ManagedObjectReference (Optional)} dataStoreMor
	 * @returns {Promise<*>}
	 */
	async cloneVMByTemplate(templateName, cloneVmName, powerOn, resPoolMor, dataStoreMor) {
		try {
			let vms = await this.findVMsByName(templateName)
			if (vms.length == 0)
				return Promise.reject(`${templateName} does not exist`)
			let vm = vms[0]

			let diskKeys = await vm.getIndependenetVirtualDiskKeys()
			if (diskKeys.length > 0)
				return Promise.reject('Clone not support for vm contains independent disk')


			let svc = await this._service()
			let vim = svc.vim
			let vimPort = svc.vimPort

			let rSpec = new vim.VirtualMachineRelocateSpec()
			rSpec.pool = resPoolMor

			if (dataStoreMor)
				rSpec.datastore = dataStoreMor

			let cloneSpec = new vim.VirtualMachineCloneSpec()
			cloneSpec.powerOn = powerOn
			cloneSpec.template = false
			cloneSpec.location = rSpec
			cloneSpec.config = new vim.VirtualMachineConfigSpec()

			let folder = await vm.get('parent')
			let cloneTaskMor = await vimPort.cloneVMTask(vm.mor, folder.mor, cloneVmName, cloneSpec)
			let cloneTask = mob(svc, cloneTaskMor)

			await cloneTask.waitState('info.state', vim.TaskInfoState.success.toString(), 60 * 60 * 1000)

		} catch(err) {
			console.error(`clone ${templateName} failed.`, err)
			return Promise.reject(err)
		}
	}
} 

module.exports = () => new EasyVc
