'use strict'

module.exports = 
  require('./plugins/startup')({ dir: __dirname, role: 'module' }).init()