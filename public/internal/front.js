var url = document.location
var sio_id
var socket = io.connect(url.protocol+"//"+url.host)

var STAMPEDE = (function() {
  
  var _me = {};
  var PRICE_SHEET_LIMIT = 300;
  var price_graph;
  


  _me.value_sheet = [];


  function initialize() {

    socket.on('connect', function() {
      sio_id = socket.socket.sessionid;
    });

    socket.on("stampede_updates", function(incoming) {
      //console.log("Incoming:", incoming);
      if (incoming.container && incoming.data) {
        update(incoming.container, incoming.data, incoming.rendering || "html");  
      }
      else if (incoming.target && incoming.html) {
        var target_container = $(incoming.target);
        target_container.html(incoming.html).show();
      }
      else if (incoming.container && incoming.html) {
        var container = ("#" + incoming.container)
        $(".content", container).html(incoming.html).show();
        $(container).show();
      }
      else if (incoming.message) {
        notify(incoming.message, (incoming.permanent ? null : 30000));
      }
      else if (incoming.current_last_price) {
        document.title = incoming.current_last_price;
        priceTick([incoming])
      }
    });

    
    $("body").on("click", ".switch", function() {
      var target = $(this).attr("data-target");
      $(target).toggle();
    });


    $(".async-form").submit(function(event) {
      var form = $(this),
          parent_sub_block = $(this).parents(".sub-block"),
          data = form.serialize(),
          method = (this.method || "post"),
          path = this.action;
      event.preventDefault();
      $[method](path, data, function(response) {
        notify(response.message || "No response.");
        $(".submittal-operators", parent_sub_block).hide();
      });
    });  

    $("body").on("click", ".trader-switch", function() {
      var action = $(this).attr("data-action") || "/stop",
          button = this;
      
      $(button)
        .text((action === "/stop") ? "Stopping trade..." : "Starting trade...");
      $(button).disabled = true;
      $.get(action, function(response) {
        notify(response.message || "Attempted to "+action+".", 60000);
        if (response.success) {
          $(".block")[(
            action === "/stop" ? "addClass" : "removeClass"
          )]("inactive");
          $(button).text((action === "/stop") ? "START" : "STOP");
          $(button).attr("data-action", (
            action === "/stop") ? "/start" : "/stop"
          );
        }
        else {
          $(button).text((action === "/stop") ? "STOP" : "START");
        }
        $(button).disabled = false;
      });
    });

    $("body").on("click", "#live-traders .removal", function() {
      var trader_name = $(this).attr("data-trader"),
          deal_name = $(this).attr("data-deal");
          
      if (trader_name) {
        var confirmation = confirm(
          "Sure to remove " + (
            trader_name && deal_name ? "deal: "+deal_name : "trader: "+trader_name
          ) + "?"
        );
        if (deal_name && confirmation) {
          $.get(
            "/trader/"+trader_name+"/deal/"+deal_name+"/remove", 
          function(response) {
            notify(response.message || "Removed deal.", 10000);
          });
        }
        else if (confirmation) {
          $.get("/trader/"+trader_name+"/remove", function(response) {
            notify(response.message || "Removed trader.", 10000);
          });
        }
      }
    });

    $("body").on("click", "#live-traders .deal-sale", function() {
      var trader_name = $(this).attr("data-trader"),
          deal_name = $(this).attr("data-deal"),
          current_last_price = parseFloat($("#current-last-price").text());
          
      if (trader_name) {
        var confirmation = confirm(
          "Sure to sell " + (
            trader_name && deal_name ? "deal: "+deal_name : "trader: "+trader_name
          ) + " at current price ($" + current_last_price + ")?"
        );
        if (deal_name && confirmation && current_last_price > 10) {
          $.get(
            "/trader/"+trader_name+"/deal/"+deal_name+"/sell", 
          function(response) {
            notify(response.message || "Removed deal.", 10000);
          });
        }
        else {
          notify("Cancelled sale of deal.", 10000)
        }
      }
    });
  };

  function updateValueSheet(incoming) {
    if (
      incoming.update_type === "full" &&
      incoming.data
    ) {
      _me.value_sheet = incoming.data;
      renderValueSheet(_me.value_sheet);
    }
    else if (
      incoming.update_type === "incremental" &&
      incoming.data
    ) {
      if (_me.value_sheet.length > 0) {
        _me.value_sheet.push(incoming.data);
        if (_me.value_sheet.length > incoming.display_limit) {
          _me.value_sheet.shift();
        }
        renderValueSheet(_me.value_sheet);
      } else {
        $.get("/value_sheet", function(incoming) {
          if (incoming.value_sheet) {
            _me.value_sheet = incoming.value_sheet;
            renderValueSheet(_me.value_sheet);
          }
        });
      }
    }
    else {
      console.log("Cache problem.");
    }
  };



  function renderLineGraph(data, container) {
    $(container).empty()
    // Set the dimensions of the canvas / graph
    var margin = {top: 30, right: 20, bottom: 30, left: 50},
        width = 600 - margin.left - margin.right,
        height = 270 - margin.top - margin.bottom;

    // Set the ranges
    var x = d3.time.scale().range([0, width]);
    var y = d3.scale.linear().range([height, 0]);

    // Define the axes

    var xAxis = d3.svg.axis().scale(x)
        .orient("bottom").ticks(5);
    var formatyAxis = d3.format('.0f');
    var yAxis = d3.svg.axis().scale(y)
        .orient("left")
        .tickFormat(formatyAxis)
        .ticks(5);

    //console.log("renderLineGraph | data:", data)
    data.forEach(function(d) {
      d.date = new Date(d.time);
      d.price = (d.price || d.last)
    });

    // Define the line
    var valueline = d3.svg.line()
        .interpolate("basic")
        .x(function(d) { return x(d.date); })
        .y(function(d) { return y(d.price); });
        
    // Adds the svg canvas
    var svg = d3.select(container)
        .append("svg")
          .attr("width", width + margin.left + margin.right)
          .attr("height", height + margin.top + margin.bottom)
        .append("g")
          .attr("transform", 
                "translate(" + margin.left + "," + margin.top + ")");

    // Scale the range of the data
    x.domain(d3.extent(data, function(d) { return d.date; }));
    y.domain([
      d3.min(data, function(d) { return d.price; }) * 0.99, 
      d3.max(data, function(d) { return d.price; })
    ]);

    // Add the valueline path.
    svg.append("path")
        .attr("class", "line")
        .attr("d", valueline(data));

    // Add the X Axis
    svg.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxis);

    // Add the Y Axis
    svg.append("g")
        .attr("class", "y axis")
        .call(yAxis);

    function tick() {
      renderLineGraph(data, container)
    }

    return {
      tick: tick,
      data: data
    }

  }

  function priceTick(points) {
    if (price_graph && price_graph.tick) {
      points.forEach(function(point) {
        point.date = new Date(point.time);
        price_graph.data.push(point);
        price_graph.tick();
        // pop the old data point off the front
        if (price_graph.data.length > PRICE_SHEET_LIMIT) 
          price_graph.data.shift();
      });
    }
    else {
      price_graph = renderLineGraph(points, "#live-price");
      $("#live-price").show();
    }
  }  


  function renderValueSheet(data, container) {
    container = container || "#live-sheets";
    // console.log("renderValueSheet | data.length:", data.length);
    // d3.select("svg").remove();
    $(container).empty();
    var min_value = d3.min(data.map(function(d) { return d.value; }));
    //console.log("Minimum value for drawing is:", min_value);

    data.forEach(function(d) {
      d.time = new Date(d.time);
      d.delta = d.value - min_value;
    });

    var margin = {top: 10, right: 10, bottom: 100, left: 40},
        margin2 = {top: 230, right: 10, bottom: 20, left: 40},
        width = 600 - margin.left - margin.right,
        height = 300 - margin.top - margin.bottom,
        height2 = 300 - margin2.top - margin2.bottom;

    //var parseDate = d3.time.format("%Y-%m-%dT%H:%M:%S.%LZ").parse;

    var x = d3.time.scale().range([0, width]),
        x2 = d3.time.scale().range([0, width]),
        y = d3.scale.linear().range([height, 0]),
        y2 = d3.scale.linear().range([height2, 0]);

    var xAxis = d3.svg.axis().scale(x).orient("bottom"),
        xAxis2 = d3.svg.axis().scale(x2).orient("bottom"),
        yAxis = d3.svg.axis().scale(y).orient("left");

    var brush = d3.svg.brush()
        .x(x2)
        .on("brush", brushed);

    var area = d3.svg.area()
        .interpolate("monotone")
        .x(function(d) { return x(d.time); })
        .y0(height)
        .y1(function(d) { return y(d.delta); });

    var area2 = d3.svg.area()
        .interpolate("monotone")
        .x(function(d) { return x2(d.time); })
        .y0(height2)
        .y1(function(d) { return y2(d.delta); });

    var svg = d3.select(container).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom);

    svg.append("defs").append("clipPath")
        .attr("id", "clip")
      .append("rect")
        .attr("width", width)
        .attr("height", height);

    var focus = svg.append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    var context = svg.append("g")
        .attr("transform", "translate(" + margin2.left + "," + margin2.top + ")");

    x.domain(d3.extent(data.map(function(d) { return d.time; })));
    y.domain([0, d3.max(data.map(rValue)) - d3.min(data.map(rValue))]);
    x2.domain(x.domain());
    y2.domain(y.domain());

    function rValue(d) {
      return d.value;
    }

    focus.append("path")
        .datum(data)
        .attr("clip-path", "url(#clip)")
        .attr("d", area);

    focus.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxis);

    focus.append("g")
        .attr("class", "y axis")
        .call(yAxis);


    context.append("path")
        .datum(data)
        .attr("d", area2);

    context.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height2 + ")")
        .call(xAxis2);

    context.append("g")
        .attr("class", "x brush")
        .call(brush)
      .selectAll("rect")
        .attr("y", -6)
        .attr("height", height2 + 7);
        
    function brushed() {
      x.domain(brush.empty() ? x2.domain() : brush.extent());
      focus.select("path").attr("d", area);
      focus.select(".x.axis").call(xAxis);
    }
  }

  return {
    initialize: initialize,
    renderLineGraph: renderLineGraph
  }

} ())
    


