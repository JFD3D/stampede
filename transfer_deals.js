// Use as 'node transfer_deals.js NUMBEROFTRADERFROM NUMBEROFTRADERTO

var rdb = redis.createClient(6379),
    transfer_form = process.argv[2],
    transfer_to = process.argv[3];

function transferDeals(from, to, callback) {
  var trader_to = "trader_"+to,
      trader_from = "trader_"+from,
      book_from = "book_for_"+trader_from,
      book_to = "book_for_"+trader_to;

  rdb.smembers(trader_from, function(error, deals) {
    deals.forEach(function(deal_name) {
      rdb.srem(trader_from, deal_name, function(error, response) { 
        if (!error) 
          rdb.sadd(trader_to, deal_name, function(error, response) { console.log("Assigned deal from "+trader_from+" to "+trader_to+" ("+deal_name+").")});
        else
          console.log("Error removing deal ("+deal_name+"):", error, "from", trader_from);
      });
    });
    callback("Transfer submitted.");
  });
}