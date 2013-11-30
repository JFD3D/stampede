var moment = require("moment"),
	config = require("./config");

exports.moment = moment;
exports.current_currency = config.exchange.currency;

exports.sanitizeVariableName = function(string) {
  return (string.charAt(0).toUpperCase() + string.slice(1)).replace(/_/g, " ");
};