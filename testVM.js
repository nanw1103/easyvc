const easyvc = require('./index.js')()

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
	process.exit()
})

const host = '10.117.160.100'
const user = 'asdf'
const password = 'asdf'
const esxiAddress = '10.117.160.96'

const environments = [{
	vm: 'jumpbox',
	user: 'asdf',
	pwd: 'asdf'	
}, {
	vm: 'UbuntuServer64',
	user: 'asdf',
	pwd: 'asdf'
}
]


async function test(vmName, guestUser, guestPwd) {
		
	console.log(`Testing: vm=${vmName}`)
	await easyvc.login(host, user, password)	
	console.log('logged in')
	
	let esxi = await easyvc.findHostByIp(esxiAddress)
	console.log('esxi:', esxi.mor.value)

	let vm = (await easyvc.findVMsByName(vmName))[0]
	if (!vm)
		throw 'VM not found: ' + vmName
	console.log('vm:', vm.mor.value)
	
	/*
	await vm.waitForVmTools(1000)
	console.log('VM tools ready')
	
	let ips = await vm.getIPAddress()
	console.log('ips', ips)
	//*/

	//let runtime = await vm.get('runtime')
	//console.log('runtime', runtime)
	//console.log('runtime', runtime.host)
	
	//let config = await vm.get('config')
	//console.log('config', config)

	let guest = await vm.guest(guestUser, guestPwd, {log: false})
	let fileMgr = guest.file()
	let processMgr = guest.process()


	//*
	console.log('[test mkdirp/delete]')
	let tempPath = fileMgr.tempPath()
	await fileMgr.mkdirp(tempPath + '/asdf')
	await fileMgr.delete(tempPath)
	//*/

	//*
	console.log('[test upload/download]')
	let text = 'Hello, mortal\r\n'
	tempPath = fileMgr.tempPath()
	let target = tempPath + '/test.txt'
	await fileMgr.uploadText(text, target)

	let downloadedText = await fileMgr.downloadText(target)
	if (downloadedText !== text)
		console.error('Test failed: upload/download mismatch')

	await fileMgr.delete(tempPath)
	//*/


	//*
	console.log('[test run script]')
	let script = 
`
date /t
echo hello
`
	let result = await processMgr.runScript(script, 10000)
	console.log(result.toString())
	//*/

	//console.log('summary', await vm.get('summary'))
	/*
	let out = await vm.downloadText(host, 'root', '', '/public/init.log')
	console.log('out', out)
	*/
	
	/*
	let svc = await easyvc._service()
	let vimPort = svc.vimPort
	let vim = svc.vim
	
	let spec = {	//HostVirtualSwitchSpec
		bridge: {	//HostVirtualSwitchBridge
		},
		mtu: 1500,
		numPorts: 120,
		policy: {	//HostNetworkPolicy
			nicTeaming: {	//HostNicTeamingPolicy
				failureCriteria: {	//HostNicFailureCriteria
					checkBeacon: false,
					checkDuplex: false,
					checkErrorPercent: false,
					checkSpeed: '',
					fullDuplex: false,
					percentage: 50,
					speed: 1000000
				},
				nicOrder: {	//HostNicOrderPolicy
					activeNic: [],	//Array<string>
					standbyNic: []	//Array<string>
				},
				notifySwitches: false,
				policy: '',
				reversePolicy: false,
				rollingOrder: false
			},
			offloadPolicy: {	//HostNetOffloadCapabilities
				csumOffload: false,
				tcpSegmentation: false,
				zeroCopyXmit: false,
			},
			security: {	//HostNetworkSecurityPolicy
				allowPromiscuous: false,
				forgedTransmits: true,
				macChanges: true,
			},
			shapingPolicy: {	//HostNetworkTrafficShapingPolicy
				averageBandwidth: 1000000,
				burstSize: 1000000,
				enabled: false,
				peakBandwidth: 1000000
			}
		}
	}
	
	let morNetworkFolder = {value: 'ha-folder-network', type:'Folder'}

	let vSwitch = await vimPort.addVirtualSwitch(morNetworkFolder, 'myVSwitch', spec)
	*/
	/*
	let portGroupSpec = {	//HostPortGroupSpec
		name: 'pgMephesto',
		policy: spec.policy,
		vlanId: 0,
		vswitchName: 'myVSwitch'
	}
	let portGroup = await vimPort.addPortGroup(vSwitch.mor, portGroupSpec)
	*/
	//return vSwitch

	return 'DONE'
}

(async function() {

	for (let env of environments) {
		console.log(await test(env.vm, env.user, env.pwd))
	}
})().catch(err => console.error('ERROR:', err.toString()))


