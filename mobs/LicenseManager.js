'use strict'

const BaseMob = require('../BaseMob.js')

class LicenseManager extends BaseMob {
	listLicenses() {
		return this.get('licenses')
	}
}


module.exports = LicenseManager