'use strict'

// Book for entries book keeping
module.exports = function(STAMPEDE) {
  var db = STAMPEDE.db
  var exchange_simulated = STAMPEDE.exchange_simulated

  // Defines book instance, basically just an array of entries (sales, purchases)
  function Book(trader_name) {

    let current = {
      name: "book_for_" + trader_name,
      trader_name: trader_name
    }

    // Reset balances at the start:
    resetBalances()

    // Add entry to array and record it if we are not simulating
    function add(entry, done) {
      var book_entry = stringBookRecord(entry)
      
      accountFor(entry)
      // Only save the book entry to db if we are not simulating
      if (!exchange_simulated) {
        db.sadd(current.name, book_entry, done)
      }
      else return done()
    }

    function accountFor(entry) {
      current.entries.push(entry)
      current[entry.type + "s_amount_currency"] += (entry.price * entry.amount)
      current[entry.type + "s_amount_btc"] += (entry.amount)

      current.entries.sort((a, b) => (b.time - a.time))
    }

    function resetBalances() {
      current.entries                   = []
      current.purchases_amount_currency = 0
      current.purchases_amount_btc      = 0
      current.sales_amount_currency     = 0
      current.sales_amount_btc          = 0
    }

    // Load book entries from set stored in redis, parse them and populate the 
    // array of entries
    function load(done) {
      db.smembers(current.name, (errors, book_records) => {
        resetBalances()
        if (book_records && book_records.length) {
          book_records.forEach(book_record => {
            var entry = parseBookRecord(book_record)

            if (entry) {
              accountFor(entry)
            }
          })
        }
        if (done) return done(errors)
      })
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
        var type    = record_ar[0]
        var amount  = parseFloat(record_ar[1])
        var price   = parseFloat(record_ar[2])
        var time    = parseInt(record_ar[3])

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

    return {
      add: add,
      current: current,
      load: load
    }
  }


  return Book
}