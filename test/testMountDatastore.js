const easyvc = require('../lib/index.js')()

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

host = '10.117.163.188'
user = 'root'
password = 'VMware123'


easyvc.login(host, user, password)
	.then(()=>{
		console.log('logged in')
		return easyvc.findHostByIp(host)
	})
	.then((hostSystem) => {
		hostSystem.createNasDatastore('ISO', 'bj-group.eng.vmware.com', '/g11nqabj/isoimages/OS')
			.then((datastore) => {
				console.log(datastore)
				console.log(JSON.stringify(datastore))
			})
			.catch((err) => {console.log(JSON.stringify(err))})
	})
	.catch(err => console.log(JSON.stringify(err)))


