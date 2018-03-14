const assert = require('assert')
const easyvc = require('./index.js')()

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at:', p, 'reason:', reason)
	process.exit()
})

const vcOrEsxiHost = '10.117.160.100'
const user = 'asdf'
const password = 'asdf'

const vmName = 'jumpbox'
const guestUser = 'asdf'
const guestPwd = 'asdf';

(async function() {
		
	await easyvc.login(vcOrEsxiHost, user, password)	
	let vm = (await easyvc.findVMsByName(vmName))[0]
	if (!vm)
		throw 'VM not found: ' + vmName
	console.log('vm:', vm.mor.value)
	
	//------------------------------------------------------------------------
	//	list properties of VM. Refer to vSphere MOB browser for model details
	//------------------------------------------------------------------------
	//console.log('summary', await vm.get('summary'))
	//console.log('config', await vm.get('config'))
	//console.log('config', await vm.get('config.guestId'))
	let esxiHost = await vm.get('summary.runtime.host')
	let esxiAddr = await esxiHost.get('name')
	let vmIp = await vm.get('summary.guest.ipAddress')
	console.log(`The vm ${vmIp} is on ESXi ${esxiAddr}`)

	let guest = await vm.guest(guestUser, guestPwd /*, {log: true}*/)
	
	//------------------------------------------------------------------------
	//	File operations
	//------------------------------------------------------------------------	
	console.log('[test upload/download]')
	let fileMgr = guest.file()
	let text = 'Hello, mortal'
	let tempPath = fileMgr.tempPath()
	let target = tempPath + '/test.txt'	
	await fileMgr.uploadText(text, target)
	let downloaded = await fileMgr.downloadText(target)
	assert(downloaded === text)
	await fileMgr.delete(tempPath)

	//------------------------------------------------------------------------
	//	In-guest commands
	//------------------------------------------------------------------------
	console.log('[test run script]')
	//works on both windows/linux (with expected errors)
	let script = 
`
date /t
echo hello
`
	let processMgr = guest.process()
	let result = await processMgr.runScript(script, 10000)
	console.log(result.toString())
		
	return 'DONE'	
})().then(console.log).catch(e => console.error('ERROR: ' + e))
