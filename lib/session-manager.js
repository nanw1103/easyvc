const vsphere = require('vsphere')
const { dedup } = require('otherlib')

////////////////////////////////////////////////////////////////////////////////////////

class SessionManager {
	constructor() {
		this.mapIpUserToService = {}	
	}

	get(host) {
		return this.mapIpUserToService[host]
	}

	findSessionHost(service) {
		for (let host in this.mapIpUserToService) {
			if (this.mapIpUserToService[host].service === service)
				return host
		}
	}

	async _loginImpl() {
		let host = this.host
		let user = this.user
		let password = this.password

		let existing = this.mapIpUserToService[host]
		if (existing) {
			if (existing.user === user && existing.password === password)
				return existing.service
			try {
				await this.logout(host)
			} catch (e) {
				//ignore
			}
		}

		let service = await vsphere.vimService(host)
		await service.vimPort.login(service.serviceContent.sessionManager, user, password)

		//HACK: required by VM guest file operation on ESXi. See vm/FileManager
		service = Object.assign({}, service, {_endpoint: host})
		//Object.freeze(service)

		this.mapIpUserToService[host] = {
			service: service,
			user: user,
			password: password,
			lastCheck: Date.now()
		}

		return service
	}

	login(host, user, password) {
		this.host = host
		this.user = user
		this.password = password

		return dedup(this._loginImpl, this)					
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