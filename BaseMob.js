'use strict'

const {retry} = require('otherlib')
const mob = require('./mob.js')
					
class BaseMob {
	constructor(service, mor) {
		Object.defineProperty(this, '_enableLog', {value: false})
		Object.defineProperty(this, '_service', {value: service})
		this.mor = mor		
	}

	toString() {
		return this.mor.type + ':' + this.mor.value
	}

	enableLog() {
		this._enableLog = true
		return this
	}

	log () {
		this._enableLog && console.log.apply(arguments)
	}

	async get(name) {
		let me = this
		let vim = this._service.vim
		
		let ret = await this._service.vimPort.retrievePropertiesEx(me._service.serviceContent.propertyCollector, [
			vim.PropertyFilterSpec({
				objectSet: vim.ObjectSpec({
					obj: me.mor,
					skip: false,
				}),
				propSet: vim.PropertySpec({
					type: me.mor.type,
					pathSet: Array.isArray(name) ? name : [name]
				})
			})
		], vim.RetrieveOptions())

		let propSet = ret.objects[0].propSet		
		if (!propSet || propSet.length == 0)
			return
		
		if (Array.isArray(name)) {
			let props = {}
			for (let i = 0; i < propSet.length; i++)
				props[propSet[i].name] = propSet[i].val
			return props
		} else {
			let mors = propSet[0].val
			return mob(this._service, mors)
		}
	}

	async parent(type) {
		if (!type)
			return this.get('parent')
		
		let p = this.get('parent')
		if (!p)
			return
		if (p.mor.type === type)
			return p
		return p.parent(type)
	}

	async waitState (pathSet, readyState, timeoutMs) {
		if (!timeoutMs)
			timeoutMs = 60 * 60 * 1000	// 1 hour

		let impl = () => this.get(pathSet).then(state => {
			if (state !== readyState)
				return Promise.reject(state)
		})

		return retry(impl, {
			//retry: 5,
			filter: e => e !== 'error',
			timeoutMs: timeoutMs,
			intervalMs: 10000,
			log: console.log,
			name: `waitState ${pathSet}: ${readyState}`
		})
	}
}


module.exports = BaseMob