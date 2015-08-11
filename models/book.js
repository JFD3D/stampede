// Book for entries book keeping
module.exports = function(STAMPEDE) {
  var db = STAMPEDE.db
  var exchange_simulated = STAMPEDE.exchange_simulated

  // Defines book instance, basically just an array of entries (sales, purchases)
  function Book(trader_name) {
    this.name = "book_for_" + trader_name
    this.trader_name = trader_name
    this.entries = []
    this.purchases_amount_currency = 0
    this.purchases_amount_btc = 0
    this.sales_amount_currency = 0
    this.sales_amount_btc = 0
  }

  Book.prototype = {

    // Add entry to array and record it if we are not simulating
    add: function(entry, done) {
      var book = this
      var book_entry = stringBookRecord(entry)
      
      book.accountFor(entry)
      // Only save the book entry to db if we are not simulating
      if (!exchange_simulated) {
        db.sadd(book.name, book_entry, done)
      }
      else {
        return done()
      }
    },

    accountFor: function(entry) {
      var book = this

      book.entries.push(entry)
      book[entry.type + "s_amount_currency"] += (entry.price * entry.amount)
      book[entry.type + "s_amount_btc"] += (entry.amount)
    },

    resetBalances: function() {
      var book = this

      book.entries = []
      book.purchases_amount_currency = 0
      book.purchases_amount_btc = 0
      book.sales_amount_currency = 0
      book.sales_amount_btc = 0
    },

    // Load book entries from set stored in redis, parse them and populate the 
    // array of entries
    load: function(done) {
      var book = this

      db.smembers(book.name, function(errors, book_records) {
        book.resetBalances()
        if (book_records && book_records.length) {
          book_records.forEach(function(book_record) {
            var entry = parseBookRecord(book_record)

            if (entry) {
              book.accountFor(entry)
            }
          })
        }
        if (done) return done(errors)
      })
    },

    rebalance: function() {

    }
  }

  // Convert the record passed in, into a string we will store as set member 
  // in redis
  function stringBookRecord(rec) {
    return ([rec.type, rec.amount, rec.price, rec.time].join("|"))
  }

  // Parse book entry record
  function parseBookRecord(record) {
    var record_ar = record.split("|")
    var rec
    if (record_ar.length) {
      var type = record_ar[0]
      var amount = parseFloat(record_ar[1])
      var price = parseFloat(record_ar[2])
      var time = parseInt(record_ar[3])
      if (type && amount > 0 && price > 0 && time > 0) {
        rec = {
          type: type,
          price: price,
          amount: amount,
          time: time
        }
      }
    }
    return rec
  }

  return Book
}