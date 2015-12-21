'use strict'

module.exports = _S => {

  let SERIES_CONF = require(_S.dir + '/configs/series/series_config')
  let _           = _S._
  let common      = _S.common
  let CONF_ITEMS  = _.keys(SERIES_CONF).slice(0)
  let CURRENT     = { generated : false }
  let LOG         = _S.LOG('series')

  function generate(data_set_records) {
    let options           = [[]]
    let attributes        = ['data_sets:data_set']
    let data_sets         = _.pluck(
      _.where(data_set_records, { include_in_series: true }), 'record_name'
    )
    // Push in data set indexes to the options
    _.each(data_sets, (data_set, idx) => {
      options[0].push(idx)
      // Build out the options and settings arrays
    })

    _.each(CONF_ITEMS, conf_item => {
      for (let setting in SERIES_CONF[conf_item]) {
        let setting_array = []
        
        attributes.push(conf_item + ':' + setting)
        SERIES_CONF[conf_item][setting].forEach((option, option_index) => {
          setting_array.push(option_index)
        })
        options.push(setting_array)
      }
    })
      
    LOG('generate | attributes:', attributes)
    // Assign data sets to series config
    SERIES_CONF.data_sets = data_sets

    // Now combine the options into cartesian combinations
    let serie_array = common.cartesian(options)
    // Return the constructed settings in case we want to reuse
    return _.extend(CURRENT, {
      generated : (serie_array.length && data_sets.length),
      array     : serie_array,
      attributes: attributes,
      config    : SERIES_CONF,
      idx       : -1
    })
  }

  function notStarted() {
    return (CURRENT.idx < 0)
  }

  function next() {
    CURRENT.idx++

    let current_options = CURRENT.array[CURRENT.idx]
    let serie_config    = {}
    let option_idx      = 0

    if (current_options) {
      let current_set_idx = current_options[0]
      
      _.each(CONF_ITEMS, (conf_item) => {
        serie_config[conf_item] = {}
        _.each(SERIES_CONF[conf_item], (item_setting_idxs, item_setting_name) => {
          option_idx++
          serie_config[conf_item][item_setting_name] = 
            item_setting_idxs[current_options[option_idx]]
        })
      })
      LOG('next | CURRENT.idx, serie_config, current_options:', CURRENT.idx, serie_config, current_options)      
      return {
        options       : current_options,
        config        : serie_config,
        data_set      : SERIES_CONF.data_sets[current_set_idx],
        last          : (CURRENT.idx === (CURRENT.array.length - 1)),
        count         : CURRENT.array.length,
        remaining     : (CURRENT.array.length - (CURRENT.idx + 1)),
        idx           : CURRENT.idx
      }
    }
    else return null
  }

  return {
    items     : CONF_ITEMS,
    next      : next,
    generate  : generate
  }
}

