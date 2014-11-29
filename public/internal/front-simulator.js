function Simulator() {

}

var sim = new Simulator();


var Simulator = (function() {

  function initialize() {
    $("#generator-launch").click(launchGenerator);
    $("#simulator-run").click(runSimulator);
    $("#simulator-save-data").click(saveDataSet);
    $("body").on("click", ".simulator-data-loader", loadSavedData);
    $("body").on("click", ".simulator-data-remover", removeSavedData);
  }
  
  function renderData(data) {
    renderGeneratedData(data);
    $("#simulator-run, #simulator-set-save-container").show();
  };

  function loadSavedData(event) {
    notify("Loading saved set.");
    actionAsyncLink(event, this, renderData);
  }

  function removeSavedData(event) {
    actionAsyncLink(event, this);
  }

  function actionAsyncLink(event, element, callback) {
    event.preventDefault();
    var action = element.href,
        method = $(element).attr("data-method") || "get";
    $[method](action, function(response) {
      if (response) {
        notify(response.message || "Complete.");
        if (callback && response.data) callback(response.data);
      }
    });
  }

  function saveDataSet() {
    $.post("/simulator/save_data_set", {
      set_name_ui: $("#simulator-set-name").val()
    }, function(response) {
      if (response) {
        notify(response.message || "Submitted data set to storage.");
      }
    });
  }

  function launchGenerator() {
    $.get("/simulator/generate", function(response) {
      if (response.data) {
        renderData(response.data);
      }
    });
  }

  function runSimulator() {
    $.get("/simulator/run", function(response) {
      notify(response.message || "Simulator failed.");
      //$("#simulator-run").hide();
    }); 
  }

  function renderGeneratedData(data, container) {
    d3.select("svg").remove();

    data.forEach(function(d) {
      d.time = new Date(d.time);
      d.value = parseInt(d.last);
    });

    var margin = {top: 10, right: 10, bottom: 100, left: 40},
        margin2 = {top: 230, right: 10, bottom: 20, left: 40},
        width = 600 - margin.left - margin.right,
        height = 300 - margin.top - margin.bottom,
        height2 = 300 - margin2.top - margin2.bottom;

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
        .y1(function(d) { return y(d.value); });

    var area2 = d3.svg.area()
        .interpolate("monotone")
        .x(function(d) { return x2(d.time); })
        .y0(height2)
        .y1(function(d) { return y2(d.value); });

    var svg = d3.select(container || "#chart").append("svg")
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
    y.domain([0, d3.max(data.map(function(d) { return d.value; }))]);
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


  return {
    initialize: initialize
  }
} ())


$(document).ready(Simulator.initialize);

