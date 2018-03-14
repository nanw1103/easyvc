const easyvc = require('../index.js')()
const config = require('./config.js');

(async function() {
	
	await easyvc.login(config.vc.host, config.vc.user, config.vc.password)
	console.log('logged in')

	for (let vm of config.vms) {
		console.log(await test(vm.name, vm.user, vm.pwd))
	}
})().catch(err => console.error('ERROR:', err.toString()))

async function test(vmName, guestUser, guestPwd) {
		
	let vm = (await easyvc.findVMsByName(vmName))[0]
	if (!vm)
		throw 'VM not found: ' + vmName
	console.log('vm:', vm.mor.value)
    
	//await vm.powerOn()
	//await vm.waitPowerOn()
	await vm.powerOn(60 * 1000 /* , noWait=false */)
	console.log('powered on')
	console.log('powering off...')
	await vm.powerOff(60 * 1000 /* , noWait=false */)
	console.log('powered off')
	console.log('powering on...')
	await vm.powerOn(60 * 1000 /* , noWait=false */)
	console.log('powered on')

	console.log('Wait for vm tools...')
	await vm.waitForVmTools(120000)
	console.log('VM tools ready')
    
	//let guest = await vm.guest(guestUser, guestPwd, {log: false})
	//let fileMgr = guest.file()
	//let processMgr = guest.process()

	//await guest.reboot(5 * 60 * 1000)

	return 'DONE'
}


