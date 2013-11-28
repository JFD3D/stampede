var moment = require("moment");

exports.moment = moment;

exports.sanitizeVariableName = function(string) {
  return (string.charAt(0).toUpperCase() + string.slice(1)).replace(/_/g, " ");
};