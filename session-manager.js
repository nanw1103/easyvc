const vsphere = require('vsphere')
const dedupa = require('dedup-async')

////////////////////////////////////////////////////////////////////////////////////////

class SessionManager {
	constructor() {
		this.mapIpUserToService = {}	
	}

	get(host) {
		return this.mapIpUserToService[host]
	}
	

	dedupLogin() {
		let host = this.host
		let user = this.user
		let password = this.password

		let existing = this.mapIpUserToService[host]
		if (existing) {
			if (existing.user === user && existing.password === password)
				return Promise.resolve(existing.service)
			return this.logout(host).catch(() => {}).then(loginImpl)
		}

		let ME = this

		function loginImpl() {
			try {
				return vsphere.vimService(host)
					.then(service => service.vimPort.login(service.serviceContent.sessionManager, user, password)
						.then(() => {
							ME.mapIpUserToService[host] = {
								service: service,
								user: user,
								password: password,
								lastCheck: Date.now()
							}

							return service
						})
					)
					.catch(err => Promise.reject(err))
			} catch (err) {
				return Promise.reject(err)
			}
		}
		return loginImpl()
	}

	login(host, user, password) {
		this.host = host
		this.user = user
		this.password = password

		return dedupa(this.dedupLogin, this)					
	}
	
	logout(host) {
		let session = this.mapIpUserToService[host]
		if (session) {
			delete this.mapIpUserToService[host]
			let ME = this
			return session.service.vimPort
				.logout(session.service.serviceContent.sessionManager)
				.catch(() => {})
				.then(() => ME)
		} else 
			return Promise.resolve(this)
	}
		
	ensureSession(host) {
		let session = this.mapIpUserToService[host]
		if (!session)
			return Promise.reject('EasyVc: Not logged in. Host: ' + host)

		let svc = session.service

		let interval = Date.now() - session.lastCheck
		if (interval < 60 * 1000)
			return Promise.resolve(svc)

		return svc.vimPort.currentTime(svc.serviceInstance)
			.then(() => svc)
			.catch(() => Promise.resolve()
				.then(() => console.log(`vSphere API session timeout. Idle till now: ${(interval/1000/60)|0} minutes. Refreshing...`))
				.then(() => svc.vimPort.logout(svc.serviceContent.sessionManager))
				.catch(() => {})
				.then(() => svc.vimPort.login(svc.serviceContent.sessionManager, session.user, session.password))
				.then(() => {
					session.lastCheck = Date.now()
					console.log('vSphere API session refreshed:', host)
					return svc
				}))
	}
}

module.exports = new SessionManager