var BTCChina = require('btcchina'),
    btcchina,
    config = require("./config"),
    https = require('https');

function Exchange(key, secret) {
  console.log("Initializing BTCchina wrapper...");
  btcchina = new BTCChina(key, secret);


}

Exchange.prototype = {
  balance: function(callback) {
    // Need these attributes ["btc_reserved", "fee", "btc_available", "usd_reserved", "btc_balance", "usd_balance", "usd_available"]
    btcchina.getAccountInfo(function(error, data) {
      //console.log("BTCChina.getAccountInfo | error, data, data.result.balance, data.result.frozen:", error, data, data.result.balance, data.result.frozen);
      var unified_balance;

      if (
        !error &&
        data &&
        data.result &&
        data.result.profile &&
        data.result.balance &&
        data.result.frozen
      ) {
         unified_balance = {
          fee: data.result.profile.trade_fee,
          btc_reserved: data.result.frozen.btc.amount,
          btc_balance: data.result.balance.btc.amount,
          btc_available: (parseFloat(data.result.balance.btc.amount) - parseFloat(data.result.frozen.btc.amount || 0)),
          cny_reserved: data.result.frozen.cny.amount,
          cny_balance: data.result.balance.cny.amount,
          cny_available: (parseFloat(data.result.balance.cny.amount) - parseFloat(data.result.frozen.cny.amount || 0)),
        }
      }
      callback(error, unified_balance);
    });
  },
  marketDepth: function(callback) {
    btcchina.getMarketDepth2(null, function(error, data) { 
      //console.log("btcchina.getMarketDepth2 | error, data:", error, data.result.market_depth);
      var unified_ticker;

      if (
        !error &&
        data &&
        data.result &&
        data.result.market_depth &&
        data.result.market_depth.bid &&
        data.result.market_depth.ask
      ) {    

        //["last", "bid", "low", "high", "volume", "ask"]
        unified_ticker = {
          high: data.result.market_depth.bid
        };
      }
      callback(error, unified_ticker);
    });
  },

  ticker: function(callback) {

    //console.log("btcchina wrapper | ticker | Getting btcchina ticker");

    var options = {
      host: "data.btcchina.com",
      path: "/data/ticker",
      method: "GET"
    };


    var req = https.get("https://data.btcchina.com/data/ticker", function(res) {
      //res.setEncoding('utf8');
      var buffer = '', response;
      res.on('data', function(data) {
        buffer += data;
      });
      res.on('end', function() {
        
        //console.log("Ticker end", buffer);

        if (buffer === '401 Unauthorized\n') {
          return callback('General API error: 401 Unauthorized');
        }
          
        try {
          var json = JSON.parse(buffer);
        } 

        catch (err) {
          return callback(err);
        }

        if ('error' in json) {
          return callback(json.error.message + ' (code ' + json.error.code + ')');
        }

        if (json && json.ticker) {
          response = {
            high: json.ticker.high,
            low: json.ticker.low,
            volume: json.ticker.vol,
            ask: json.ticker.buy,
            last: json.ticker.last,
            bid: json.ticker.sell
          };
        }

        callback(null, response);
      });
    });
    req.on('error', function(err) {
      console.log("Error with ticker request");
      callback(err);
    });
  },

  buy: function(amount, price, callback) {
    btcchina.buyOrder(price, amount, callback);
  },

  sell: function(amount, price, callback) {
    btcchina.sellOrder(price, amount, callback);
  }

};

module.exports = Exchange;