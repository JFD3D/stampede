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

  helpers.labels = {
    strategy: {
      momentum_trading: {
        label: "On / Off",
        type: "boolean",
        desc: "Buy when price momentum is positive only."
      },
      trailing_stop: {
        label: "On / Off",
        type: "boolean",
        desc: "Sell after price drops below half of greed percentage off the max price."
      },
      shedding: {
        label: "On / Off",
        type: "boolean",
        desc: "Sell out all BTC when no more money left and price below greed percentage of average buy price."
      },
      bell_bottom: {
        label: "On / Off",
        type: "boolean",
        desc: "Increase amount for each purchase while price is dropping."
      },
      combined_selling: {
        label: "On / Off",
        type: "boolean",
        desc: "Sell highest and lowest price deals at the same time."
      },
      dynamic_multiplier: {
        label: "On / Off",
        type: "boolean",
        desc: "Calculate multiplier for next purchase amount based on available resources and projected purchase prices (if switched off, uses Fibonacci series)."
      },
      dynamic_drop: {
        label: "On / Off",
        type: "boolean",
        desc: "Increase the drop of next price purchase (Currently per fibonacci series only)."
      }
    },
    trading: {
      base_currency_per_deal: {
        label: helpers.current_currency.toUpperCase(),
        type: "integer",
        desc: "Base deal amount per initial deal (Remains same when 'bell bottom' strategy disabled)."
      },
      maximum_investment: {
        label: helpers.current_currency.toUpperCase(),
        type: "integer",
        desc: "Maximum investment in currency."
      },
      bid_alignment: {
        label: "%",
        type: "float",
        desc: "Align bid price for bids completion when selling or buying."
      },
      max_number_of_deals_per_trader: {
        label: "x",
        type: "integer",
        desc: "How many deals can one trader manage."
      },
      momentum_time_span: {
        label: "miliseconds",
        type: "integer",
        desc: "Time span for momentum average calculation."
      },
      greed: {
        label: "%",
        type: "float",
        desc: "Upside the trader is looking for."
      },
      impatience: {
        label: "%",
        type: "integer",
        desc: "Determines at what price range of current (24h) spread will the trader be willing to buy."
      },
      altitude_drop: {
        label: "%",
        type: "float",
        desc: "Base drop price percentage for buying (if 'dynamic drop' strategy enabled, drop increases)."
      }
    }    
  }

  return helpers
}


  // base_currency_per_deal: 20,           // Base $ per starting deal / trade / hand
  // maximum_investment: 0,                // Maximum total $ allowed to invest in BTC
  // bid_alignment: 0.999,                 // Bid align for competitive edge when placing bids 
  //                                       // EXAMPLE: BTC price is $600, to buy, we would place order at: 600 / 0.999 = 600.6
  // max_number_of_deals_per_trader: 3,    // How many deals can a trader manage
  // momentum_time_span: 5*60*1000,        // Set momentum time span to x minutes (change the first number, that is minutes)
  // greed: 0.05,                          // What upside does the trader look for?
  //                                       // EXAMPLE: If bought 1 BTC for $600, with greed at 0.05, it will sell for 600*(1+0.05) = 630
  // impatience: 0.01,                     // When do I buy, for how much over current middle 
  //                                       // (Example: Middle is at $600, hight at $700, impatience 0.2, I would buy at (700 - 600)*0.2 + 600 = 620
  // altitude_drop: 1  

// exports.strategy = {
//   momentum_trading: false,
//   trailing_stop: true,
//   shedding: true,
//   bell_bottom: true,
//   combined_selling: true,
//   dynamic_multiplier: true, // Calculate deal multiplication per altitude drop and current high
//   dynamic_drop: true        // Dynamically increase altitude drop per fibonacci series
// }