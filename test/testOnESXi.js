const easyvc = require('../lib/index.js')()
const config = require('./config.js')
const {delay} = require('otherlib')

let vmName = 'jumpbox'
let guestUser = 'asdf'
let guestPwd = 'asdf'
;

(async () => {

	await easyvc.login(config.esxi.host, config.esxi.user, config.esxi.password)
	console.log('logged in')
	
	let vm = (await easyvc.findVMsByName('jumpbox'))[0]
	if (!vm)
		throw 'VM not found: ' + vmName
	console.log('vm:', vm.mor.value)
	
	let esxiHost = await vm.get('summary.runtime.host')
	console.log(esxiHost)
	let esxiAddress = await esxiHost.get('name')
	console.log(esxiAddress)
	
	//*
	await vm.waitForVmTools(1000)
	console.log('VM tools ready')
	
	let ip = await vm.getIPAddress()
	console.log('ip', ip)
	//*/

	//let runtime = await vm.get('runtime')
	//console.log('runtime', runtime)
	//console.log('runtime', runtime.host)
	
	//let config = await vm.get('config')
	//console.log('config', config)

	let guest = await vm.guest(guestUser, guestPwd, {log:true})
	let fileMgr = guest.file()
	let processMgr = guest.process()


	//*
	console.log('[test mkdirp/delete]')
	let tempPath = await fileMgr.tempPath()
	await fileMgr.mkdirp(tempPath + '/asdf')
	await fileMgr.delete(tempPath)
	//*/

	//*
	console.log('[test upload/download]')
	let text = 'Hello, mortal\r\n'
	tempPath = await fileMgr.tempPath()
	let target = tempPath + '/test.txt'
	await fileMgr.uploadText(text, target)

	await delay(5000)
	
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

})().catch(err => console.error('ERROR:', err))
