'use strict'

module.exports = _S => {
  var events          = require('events')
  var db              = _S.db
  var common          = _S.common
  var config          = _S.config
  var LOG             = _S.LOG('simulator')
  var _               = _S._
  var async           = _S.async

  const REC_SET_ATTR  = ['include_in_series', 'name']
  const SETS_REPO     = 'stampede_data_sets'
  const XC            = config.exchange.currency

  function Simulator() {
    this.loaded_data_sets   = []
    this.current            = {}
    this.series_simulation  = false
    this.beacon = new events.EventEmitter()
  }

  function Set(record_name, options) {
    record_name = record_name || ('stampede_data_set_' + Date.now())
    options     = options || {
      name: 'N/A',
      include_in_series: false
    }

    this.record_name        = record_name || ('stampede_data_set_' + Date.now())
    this.include_in_series  = options.include_in_series
    this.optional_ui_name   = options.name
    this.attribute_key      = 'stampede_set_name:' + record_name
    this.headers            = ['time', 'high', 'low', 'last']
    this.csv_file_name      = record_name + '.csv'
    this.csv_file_path      = (
      _S.config.data_set_directory || '/var/stampede_data_sets/'
    ) + this.csv_file_name
  }

  Set.prototype = {
    save: function(data, done) {
      var set         = this
      var start_time  = Date.now()
      var data_length = data.length

      db.sadd(SETS_REPO, set.record_name, function(error, response) {
        var csv_content = common.generateCSV(
              data, set.headers, true
            )
        // Save separate (no need to wait, the filing will take a lot longer ?)
        if (set.optional_ui_name && set.optional_ui_name.length) {
          db.hmset(set.attribute_key, {
            name: set.optional_ui_name,
            include_in_series: (set.include_in_series || false)
          }, function() {

          })
        }
        common.fileTo(set.csv_file_path, csv_content, function(error_writing) {
          common.timer(start_time, 'saveSet(' + data_length + ')')
          if (done) return done(null, set)
        })
      })      
    },

    updateAttributes: function(attributes, done) {
      var updates         = {}
      var set             = this

      REC_SET_ATTR.forEach(function (attr_name) {
        if (attributes.hasOwnProperty(attr_name)) {
          let value = attributes[attr_name]

          updates[attr_name] = value
          set[attr_name]     = value
        }
      })

      if (_.keys(updates).length) {
        LOG('updateAttributes:', updates)
        db.hmset(set.attribute_key, updates, done)
      }
      else return done('No valid updates submitted.')
    },

    load: function(done) {
      var set = this

      common.loadCSV(set.csv_file_path, (row) => {
        let time = parseInt(row[0])

        return (time > 0 ? {
          time: parseInt(row[0]),
          high: parseFloat(row[1]),
          low: parseFloat(row[2]),
          last: parseFloat(row[3])
        } : null)
      }, done)
    },
    getAttributes: function(done) {
      var set = this

      db.hgetall(set.attribute_key, function(error, attributes) {
        if (attributes) {
          set.optional_ui_name  = attributes.name
          set.include_in_series = (attributes.include_in_series === 'true')
        }
        if (done) return done(error)
      })
    },
    remove: function(done) {
      var set = this
      var fs  = require('fs')
      
      async.series([
        next => db.srem(SETS_REPO, set.record_name, next),
        next => db.hdel(set.attribute_key, next),
        next => fs.unlink(set.csv_file_path, next)
      ], done)
    }

  }

  Simulator.prototype = {
    
    run: function(done) {
      var sim = this

      _S.trader.prepareForSimulation(sim.series_simulation)
      async.series([
        next => _S.trader.loadTraders(next),
        next => _S.trader.cleanBooks(next),
        next => _S.trader.wakeAll(next)
      ], done)
    },

    saveSet: function(options, done) {
      var set  = new Set(null, options)

      if (options.data) {
        set.save(options.data, done)
      }
      else return done('Data for new set not provided!')
    },

    updateSet: function(options, done) {
      var set = new Set(options.set_name)

      set.updateAttributes(options, done)
    },
    
    loadAllSets: function(done) {
      var sim               = this
      var data_sets_results = []

      db.smembers(SETS_REPO, (error, data_sets) => {
        if (data_sets.length > 0) {
          sim.loaded_data_sets = data_sets
          async.eachSeries(data_sets, (data_set_name, next) => {
            let set = new Set(data_set_name)

            set.getAttributes(() => {
              data_sets_results.push({
                record_name       : data_set_name,
                include_in_series : set.include_in_series,
                optional_ui_name  : set.optional_ui_name
              })
              return next()
            })
          }, function() {
            _S.controller.refreshSimulationSets(data_sets_results)
            LOG(data_sets_results)
            if (done) return done(error, data_sets_results)  
          })
        }
        else {
          _S.controller.refreshSimulationSets([])
          if (done) return done(error, [])
        }
          
      })
    },

    removeSet: function(data_set_name, done) {
      var sim = this
      var set = new Set(data_set_name)

      set.remove(() => sim.loadAllSets(done))
    },

    loadSet: function(data_set_name, done) {
      var sim = this
      var i = 0
      var set = new Set(data_set_name)
      var time_start = Date.now()

      LOG('loadSet | data_set_name:', data_set_name)
      set.load((error, data) => {
        common.timer(time_start, 'loadSet (' + data.length + ')')
        sim.assignSet({
          data: data,
          name: data_set_name
        })
        LOG('loadSet | error:', error)
        return done(error, data)
      })
    },

    assignSet: function(data_set) {
      var sim = this

      sim.current.data_set_name = data_set.name
      sim.current.data_set = data_set.data
      sim.analyseCurrentSet()
      LOG('assignSet | complete')
    },

    sendSummary: function(final_ratio) {
      let sim = this

      _S.controller.notifyClient({
        message: 'Serie ('+
          ( 
            sim.current.serie ? 
            (
              sim.current.serie.options + ' / (' + 
              (sim.current.serie.idx + 1) + ' of ' + 
              sim.current.serie.count + ')'
            ) : 
            'Interactive'
          ) + ') | Ratio: ' + final_ratio + '.', 
        permanent: true
      })
    },

    // Record results in redis for analysis
    // Trigger check if series is running that dataset has been finished
    // If we have worked with a stored data set
    finish: function() {
      var current_wallet  = _S.current_wallet
      var current_market  = _S.current_market
      var current_traders = _S.current_traders
      var sim = this
      var final_ratio = parseInt(
        (current_wallet.currency_value / config.trading.maximum_investment) * 100
      )

      if (!sim.current.worker_process) sim.sendSummary(final_ratio)
      if (sim.series_simulation) {
        // Now record results of simulation (start value, options, end value)
        sim.summarizeSerieResults(final_ratio)
        
        if (!sim.current.serie.last && !sim.current.worker_process) {
          // Continue with next simulation
          sim.processSerie()
        }
        else if (sim.current.worker_process) {
          sim.reportCompletion(final_ratio)
          _S.trader.stopAll()
        }
        else {
          // End simulation series
          sim.series_simulation = false
          _S.trader.stopAll()
          LOG('!!!!!!! Series simulations ended.')
        }
      }
      else {
        LOG('Finishing interactive simulation, refreshing all.')
        _S.trader.refreshAll()
        _S.trader.stopAll()
      }
    },

    summarizeSerieResults: function(final_ratio) {
      var sim             = this
      var sales           = 0
      var purchases       = 0
      var sales_vol       = 0
      var purchases_vol   = 0
      let props           = sim.current.data_set_properties
      let result          = [
            {
              value: sim.current.data_set_properties.name || sim.current.data_set_name, 
              field: 'data_set', 
              type: 'data_sets'
            },
            {
              value: (
                ' |MAX:' + parseInt(props.max) +
                ' |MIN:' + parseInt(props.min) +
                ' |AVG:' + parseInt(props.average) +
                ' |MED:' + parseInt(props.median) +
                ' |DAYS:' + parseInt(props.span_days)
              ),
              field: 'data_set_props',
              type: 'data_sets'
            }
          ]

      sim.current.series_attributes.forEach(serie_attribute => {
        let serie_attribute_arrayed = serie_attribute.split(':')

        if (serie_attribute_arrayed[0] !== 'data_sets') {
          let item    = {}
          item.value  = 
            config[serie_attribute_arrayed[0]][serie_attribute_arrayed[1]]
          item.type   = serie_attribute_arrayed[0]
          item.field  = serie_attribute_arrayed[1]
          result.push(item)
        }
      })

      _.each(_S.current_traders, function(live_trader) {
        sales += (live_trader.sales || 0)
        sales_vol += (live_trader.book.current.sales_amount_currency || 0)
        purchases += (live_trader.purchases || 0)
        purchases_vol += (live_trader.book.current.purchases_amount_currency || 0)
      })

      result.push(
        {
          value: (
            purchases + ' (' + XC.toUpperCase() + ' ' + 
            parseInt(purchases_vol) + ')'
          ),
          field: 'purchases',
          type: 'purchases'
        },
        {
          value: (
            sales + ' (' + XC.toUpperCase() + ' ' + parseInt(sales_vol) + ')'
          ),
          field: 'sales',
          type: 'sales'
        },
        {
          value: final_ratio,
          type: 'ratio',
          field: 'ratio'
        }
      )
      if (sim.current.worker_process) {
        sim.current.result = result
      }
      else {
        sim.current.series_results.push(result)
        _S.controller.refreshSimulationResults(
          sim.current.series_results.sort((a, b) => { 
            return b[b.length-1].value - a[a.length-1].value
          })
        )
      }
    },

    reportCompletion: function(final_ratio) {
      let sim = this

      sim.beacon.emit('serie_result', {
        result        : sim.current.result,
        serie         : sim.current.serie,
        final_ratio   : final_ratio,
        data_set      : sim.current.data_set_properties
      })
    },

    analyseCurrentSet: function() {
      var sim                 = this
      var data_set            = sim.current.data_set
      var set_len             = data_set.length
      var last_values         = 
        _.pluck(data_set, 'last').sort(function(a, b) { 
          return (a - b) 
        })
      var val_len             = last_values.length
      var data_start_time     = data_set[0].time
      var data_end_time       = data_set[set_len - 1].time
      var span                = (data_end_time - data_start_time)
      var set                 = new Set(sim.current.data_set_name)
      var data_set_properties = {
        min: last_values[0],
        max: last_values[val_len - 1],
        span: span,
        span_days: parseInt(span / common.time.day),
        median: common.median(last_values),
        average: common.average(last_values)
      }
      
      LOG(
        'analyseCurrentSet | data_set_properties, set_len, val_len, data_start_time, data_end_time, data_set[0], data_set[set_len - 1]:',
        data_set_properties, set_len, val_len, data_start_time, data_end_time, data_set[0], data_set[set_len - 1]
      )
      
      set.getAttributes(() => {
        sim.current.data_set_properties = data_set_properties
        sim.current.data_set_properties.name = set.optional_ui_name
      })
      
      return data_set_properties
    },

    resetDataSet: function() {
      if (this.current.data_set_name) 
        delete this.current.data_set_name
      if (this.current.data_set_properties) 
        delete this.current.data_set_properties
    },

    startSeries: function(done) {
      let sim               = this
      let series_array      = []
      let series_options    = [[]]
      let data_sets         = []
      let new_series

      LOG('entering startSeries.')
      sim.loadAllSets((load_errors, data_sets_results) => {
        new_series                    = _S.series.generate(data_sets_results)
        sim.current.series_attributes = new_series.attributes
        sim.current.series_results    = []
       
        if (new_series.generated) {
          sim.processSerie()  
          if (done) return done()
        }
        else if (done) return done(
          'No data sets added through simulator or data loader, ' +
          'or series config contains incorrect settings.'
        )
      })
    },

    processSerie: function(assigned_serie, next) {
      let sim           = this
      let current_serie = assigned_serie || _S.series.next()

      
      sim.series_simulation = true
      sim.current.worker_process = (typeof assigned_serie === 'object')
      sim.current.serie = current_serie
      _S.trader.stopAll()
      sim.applySerieConfig(current_serie)
      
      sim.loadSerieSet(current_serie.data_set, (error, set_data) => {
        _S.exchange.load(_S, set_data)
        _S.generated_data = set_data
        sim.run(next)
      })
    },

    applySerieConfig: function() {
      let sim = this

      _S.series.items.forEach(
        item => _.extend(config[item], sim.current.serie.config[item])
      )
      // LOG('applySerieConfig | _S.config:', _S.config)
    },

    loadSerieSet: function(serie_data_set_name, done) {
      var sim = this
      var loaded = (serie_data_set_name === sim.current.data_set_name)

      LOG('loadSerieSet | init | loaded:', loaded)
      if (loaded) {
        LOG('loadSerieSet | Getting cached data ('+ _S.generated_data.length +')')
        return done(null, _S.generated_data)
      }
      else {
        LOG('Loading series set:', serie_data_set_name)
        sim.loadSet(serie_data_set_name, done)
      }
    }
  }





  return Simulator
}
