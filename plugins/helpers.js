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
      sell_out: {
        label: "On / Off",
        type: "boolean",
        desc: "Sell all deals at once when sell price for them reaches 'would sell' price."
      }
    },
    trading: {
      min_purchase: {
        label: helpers.current_currency.toUpperCase(),
        type: "integer",
        desc: "Minimum amount per purchase."
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
      }
    }    
  }

  return helpers
}