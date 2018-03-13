# easyvc
Easy wrapper for vSphere operations

**Installation**

Due to some reason, one dependency **vsphere 1.0.0** is NOT published on NPM. First, you need to manually download it from:

    https://labs.vmware.com/flings/vsphere-sdk-for-javascript
    
Create a directory named "vsphere" in your node_modules directory, then exact the archive and put files in the directory. Make sure the package.json is in the vsphere directory.

After that, do

```
npm install easyvc
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
const esxiAddress = '<ip of esxi on which the test VM is hosted>'

const vmName = '<vm name>'
const guestUser = '<vm os user name>'
const guestPwd = '<vm password>';

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
	console.log('config.guestId', await vm.get('config.guestId'))

	return 'DONE'
})(vmName, guestUser, guestPwd).catch(e => console.error('ERROR: ' + e))
```
