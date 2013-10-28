var url = document.location,
    sio_id,
    socket = io.connect(url.protocol+"//"+url.host),
    stampede = new Stampede();

function Stampede() {
  
  var _me = this;

  this.cache = {
    value_sheet: []
  };

  this.updateValueSheet = function(incoming) {

    if (
      incoming.update_type &&
      incoming.update_type === "full" &&
      incoming.data
    ) {
      _me.cache.value_sheet = incoming.data;
      renderValueSheet(_me.cache.value_sheet);
    }
    else if (
      incoming.update_type &&
      incoming.update_type === "incremental" &&
      incoming.data
    ) {
      _me.cache.value_sheet.push(incoming.data);
      renderValueSheet(_me.cache.value_sheet);
    }
    else {
      console.log("Cache problem.");
    }
  }
}
    
socket.on('connect', function(){
  sio_id = socket.socket.sessionid;
});

socket.on("stampede_updates", function(incoming) {
  update(incoming.container || "live-messages", incoming.data, incoming.rendering || "html");
});


socket.on("stampede_value_sheet_update", stampede.updateValueSheet);


$(document).ready(function() {
  $("body").on("click", ".switch", function() {
    var target = $(this).attr("data-target");
    $(target).toggle();
  });

  $("body").on("click", ".trader-switch", function() {
    var action = $(this).attr("data-action") || "/stop",
        button = this;
    
    //console.log("Triggering action:", action);
    $(button).text((action === "/stop") ? "Stopping trade..." : "Starting trade...");
    $(button).disabled = true;
    $.get(action, function(response) {
      notify(response.message || "Attempted to "+action+".");
      if (response.success) {
        $(".block")[(action === "/stop" ? "addClass" : "removeClass")]("inactive");
        $(button).text((action === "/stop") ? "Wake all" : "Stop all");
        $(button).attr("data-action", (action === "/stop") ? "/start" : "/stop");
      }
      else {
        $(button).text((action === "/stop") ? "Stop all" : "Wake all");
      }
      //console.log("Wakeup response:", response);
      $(button).disabled = false;
    });
  });

  $("body").on("click", "#live-traders .name", function() {
    var confirmation = confirm("Sure to remove trader?");
    if (confirmation) {
      var trader_name = $(".value", this).text();
      $.get("/trader/"+trader_name+"/remove", function(response) {
        notify(response.message || "Updated.");
      });
    }
  });
});


function notify(message) {
  $("#live-messages").append("<p class='notification'>"+message+"</p>");
}


function update(container, data, rendering) {

  var html = "";
  if (data.length) { 
    data.forEach(function(data_point) {
      html += render(data_point);
    });
  }
  else {
    html += render(data);
  }
  $("#"+container)[rendering](html);
  
}

function render(data) {
  var inner_html= "";
  for (var key in data) {
    //console.log("Rendering | key, data[key]:", key, data[key]);
    if (key === "last") document.title = "$"+data[key];
    inner_html += (typeof(data[key]) === "object") ?
      "<div class='sub-block'>"+render(data[key])+"</div>" :
      ("<p class='"+key+"'><b>"+capitaliseFirstLetter(key.replace(/_/g, " "))+": </b><span class='value'>"+data[key]+"</span></p>");
  }
  return inner_html+"<hr>";
}

function request(action) {
  socket.emit("request", {
    action: action
  }, function(response) {
    //console.log(action, response);
    update("live-"+action, response);
  });
}

function capitaliseFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function renderValueSheet(data) {
  
  d3.select("svg").remove();
  
  var min_value = d3.min(data.map(function(d) { return d.value; }));
  console.log("Minimum value for drawing is:", min_value);

  data.forEach(function(d) {
    d.time = new Date(d.time);
    d.delta = d.value - min_value;
  });

  var margin = {top: 10, right: 10, bottom: 100, left: 40},
      margin2 = {top: 230, right: 10, bottom: 20, left: 40},
      width = 930 - margin.left - margin.right,
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

  var svg = d3.select("#live-sheets").append("svg")
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
  y.domain([0, d3.max(data.map(function(d) { return d.value; })) - d3.min(data.map(function(d) { return d.value; }))]);
  x2.domain(x.domain());
  y2.domain(y.domain());

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