const easyvc = require('./index.js')()

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at:', p, 'reason:', reason)
	process.exit()
})

const vcOrEsxiHost = '10.117.160.100'
const user = 'asdf'
const password = 'asdf'
const esxiAddress = '10.117.160.96'

const vmName = 'jumpbox'
const guestUser = 'asdf'
const guestPwd = 'asdf';

(async function test(vmName, guestUser, guestPwd) {
		
	await easyvc.login(vcOrEsxiHost, user, password)	
	console.log('logged in')
	
	let esxi = await easyvc.findHostByIp(esxiAddress)
	console.log('esxi:', esxi.mor.value)

	let vms = await easyvc.findVMsByName(vmName)
	if (vms.length === 0)
		throw 'VM not found: ' + vmName
	let vm = vms[0]
	console.log('vm:', vm.mor.value)
	
	let guest = await vm.guest(guestUser, guestPwd, esxiAddress, {log: false})
	let fileMgr = guest.file()
	let processMgr = guest.process()

	//------------------------------------
	console.log('[test upload/download]')
	let text = 'Hello, mortal'
	let tempPath = fileMgr.tempPath()
	let target = tempPath + '/test.txt'
	await fileMgr.uploadText(text, target)

	let downloaded = await fileMgr.downloadText(target)
	if (downloaded !== text)
		console.error('Failed: upload/download mismatch')
	await fileMgr.delete(tempPath)

	//------------------------------------
	console.log('[test run script]')
	//works on both windows/linux (with expected errors)
	let script = 'date /t\r\necho hello'
	let result = await processMgr.runScript(script, 10000)
	console.log(result.toString())
	
	//------------------------------------
	//list properties of VM. Refer to vSphere MOB browser for model details
	console.log('summary', await vm.get('summary'))
	console.log('config', await vm.get('config'))
	console.log('config', await vm.get('config.guestId'))

	return 'DONE'
})(vmName, guestUser, guestPwd).catch(e => console.error('ERROR: ' + e))


