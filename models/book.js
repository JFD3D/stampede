// Book for entries book keeping
module.exports = function(STAMPEDE) {
  var db = STAMPEDE.db
  var exchange_simulated = STAMPEDE.exchange_simulated

  // Defines book instance, basically just an array of entries (sales, purchases)
  function Book(trader_name) {
    this.name = "book_for_" + trader_name
    this.trader_name = trader_name
    this.entries = []
  }

  Book.prototype = {

    // Add entry to array and record it if we are not simulating
    add: function(type, entry, done) {
      var book = this
      entry.time = Date.now()
      entry.type = type
      var book_entry = stringBookRecord(entry)
      book.entries.push(entry)
      // Only save the book entry to db if we are not simulating
      if (!exchange_simulated) {
        db.sadd(book.name, book_entry, done)
      }
      else {
        return done()
      }
    },

    // Load book entries from set stored in redis, parse them and populate the 
    // array of entries
    load: function(done) {
      var book = this
      book.entries = []
      db.smembers(book.name, function(errors, book_records) {
        if (book_records && book_records.length) {
          book_records.forEach(function(book_record) {
            var rec = parseBookRecord(book_record)
            if (rec) book.entries.push(rec)
          })
        }
        if (done) return done(errors)
      })
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