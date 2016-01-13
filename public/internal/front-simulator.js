var Simulator = (function() {

  function initialize() {
    $("#generator-launch").click(launchGenerator)
    $("#simulator-run").click(runSimulator)
    $("#simulator-save-data").click(saveDataSet)
    $("body").on("click", ".simulator-data-loader", loadSavedData)
    $("body").on("click", ".simulator-data-remover", removeSavedData)
    $("body").on("click", ".simulation-speed-button", controlSimSpeed)
    $("body").on("change", ".switch-data-set-inclusion", switchSetInclusion)
  }

  function switchSetInclusion(event) {
    var $checkbox         = $(event.currentTarget)
    var include_in_series = $checkbox.prop("checked")
    var set_name          = $checkbox.attr("data-set-name")

    $.post("/simulator/switch_set_inclusion", {
      set_name: set_name,
      include_in_series: include_in_series
    }, function(response) {
      if (response.error) {
        console.log(response.error)
        notify(response.message || response.error)
      }
    })
  }

  function controlSimSpeed(event) {
    var $button = $(event.currentTarget)
    var vector = parseInt($button.attr('data-vector'))

    $.post('/simulator/adjust_speed', {
      vector: vector
    }, function(response) {
      notify(response.message || 'Failed to submit simulation speed adjustment')
    })
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

