var keyCodeLeft = 37; // left arrow button
var keyCodeRight = 39; // right arrow button
var serverURL = (location.href.indexOf('localhost') != -1) ? 
	"ws://localhost:" + location.href.substr(location.href.lastIndexOf(':') + 1) : 
	"ws://marcusklaas.nl:7681"; // websocket game server

var lineWidth = 3; // only visual, does not influence collisions
var ultraVerbose = false;
var simStep = 24; // in milliseconds
var gapAlpha = 0.2;
var canvasBgcolor = '#D0D0D0';
var lineCapStyle = 'round';
var indicatorDotSize = 2;
var indicatorLength = 10;

var syncTries = 2;
var syncDelays = 50;
var simulatedPing = 0;
var behind = 2; // desired difference between tock and tick
var onConnect = null;

/* these are the segment RGBs for the players. in client order, so the 
 * first one is always for the human player */
var playerColors = [[255, 0, 0], [0, 0, 255], [255, 255, 0], [0, 255, 0],
 [255, 0, 255], [229, 91, 176], [78, 42, 4], [28, 182, 25], [126, 191, 241],
 [0, 0, 0], [254, 138, 14], [149, 150, 151], [16, 98, 70]];
