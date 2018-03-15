'use strict'

const vsphere = require('vsphere')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

const host = '10.117.160.100'
const user1 = 'asdf'
const user2 = 'administrator'
const password = 'asdf'


function test() {
	
	function doLogin(service) {
		console.log('doLogin: ', !!service)
		return service.vimPort.login(service.serviceContent.sessionManager, user1, password)
	}
	
	function onLoginSuccess() {
		console.log('onLoginSuccess')
	}

	vsphere.vimService(host)
		.then(doLogin)
		.then(onLoginSuccess).catch((err) => {
			console.log(err)
		})
}

function test2() {
	
	function doLogin(service) {
		console.log('doLogin: ', !!service)
		return service.vimPort.login(service.serviceContent.sessionManager, user2, password)
	}
	
	function onLoginSuccess() {
		console.log('onLoginSuccess')
	}

	vsphere.vimService(host)
		.then(doLogin)
		.then(onLoginSuccess).catch((err) => {
			console.log(err)
		})
}

test()
setTimeout(test, 3000)
setTimeout(test2, 5000)