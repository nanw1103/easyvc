'use strict'

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

	get(name) {
		let me = this
		let vim = this._service.vim
		
		return me._service.vimPort.retrievePropertiesEx(me._service.serviceContent.propertyCollector, [
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
			.then(ret => {
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
			})
	}

	parent(type) {
		if (!type)
			return this.get('parent')
		
		return new Promise((resolve, reject) => {
			
			function findParent(obj) {
				obj.get('parent').then(item => {
					if (!item) {
						resolve()
						return
					}
					if (item.mor.type === type) {
						resolve(item)
						return
					} else {
						findParent(item)
					}
				}).catch((err) => {
					this.log(err)
					reject(err)
				})
			}
			
			findParent(this)
		})
	}

	waitState (pathSet, readyState, timeoutMillis) {
		let me = this
		if (!timeoutMillis)
			timeoutMillis = 60 * 60 * 1000 // 1 hour
		return new Promise((resolve, reject) => {			
			let start = Date.now()
			let retry = 0
			const MAX_RETRY = 5
			function checkImpl() {			
				let now = Date.now()
				if (now - start > timeoutMillis) {
					reject(new Error(`${me.mor.value} waitState timeout`))
					return
				}

				me.get(pathSet).then(state => {
					if (state === 'error') {
						console.log(`${pathSet} waitState state is error, retry ${retry}/${MAX_RETRY}...`)
						if (++retry > MAX_RETRY) {
							me.get('info')
								.then(taskInfo => reject(taskInfo))
								.catch(err => reject(err))
							return
						}
						setTimeout(checkImpl, 30 * 1000)
						return
					}
					if (state !== readyState) {
						setTimeout(checkImpl, 10)
						return
					}
					resolve()
				}).catch(err => {
					console.log(`${pathSet} waitState failed, error is ${err.toString()}, retry ${retry}/${MAX_RETRY}...`)
					if (++retry > MAX_RETRY) {
						console.log(`${pathSet} waitState failed. Give up.`)
						reject(err)
					} else {
						setTimeout(checkImpl, 30 * 1000)
					}
				})
			}

			checkImpl()
		})
	}

}


module.exports = BaseMob