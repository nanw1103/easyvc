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

	log() {
		if (this.options && this.options.log) {
			let text = `FileManager [${this.guest.vm.mor.value}] ` + util.format.apply(null, arguments)
			console.log(text)
		}
	}

	async _getEsxiHostAddress() {
		let vm = this.guest.vm
		let isESXi = vm._service.serviceContent.about.apiType === 'HostAgent'	//'VirtualCenter'
		if (isESXi)
			return vm._service._endpoint	//HACK: added in easyvc/session-manager

		let host = await vm.get('summary.runtime.host')
		let addr
		if (host)
			addr = await host.get('name')

		if (addr)
			vm._host = addr
		else
			addr = vm._host

		return addr
	}

	//////////////////////////////////////////////////////////////////////////////////////////////
	//	File operations - core
	//////////////////////////////////////////////////////////////////////////////////////////////
	async upload(stream, size, guestPath) {
		try {
			return await this._uploadImpl(stream, size, guestPath)
		} finally {
			if (!stream.closed)
				stream.destroy()
		}
	}

	async _uploadImpl(stream, size, guestPath) {

		guestPath = await this._normalize(guestPath)
		
		let isWindows = await this.guest.vm.isWindows()
		let P = isWindows ? path.win32 : path.posix
		let folder = P.normalize(P.parse(guestPath).dir)
		
		let impl = async () => {
			
			let esxiAddress = await this._getEsxiHostAddress()

			await this.mkdirp(folder)

			this.log(`Upload: ${guestPath}, host=${esxiAddress}`)
			let url = await this._initiateFileTransferToGuest(guestPath, size)
			url = url.replace('//*', '//' + esxiAddress)
			let req = request.put({
				url: url,
				headers: {
					'Content-Type': 'application/octet-stream', // binary file type
					'Content-Length': size // mandatory
				}
			})
			return new Promise((resolve, reject) => {
				let onError = e => {
					stream.destroy()
					req.destroy()
					reject(e)
				}
				
				try {
					req.on('end', resolve).on('error', onError)
					stream.on('error', onError)
					stream.pipe(req)
				} catch (e) {
					onError(e)
				}
			})
		}

		return retry(impl, {
			name: `Upload guestPath=${guestPath}`,
			filterReject: e => e.toString().includes('EHOSTUNREACH'),
			retry: 2,			
			intervalMs: 10000,
		})
	}

	async download(guestPath, outputstream) {
		
		guestPath = await this._normalize(guestPath)

		this.log('Download:', guestPath)

		let esxiAddress = await this._getEsxiHostAddress()

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
		
		guestPath = await this._normalize(guestPath)

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

		guestPath = await this._normalize(guestPath)

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
	async _normalize(target) {
		target = target.replace(/\\/g, '/')
		let isWindows = await this.guest.vm.isWindows()
		let P = isWindows ? path.win32 : path.posix
		return P.normalize(target)
	}

	async tempPath(sub) {
		const now = new Date()
		let ms = now.getMilliseconds()
		if (_counter === ms)
			ms++
		_counter = ms

		const timestamp = now.toLocaleString().replace(/:/g, '-').replace(/\s/g, 'T') + '.'+ ms

		let isWindows = await this.guest.vm.isWindows()

		let ret
		if (isWindows) {
			//ret = 'c:\\Windows\\Temp\\easyvc\\' + timestamp
			ret = 'c:\\easyvctmp\\' + timestamp
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