$(document).ready(STAMPEDE.initialize);


function notify(message, decay) {
  var date = new Date(),
      message_id = "notification_"+parseInt(+date);

  $(".content", "#live-messages").prepend(
    "<p class='notification' id='" + message_id + "''><i>" + message + 
    "</i><span style='color:grey'></span></p>"
  );
  if (decay) {
    $("#"+message_id).fadeOut(decay, function() {
      $(this).remove();
    });
  }
}


function update(container, data, rendering) {
  var html = "";
  container = ("#" + container);
  if (data.length) { 
    data.forEach(function(data_point) {
      html += render(data_point);
    });
  }
  else {
    html += render(data);
  }
  $(".content", container)[rendering](html);
  $(container).show();
}

function render(data, level) {
  level = (level || 0);
  level++;
  var inner_html= "";
  for (var key in data) {
    if (key === "last") document.title = "$"+data[key];
    inner_html += (
      typeof(data[key]) === "object" && data[key] !== null
    ) ?
      (
        "<div class='level_" + level + " sub-block " + key + 
        "' data-key='" + key + "'>" + render(data[key], level) + "</div>"
      ) :
      (
        "<p class='" + key + "' data-key='" + key + 
        "'><b>" + capitaliseFirstLetter(key.replace(/_/g, " ")) + 
        ": </b><span class='value'>" + (data[key] || "None")+"</span></p>"
      );
  }
  return inner_html;
}

function request(action) {
  socket.emit("request", {
    action: action
  }, function(response) {
    update("live-" + action, response);
  });
}

function capitaliseFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}


