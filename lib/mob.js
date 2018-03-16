'use strict'

function create(service, obj) {
	//console.log('CREATE', obj);
	function createSingle(service, obj) {
		//console.log('create 1 ', obj.type, '  ', obj.value, '  ', Object.keys(obj).length);
		//if it's a MOR
		if (obj.type && obj.value && Object.keys(obj).length == 2) {
			let classFile = `./mobs/${obj.type}.js`
			let targetClass
			try {
				targetClass = require(classFile)
			} catch (e) {
				//console.log('MOB class not found:', obj.type);
				if (require('fs').existsSync(require('path').join(__dirname, classFile))) {
					console.error('Error loading class file: ' + classFile)
					throw e
				}
				targetClass = require('./BaseMob')
			}
							
			return new targetClass(service, obj)
		}
		
		return obj
	}
	
	if (Array.isArray(obj)) {
		var array = []
		for (var i = 0; i < obj.length; i++)
			array.push(createSingle(service, obj[i]))
		return array
	}
	
	if (typeof obj === 'object')
		return createSingle(service, obj)
	
	//simple type
	return obj
}

module.exports = create
