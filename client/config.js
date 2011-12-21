var keyCodeLeft = 37; // left arrow button
var keyCodeRight = 39; // right arrow button
var serverURL = (location.href.indexOf('localhost') != -1) ? 
	"ws://localhost:" + location.href.substr(location.href.lastIndexOf(':') + 1) : 
	"ws://marcusklaas.nl:7681"; // websocket game server

var lineWidth = 3; // only visual, does not influence collisions
var ultraVerbose = false;
var simStep = 24; // in milliseconds

var syncTries = 2;
var syncDelays = 50;
var simulatedPing = 0;
var maxPositionError = .75;
var maxAngleError = .01;
var behind = 2; // desired difference between tock and tick

var onConnect = null;

var canvasBgcolor = "#D0D0D0";

/* these are the segment colors for the players. in client order, so the 
 * first one is always for the human player */
var playerColors = ["#FF0000", "#0000FF", "#FFFF00", "#00FF00", "#FF00FF",
 "#E55BB0", "#4E2A04", "#1CB619", "#7EBFF1", "#000000", "#FE8A0E", "#959697",
 "#106246"];
