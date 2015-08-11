var Simulator = (function() {

  function initialize() {
    $("#generator-launch").click(launchGenerator);
    $("#simulator-run").click(runSimulator);
    $("#simulator-save-data").click(saveDataSet);
    $("body").on("click", ".simulator-data-loader", loadSavedData);
    $("body").on("click", ".simulator-data-remover", removeSavedData);
  }
  
  function renderData(data) {
    STAMPEDE.renderLineGraph(data, "#chart");
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


  return {
    initialize: initialize
  }
} ())


$(document).ready(Simulator.initialize);

