module.exports = function(STAMPEDE) {

  var moment = require("moment")
  var config = STAMPEDE.config
  var helpers = {}

  helpers.moment = moment;
  helpers.current_currency = config.exchange.currency;

  helpers.sanitizeVariableName = function(string) {
    var sanitized = 
      (string.charAt(0).toUpperCase() + string.slice(1)).replace(/_/g, " ")
    return sanitized
  }

  return helpers
}
