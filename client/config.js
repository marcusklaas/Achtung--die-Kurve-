/* global vars */
var enableSound = true;
var joinedLink = false;

/* controls */
var keyCodeLeft = 37;
var keyCodeRight = 39;

var serverURL = "ws://diekurve.net:7681"; // websocket game server
if(location.href.indexOf('7681') != -1)
	serverURL = location.href.replace('http', 'ws');
else if(location.href.indexOf('C:/Dropbox') != -1)
	serverURL = "ws://localhost:7681";

/* visual stuff */
var holeAlpha = 0.2;
var lineWidth = 3; // only visual, does not influence collisions
var lineCapStyle = 'round';
var syncTries = 2;
var syncDelays = 50;
var tickTockDifference = 2; // desired difference between tock and tick
var canvasMinimumWidth = 150;
var crossSize = 12;
var crossLineWidth = 2;
var crossColor = [0, 0, 0];
var rewardShowLength = 1000;
var rewardMaxTransitionLength = 1000;
var rewardOffsetY = 8;
var rewardWidth = 23; // TODO: should be read from document
var rewardHeight = 18;
var maxHiddenRewards = 20;
var startedGamesDisplay = 'below'; // show, below or hide

var safeTickDifference = 30;
var resizeDelay = 200; // the duration the window should have a constant size before calling resize
var paramUpdateInterval = 500; // don't send game intervals more often that one per this many msecs
var paramInputInterval = 2000; // wait for this duration before sending params to server after text edit


var customGameWaitMessage = 'Waiting for host to start the game..';
var autoMatchWaitMessage = 'Waiting for more players..';

/* touch */
var touchDevice = 'createTouch' in document;
var steerBoxSize = 0.15;
var pencilTreshold = 20; // minimum SCALED units movement required to transform steer to pencil 

/* pencil */
var inkBufferTicks = 5;
var pencilAlpha = 0.2;

/* debugging */
var emulateTouch = false;
var ultraVerbose = false;
var simulatedPing = 0;
var extraGameStartTimeDifference = 0;
var acceptGameTimeAdjustments = true;
var jsProfiling = false;
var simulateCPUlag = false;
var debugBaseContext = false; // sets different color for segments in basecontext
var displayDebugStatus = false;
var debugRewards = false;
var alwaysHideSidebar = false;
var debugPos = true;
var debugComputers = 0;
var debugMap = '[{"x1":98,"y1":513,"x2":750,"y2":61,"teleportId":0,"color":[237,28,36]},{"x1":571,"y1":43,"x2":967,"y2":545,"teleportId":0,"color":[237,28,36]},{"x1":168,"y1":384,"x2":923,"y2":391,"teleportId":1,"color":[63,72,204]},{"x1":914,"y1":73,"x2":652,"y2":626,"teleportId":1,"color":[63,72,204]},{"x1":652,"y1":627,"x2":25,"y2":86,"teleportId":2,"color":[43,177,76]},{"x1":431,"y1":90,"x2":188,"y2":288,"teleportId":2,"color":[43,177,76]},{"x1":500,"y1":120,"x2":644,"y2":347,"teleportId":3,"color":[0,0,0]},{"x1":274,"y1":552,"x2":300,"y2":576,"teleportId":3,"color":[0,0,0]},{"x1":229,"y1":94,"x2":760,"y2":115,"teleportId":5,"color":[163,73,164]},{"x1":219,"y1":109,"x2":224,"y2":514,"teleportId":5,"color":[163,73,164]},{"x1":246,"y1":518,"x2":774,"y2":510,"teleportId":6,"color":[0,162,232]},{"x1":790,"y1":477,"x2":843,"y2":473,"teleportId":6,"color":[0,162,232]},{"x1":713,"y1":350,"x2":702.4059650443122,"y2":320.86640387185844,"playerStart":true,"angle":4.363617976800783},{"x1":338,"y1":275,"x2":338,"y2":306,"playerStart":true,"angle":1.5707963267948966},{"x1":756,"y1":92,"x2":725.6019990535815,"y2":98.07960018928371,"playerStart":true,"angle":2.9441970937399122},{"x1":4,"y1":639,"x2":1020,"y2":640,"teleportId":4,"color":[185,122,87]},{"x1":3,"y1":4,"x2":1011,"y2":3,"teleportId":4,"color":[185,122,87]},{"x1":3,"y1":9,"x2":6,"y2":629,"teleportId":7,"color":[136,0,21]},{"x1":1010,"y1":11,"x2":1019,"y2":633,"teleportId":7,"color":[136,0,21]}]';

/* server.h copy */
var maxNameLength = 20;
var modeModified = 0;
var modeTickUpdate = 1;
var modePencil = 2;
var modeJson = 3;
var modeOther = 7;
var modeSetMap = 8 + 7;
var unlockInterval = 0; // minimum time between last changing settings and gamestart in msecs
var minTeleportSize = 15;
var maxTeleports = 8;
var epsilon = 0.0001;

/* indicators */
var indicatorLength = 15;
var indicatorArrowLength = 8;
var indicatorArrowOffset = 2;
var indicatorFont = 24;

/* editor */
var editorStepTime = 125;
var mapSegmentColor = [96, 96, 96];

/* these are the segment RGBs for the players */
var playerColors = [[237, 28, 36], [63, 72, 204], [43, 177, 76],
 [0, 0, 0], [185, 122, 87], [163, 73, 164], [0, 162, 232], [136, 0, 21]];
