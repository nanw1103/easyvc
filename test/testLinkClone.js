const easyvc = require('../lib/index.js')()

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

const host = '10.117.160.100'
const user = 'asdf'
const password = 'asdf';

async function createSnapshot(name) {
	try {
		await easyvc.login(host, user, password)
		let vms = await easyvc.findVMsByName('w7temp')
		let vm = vms[0]
		let snapshotMor = await vm.createSnapshot(name, name, false, true)
		return snapshotMor
	} catch(err) {
		return Promise.rejet(err)
	}
}

async function getCurrentSnapshot() {
	try {
		await easyvc.login(host, user, password)
		let vms = await easyvc.findVMsByName('w7temp')
		let vm = vms[0]
		let currentSnapshot = await vm.getCurrentSnapshot()
		return currentSnapshot
	} catch(err) {
		return Promise.reject(err)
	}
}

async function findSnapshotByName(name) {
	try {
		await easyvc.login(host, user, password)
		let vms = await easyvc.findVMsByName('w7temp')
		let vm = vms[0]
		let currentSnapshot = await vm.findSnapshotByName(name)
		return currentSnapshot
	} catch(err) {
		return Promise.reject(err)
	}
}

async function getIndependenetVirtualDiskKeys() {
	try {
		await easyvc.login(host, user, password)
		let vms = await easyvc.findVMsByName('w7temp')
		let vm = vms[0]
		await vm.getIndependenetVirtualDiskKeys()
		/*let currentSnapshot = await vm.findSnapshotByName(name)
		return currentSnapshot*/
	} catch(err) {
		return Promise.reject(err)
	}
}


/*createSnapshot('test')
	.then((mor) => {console.log(mor)})
	.catch(err => console.error(err))*/


/*
{ currentSnapshot: { value: 'snapshot-1738', type: 'VirtualMachineSnapshot' },
	rootSnapshotList:
		[ { snapshot: [Object],
			vm: [Object],
			name: 'test',
			description: 'test',
			id: 2,
			createTime: 2018-03-14T06:46:43.622Z,
	state: 'poweredOff',
	quiesced: false,
	childSnapshotList: [],
	replaySupported: false } ] }*/

/*getCurrentSnapshot()
	.then((snapshot) => console.log(snapshot))
	.catch(err => console.error(err))*/

/*findSnapshotByName('test')
	.then((snapshot) => console.log(snapshot))
	.catch(err => console.error(err))*/

async function linkclone() {
	try {
		await easyvc.login(host, user, password)
		let vm = (await easyvc.findVMsByName('w7t1'))[0]

		console.log('vm:', vm.name, vm.mor.value)
		// create snapshot
		//await vm.createSnapshot('test', 'test', false, true)
		// get snapshot mor
		let snapshot = await vm.findSnapshotByName('test')
		console.log(snapshot)
		// linkclone vm
		await vm.createLinkedClone(snapshot.mor, 'test-w7t1', true)
	} catch(err) {
		return Promise.reject(err)
	}
}

linkclone()
	.catch(err => console.error(err))