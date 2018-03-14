'use strict'

const fs = require('fs')
const path = require('path')
const request = require('request')
const streamBuffer = require('stream-buffers')
const Readable = require('stream').Readable
const util = require('util')
const { retry } = require('otherlib')
const mob = require('../../mob.js')

var _counter

class FileManager {
	constructor (guest, options) {
		Object.defineProperty(this, 'guest', {value: guest})
		this.options = options

		Object.defineProperty(this, '_fileMgr', {value: null, writable: true})
	}

	_normalize(target) {
		target = target.replace(/\\/g, '/')
		let P = this.guest.isWindows ? path.win32 : path.posix
		return P.normalize(target)
	}

	log() {
		if (this.options && this.options.log) {
			let text = `FileManager [${this.guest.vm.mor.value}] ` + util.format.apply(null, arguments)
			console.log(text)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////
	//	File operations - core
	//////////////////////////////////////////////////////////////////////////////////////////////
	async upload(stream, size, guestPath) {

		guestPath = this._normalize(guestPath)
		let P = this.guest.isWindows ? path.win32 : path.posix
		let folder = P.normalize(P.parse(guestPath).dir)

		let impl = async () => {
			
			let esxiHost = await this.guest.vm.get('summary.runtime.host')
			let esxiAddress = await esxiHost.get('name')

			await this.mkdirp(folder)

			this.log(`Upload: ${guestPath}, host=${esxiAddress}`)
			let url = await this._initiateFileTransferToGuest(guestPath, size)
			url = url.replace('//*', '//' + esxiAddress)
			let req = request.put({
				url: url,
				headers: {
					'Content-Type': 'application/octet-stream', // binary file type
					'Content-Length': size // file will not create if don't have this
				}
			})

			return new Promise((resolve, reject) => {
				try {
					stream.pipe(req)
						.on('end', dd => {
							resolve(dd)
						})
						.on('error', reject)
				} catch (err) {
					reject(err)
				}
			})
		}

		return retry(impl, {
			name: `Upload guestPath=${guestPath}`,
			filter: e => e.toString().includes('EHOSTUNREACH'),
			retry: 2,			
			intervalMs: 10000,
		})
	}

	async download(guestPath, outputstream) {
		
		guestPath = this._normalize(guestPath)

		this.log('Download:', guestPath)

		let esxiHost = await this.guest.vm.get('summary.runtime.host')
		let esxiAddress = await esxiHost.get('name')

		let info = await this._initiateFileTransferFromGuest(guestPath)
		let url = info.url
		url = url.replace('//*', '//' + esxiAddress)

		return new Promise((resolve, reject) => {			
			request(url)
				.on('end', resolve)
				.on('error', err => {
					this.log('request get ${url} failed, error: ', err)
					reject(err)
				})
				.pipe(outputstream)
		})
	}

	async _initiateFileTransferToGuest(guestPath, size) {
		let vm = this.guest.vm
		let svc = vm._service
		let fileMgr = this._fileMgr || (this._fileMgr = await mob(svc, svc.serviceContent.guestOperationsManager).get('fileManager'))
		return svc.vimPort.initiateFileTransferToGuest(
			fileMgr.mor,
			vm.mor,
			this.guest._auth(),
			guestPath,
			svc.vim.GuestFileAttributes(),
			size,
			true)
	}

	async _initiateFileTransferFromGuest(guestPath) {
		let vm = this.guest.vm
		let svc = vm._service
		let fileMgr = this._fileMgr || (this._fileMgr = await mob(svc, svc.serviceContent.guestOperationsManager).get('fileManager'))
		return svc.vimPort.initiateFileTransferFromGuest(
			fileMgr.mor,
			vm.mor,
			this.guest._auth(),
			guestPath)
	}

	async delete(guestPath) {
		
		guestPath = this._normalize(guestPath)

		let vm = this.guest.vm
		let svc = vm._service
		let fileMgr = this._fileMgr || (this._fileMgr = await mob(svc, svc.serviceContent.guestOperationsManager).get('fileManager'))
		let task = svc.vimPort.deleteDirectoryInGuest(
			fileMgr.mor,
			vm.mor,
			this.guest._auth(),
			guestPath,
			true)

		return task.then(d => {
			this.log('Deleted:', guestPath)
			return d
		}).catch(e => {
			if (e.message.indexOf(' was not found') > 0)
				return
			return Promise.reject(e)
		})
	}

	async mkdirp(guestPath) {

		guestPath = this._normalize(guestPath)

		let vm = this.guest.vm
		let svc = vm._service
		let fileMgr = this._fileMgr || (this._fileMgr = await mob(svc, svc.serviceContent.guestOperationsManager).get('fileManager'))
		let task = svc.vimPort.makeDirectoryInGuest(
			fileMgr.mor,
			vm.mor,
			this.guest._auth(),
			guestPath,
			true)

		return task.then(d => {
			this.log('Directory created:', guestPath)
			return d
		}).catch(e => {
			if (e.message.indexOf(' already exists') > 0)
				return
			return Promise.reject(e)
		})
	}

	//////////////////////////////////////////////////////////////////////////////////////////////
	//	File operations - helper
	//////////////////////////////////////////////////////////////////////////////////////////////

	async downloadText(guestPath, encoding) {
		let buffer = new streamBuffer.WritableStreamBuffer()
		await this.download(guestPath, buffer)

		if (!buffer.size())	//workaround stream buffer bug
			return ''

		if (!encoding)
			encoding = 'utf8'
		return buffer.getContentsAsString(encoding)
	}

	async downloadFile(guestPath, localPath) {

		let dir = path.dirname(localPath)
		if (!fs.existsSync(dir))
			fs.mkdirSync(dir)

		let output = fs.createWriteStream(localPath)
		await this.download(guestPath, output)
	}

	async uploadText(text, guestPath) {
		let s = new Readable
		s._read = function noop() {}
		s.push(text)
		s.push(null)
		return this.upload(s, s._readableState.length, guestPath)
	}

	async uploadFile(localPath, guestPath) {
		let size = fs.statSync(localPath).size
		let stream = fs.createReadStream(localPath)
		return this.upload(stream, size, guestPath)
	}
	
	//////////////////////////////////////////////////////////////////////////////////////////////
	//	Path utilities
	//////////////////////////////////////////////////////////////////////////////////////////////
	tempPath(sub) {
		const now = new Date()
		let ms = now.getMilliseconds()
		if (_counter === ms)
			ms++
		_counter = ms

		const timestamp = now.toLocaleString().replace(/:/g, '-').replace(/\s/g, 'T') + '.'+ ms

		let ret
		if (this.guest.isWindows) {
			ret = 'c:\\Windows\\Temp\\easyvc\\' + timestamp
			if (sub)
				ret += '\\' + sub
		} else {
			ret = '/tmp/easyvc/' + timestamp
			if (sub)
				ret += '/' + sub
		}
		return ret
	}
}

module.exports = FileManager