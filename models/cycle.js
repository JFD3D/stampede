/* This is where cycle logic will be decoupled from: 
  - wallet
  - market
  - trader
*/

module.exports = function(STAMPEDE) {

  var LOG = STAMPEDE.LOG("cycle")
  var config = STAMPEDE.config
  var common = STAMPEDE.common
  var async = STAMPEDE.async
  var db = STAMPEDE.db
  var _ = STAMPEDE._

  // All traders will be loaded into this object
  var live_traders = {}

  // Trading performance timers initialization for benchmarking
  var perf_timers = STAMPEDE.perf_timers


  function Cycle() {

  }

  return {
    instance: Cycle
  }

}