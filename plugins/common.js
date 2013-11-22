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
 