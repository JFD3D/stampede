Array.prototype.lookup = function(key, value) {
  var i=0, result;
  while (i < this.length && !result) {
    var current_object = this[i];
    //console.log("iteration:", i);
    if (current_object[key] === value) result = current_object;
    i++;
  }
  return result;
}

Array.prototype.lookupIndex = function(key, value) {
  var i=0, result;
  while (i < this.length && !result) {
    var current_object = this[i];
    //console.log("Iteration:", i, "current:", current_object[key]);
    if (current_object[key] === value) result = i;
    i++;
  }
  return result;
}
