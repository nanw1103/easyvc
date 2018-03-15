const easyvc = require('../lib/index.js')()
const config = require('./config.js');

(async function() {

	await easyvc.login(config.vc.host, config.vc.user, config.vc.password)
	console.log('logged in')
	let esxi = await easyvc.findHostByIp(config.vc.esxi)
	console.log('esxi:', esxi.mor.value)
	
	for (let vm of config.vms) {
		console.log(await test(vm.name, vm.user, vm.pwd))
	}
})().catch(err => console.error('ERROR:', err.toString()))


async function test(vmName, guestUser, guestPwd) {
		
	console.log(`Testing: vm=${vmName}`)	
	
	let vm = (await easyvc.findVMsByName(vmName))[0]
	if (!vm)
		throw 'VM not found: ' + vmName
	console.log('vm:', vm.mor.value)
	
	//*
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

	return 'DONE'
}



