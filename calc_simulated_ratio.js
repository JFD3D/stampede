var common = require('./plugins/common'),
    config = require('./plugins/config'),
    min_price = process.argv[2] || 400,
    max_price = process.argv[3] || 600,
    max_investment = config.trading.maximum_investment,
    base_price = config.trading.maximum_currency_per_deal,
    alt_drop = config.trading.altitude_drop;

function calculate() {
  var levels = common.getAltitudeLevels(min_price, max_price, alt_drop),
      deal_matrix = [];
  
  console.log("calculate | levels:", levels);
  var ratio = 
        common.getCurrentRatio(max_investment, levels, 2, base_price),
      cur_amount = base_price;

  console.log("calculate | result:", ratio);

  levels.forEach(function(price_level, level_index) {
    
    var deal = { 
          price: price_level.toFixed(2),
          currency_amount: cur_amount,
          amount: cur_amount / price_level
        };
    deal_matrix.push(deal);
    cur_amount *= ratio;
  });

  console.log("calculate | deal schedule:\n", deal_matrix);
}

calculate();

