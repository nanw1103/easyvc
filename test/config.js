
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
	process.exit()
})

module.exports = {
	vc: {
		host: '10.117.160.100',
		user: 'asdf',
		password: 'asdf',
		esxi: '10.117.160.96'
	},
	vms: [{
		name: 'jumpbox',
		user: 'asdf',
		pwd: 'asdf'	
	}, {
		name: 'UbuntuServer64',
		user: 'asdf',
		pwd: 'asdf'
	}],
	esxi: {
		host: '10.117.160.95',
		user: 'root',
		password: 'ca$hc0w'
	}
}