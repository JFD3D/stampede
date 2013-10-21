var url = document.location,
    sio_id,
    socket = io.connect(url.protocol+"//"+url.host),
    stampede = new Stampede();

function Stampede() {

}
    
socket.on('connect', function(){
//  console.log(socket.socket.sessionid);
  sio_id = socket.socket.sessionid;
  //console.log("Connection to IO:", sio_id);
  //request("balance");
  //request("ticker");
  //request("traders");
});

socket.on("stampede_updates", function(incoming) {
  update(incoming.container || "live-messages", incoming.data, incoming.rendering || "html");
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
    console.log("Rendering | key, data[key]:", key, data[key]);
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
