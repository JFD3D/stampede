'use strict'

// We create and extend our reusable STAMPEDE object in startup plugin
require('./plugins/startup')({ dir: __dirname }).init()
