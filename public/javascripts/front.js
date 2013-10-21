var url = document.location,
    sio_id,
    socket = io.connect(url.protocol+"//"+url.host),
    stampede = new Stampede();

function Stampede() {

}
    
socket.on('connect', function(){
//  console.log(socket.socket.sessionid);
  sio_id = socket.socket.sessionid;
//  console.log("Connection to IO:", sio_id);
  //request("balance");
  //request("ticker");
  request("traders");
});

socket.on("stampede_updates", function(incoming) {
  update(incoming.container || "live-messages", incoming.data);
});

$(document).ready(function() {
  $("body").on("click", ".switch", function() {
    var target = $(this).attr("data-target");
    $(target).toggle();
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


function update(container, data) {
  //console.log("update | container, data:", container, data);
  var html = "<h2>"+container+"</h2>";
  if (data.length) { 
    data.forEach(function(data_point) {
      html += render(data_point);
    });
  }
  else {
    html += render(data);
  }
  document.getElementById(container).innerHTML = html;
}

function render(data) {
  var inner_html= "<hr>";
  for (var key in data) {
    //if (key === "timestamp") data[key] = "" + new Date(parseInt(data[key])*1000);
    if (key === "last") document.title = "$"+data[key];
    inner_html += (typeof(data[key]) === "object") ?
      render(data[key]) :
      ("<p class='"+key+"'><b>"+capitaliseFirstLetter(key.replace(/_/g, " "))+": </b><span class='value'>"+data[key]+"</span></p>");
  }
  return inner_html;
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
