Array.prototype.lookup = function(key, value) {
  var i=0, result;
  while (i < this.length && !result) {
    var current_object = this[i];
    //console.log("iteration:", i);
    if (current_object[key] === value) result = current_object;
    i++;
  }
  return result;
};

Array.prototype.lookupIndex = function(key, value) {
  var i=0, result;
  while (i < this.length && !result) {
    var current_object = this[i];
    //console.log("Iteration:", i, "current:", current_object[key]);
    if (current_object[key] === value) result = i;
    i++;
  }
  return result;
};

String.prototype.upperCaseFirst = function() {
  var string = this;
  return string.charAt(0).toUpperCase() + string.slice(1);
};

Array.prototype.averageByKey = function(key) {
  var array = this,
      sum = 0,
      length = (array || []).length;
  if (length > 0) {
    for (var i=0; i < length; i++) {
      var member = array[i];
      if (
        member[key] && 
        !isNaN(member[key])
      ) sum += member[key];
    }
    return (sum / length);
  }
  else {
    return null;
  }  
};


Array.prototype.extremesByKey = function(key) {
  var copy = this.slice(0);
  copy.sort(function(a, b) {
    return (a[key] - b[key]);
  });
  return {
    min: copy[0] || {},
    max: copy[copy.length - 1] || {}
  };
};

// Standard email validation
exports.validateEmail = function(email) { 
  var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(email);
};

// for consistent time labeling down to second grain
exports.timeLabel = function () {
  var t = new Date(),
      h = ("0" + t.getHours()).slice(-2),
      m = ("0" + t.getMinutes()).slice(-2),
      s = ("0" + t.getSeconds()).slice(-2),
      y = t.getFullYear(),
      mn = ("0" + (t.getMonth() + 1)).slice(-2),
      d = ("0" + t.getDate()).slice(-2),
      l = y+"-"+mn+"-"+d+"-"+h+":"+m+":"+s;
  return l;
};

exports.reassignProperties = function(source_hash, target_hash) {
  for (var property in source_hash) {
    if (source_hash.hasOwnProperty(property)) {
      target_hash[property] = 
        source_hash[property];
    }
  }
};

exports.cumulate = function(base, length) {
  var result = base;
  for (var multiplier = 0; multiplier < (length - 1); multiplier++) {
    result *= 2;
  }
  return result;
}