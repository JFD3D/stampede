// Use as 'node transfer_deals.js NUMBEROFTRADERFROM NUMBEROFTRADERTO'

var rdb = require("redis").createClient(6379),
    transfer_from = process.argv[2],
    transfer_to = process.argv[3];

if (transfer_from && transfer_to) {
  transferDeals(transfer_from, transfer_to, console.log);
}
else console.log("Transfers not defined, process.argv:", process.argv);

function transferDeals(from, to, callback) {
  var trader_to = "trader_"+to,
      trader_from = "trader_"+from,
      book_from = "book_for_"+trader_from,
      book_to = "book_for_"+trader_to;

  rdb.smembers(book_from, function(error, deals) {
    deals.forEach(function(deal_name) {
      rdb.srem(book_from, deal_name, function(error, response) { 
        if (!error) 
          rdb.sadd(book_to, deal_name, function(error, response) { 
            console.log("Assigned deal from "+trader_from+" to "+trader_to+" ("+deal_name+").");
          });
        else
          console.log("Error removing deal ("+deal_name+"):", error, "from", trader_from);
      });
    });
    callback("Transfer submitted.");
  });
}