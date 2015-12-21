//

'use strict'

{
  let conf    = require('./../configs/config')
  let async   = require('async')
  let request = require('request')
  var colors  = require('colors')
  let btce    = BTCE(conf.credentials.btce.key, conf.credentials.btce.secret)
  let $amount = 100
  let fee     = 0.002
 
  let tick    = (pair_str, done) => btce.ticker(pair_str, done)
  let calcOn  = (data) => {
    let btc_usd_last = data.btc_usd.last
    let ltc_usd_last = data.ltc_usd.last
    let ltc_btc_last = data.ltc_btc.last

    let ltc_per_$   = ($amount / ltc_usd_last) * (1 - fee)
    let btc_per_ltc = (ltc_per_$ * ltc_btc_last) * (1 - fee)
    let $_per_btc   = btc_per_ltc * btc_usd_last * (1 - fee)
    let ratio       = (($_per_btc / $amount * 100) - 100)
    let ratio_label = ratio.toFixed(2)

    // console.log(`
    //   btc_usd_last: ${btc_usd_last},
    //   ltc_usd_last: ${ltc_usd_last},
    //   ltc_btc_last: ${ltc_btc_last},

    //   ltc_per_$: ${ltc_per_$},
    //   btc_per_ltc: ${btc_per_ltc},
    //   $_per_btc: ${$_per_btc}
    // `)
    let label = 'Profit / Loss: ' + ratio_label + '%'
    console.log(label[ratio > 100 ? 'rainbow' : 'red'])
  }

  let getData = () => tick('btc_usd-ltc_usd-ltc_btc', (error, data) => calcOn(data))

  function BTCE(key, secret) {
    let path_stump = 'https://btc-e.com/api/3'
    let ticker = (pair_str, done) => {
      let path = path_stump + '/ticker/' + pair_str
      request(path, (error, response, body) => done(error, JSON.parse(body)))
    }

    return { ticker: ticker }
  }

  let get_interval = setInterval(getData, 2500)
}
