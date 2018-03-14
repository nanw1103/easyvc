# easyvc

Easy wrapper for vSphere operations.

Only a small subset (growing) of vSphere APIs are available according to my actual need. 

Currently the basic VM guest operations are available:

* Locate VM
* Upload/download file to/from guest
* Run script in guest
* CD operations
* Power operations

```

**Usage**

```

const easyvc = require('easyvc')()

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at:', p, 'reason:', reason)
	process.exit()
})

const vcOrEsxiHost = '<your vc or esxi>'
const user = '<vc user name>'
const password = '<vc password>'

const vmName = '<vm name>'
const guestUser = '<vm os user name>'
const guestPwd = '<vm password>';

(async function test(vmName, guestUser, guestPwd) {
		
	await easyvc.login(vcOrEsxiHost, user, password)	
	console.log('logged in')
	
	let vms = await easyvc.findVMsByName(vmName)
	if (vms.length === 0)
		throw 'VM not found: ' + vmName
	let vm = vms[0]
	console.log('vm:', vm.mor.value)
	
	let guest = await vm.guest(guestUser, guestPwd, {log: false})
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
	console.log('config.guestId', await vm.get('config.guestId'))

	return 'DONE'
})(vmName, guestUser, guestPwd).catch(e => console.error('ERROR: ' + e))
```
