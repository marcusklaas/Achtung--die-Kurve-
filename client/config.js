var keyCodeLeft = 37; // left arrow button
var keyCodeRight = 39; // right arrow button
var serverURL = "ws://marcusklaas.nl:7681"; // websocket game server

/* those variables we should probably get from server */
var speed = 90;
var turnSpeed = 3;

/* these are the segment colors for the players. in client order, so the 
 * first one is always for the human player */
var playerColors = ["#FF0000", "#0000FF", "#FFFF00", "#00FF00", "#FF00FF",
 "#E55BB0", "#4E2A04", "#1CB619", "#7EBFF1", "#000000", "#FE8A0E", "#959697",
 "#106246"];