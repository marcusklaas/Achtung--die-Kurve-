#define EPS 0.0001
#define GAME_WIDTH 1024
#define GAME_HEIGHT 644
#define TILE_SIZE_MULTIPLIER 10 // tilesize/ segmentlength
#define VELOCITY 70 // pixels per sec
#define TURN_SPEED 2.5 // radians per sec
#define HOLE_SIZE 5 // in ticks
#define HOLE_FREQ 150 // number of ticks between holes
#define TICK_LENGTH 24 // in msecs
#define SERVER_DELAY 200 // in msecs
#define COUNTDOWN 1000 // in msecs
#define COOLDOWN 2000 // time between end of round and countdown of next in msecs
#define SB_MAX 50 // sendbuffer max size
#define DELTA_COUNT 11
#define DELTA_MAX 25
#define PRE_PADDING	LWS_SEND_BUFFER_PRE_PADDING
#define POST_PADDING LWS_SEND_BUFFER_POST_PADDING
#define SHOW_DELAY 0
#define MIN_WIN_DIFF 1 // minimum point lead required to win a game
#define AUTO_ROUNDS 5 // number of expected rounds in automatch
#define MAX_PLAYERSTART_TRIES 500
#define TORUS_MODE 1
#define GAMELIST_UPDATE_INTERVAL 10000

/* debugging */
#define DEBUG_MODE 1
#define PENCIL_DEBUG 0
#define ULTRA_VERBOSE 0
#define SHOW_WARNING 1
#define GOD_MODE 0
#define SEND_SEGMENTS 20 // om de hoeveel ticks het moet gebeuren (0=nooit)

/* input control */
#define MAX_FILE_REQ_LEN 100
#define MAX_NAME_LENGTH 20
#define SHAME_NAME "newplayer500"
#define MAX_CHAT_LENGTH 140
#define UNLOCK_INTERVAL 0 // in msecs

/* spam control. name from 0 to SPAM_CAT_COUNT - 1 to prevent horrible segfaults */
#define SPAM_CAT_COUNT			4
#define SPAM_CAT_JOINLEAVE		0
#define SPAM_CAT_CHAT			1
#define SPAM_CAT_SETTINGS		2
#define SPAM_CAT_STEERING		3

#define SPAM_JOINLEAVE_MAX		4
#define SPAM_JOINLEAVE_INTERVAL 200
#define SPAM_CHAT_MAX			5
#define SPAM_CHAT_INTERVAL		200
#define SPAM_SETTINGS_MAX		1
#define SPAM_SETTINGS_INTERVAL	4
#define SPAM_STEERING_MAX		60
#define SPAM_STEERING_INTERVAL	60

/* pencil */
#define PM_ON 0
#define PM_ONDEATH 1
#define PM_OFF 2
#define PM_DEFAULT PM_ONDEATH
#define INK_PER_SEC 25
#define MAX_INK 200
#define START_INK MAX_INK
#define MOUSEDOWN_INK 30
#define INK_MIN_DISTANCE 5
#define INK_SOLID 5000

/* game types */
#define GT_LOBBY 0
#define GT_AUTO 1
#define GT_CUSTOM 2

/* game states */
#define GS_LOBBY 0
#define GS_STARTED 1
#define GS_REMOVING_GAME 2
#define GS_ENDED 3

/* http server */
#define LOCAL_RESOURCE_PATH "../client"
#define LOCAL_PATH_LENGTH 9 // is there a better way?

enum demo_protocols {
	PROTOCOL_HTTP = 0, // always first
	PROTOCOL_GAME,
	DEMO_PROTOCOL_COUNT // always last
};

struct seg{
	float x1, y1, x2, y2;
	struct seg *nxt;
};

struct point {
	float x, y;
};

struct map {
	struct seg *seg;
};

struct game {
	int id, type,			// game_id, game_type
		n, w, h, v,			// number of players, width, height, velocity
		nmin, nmax,			// desired number of players
		tilew, tileh,		// tile width & height
		htiles, vtiles,		// number of horizontal tiles & vertical tiles
		goal, state,		// required points to win, game state, see GS_* definitions
		tick, alive,		// #ticks that have passed, #alive players
		hsize, hfreq,		// hole size and frequency in ticks
		start, rsn,			// start in msecs after server start, #players at round start
		paramupd,			// servermsecs at time of last paramupdate
		inkcap, inkregen,	// ink capacity, ink regen/ sec
		inkdelay,			// ink harden time in msec
		inkmousedown,		// ink cost to start new line
		inkstart,			// amount of ink you start with when you are allowed to draw
		round;				// 0 at gamecreats, increments at start of round

	int (*pointsys)(int, int); // function that determines points on death
	float ts;				// turning speed in radians per sec
	struct seg **seg;		// two dimensional array of linked lists, one for each tile
	struct user *usr, *host;// user list, game host
	struct game *nxt;
	struct seg *tosend;		// voor de DEBUG_SEGMENTS
	char pencilmode, torus;	// see PM_*, torus enabled y/n
	struct map *map;
};

struct pencilseg {
	struct seg seg;
	int tick;
	struct pencilseg *nxt, *prev;
};

struct pencil {
	float ink;
	int x, y, tick;
	char down;
	struct pencilseg *pseghead, *psegtail;
	struct user *usr;
};

struct userinput {
	int tick;
	int turn;
	struct userinput *nxt;
};

struct user {
	int id;
	struct game *gm;
	struct user *nxt;
	char *name;
	
	char *recvbuf;		// receivebuffer
	int sbmsglen[SB_MAX]; // length of messages in sendbuffer
	char *sb[SB_MAX];	// sendbuffer
	int sbat;			// sendbuffer at

	float x, y, angle, v, ts;	// used in simulation (these are thus SERVER_DELAY behind)
	int turn, points, lastinputtick, gamelistage;
	char alive, ignoreinput;
	
	int hstart, hsize, hfreq;	// hole start, hole size, hole frequency

	struct userinput *inputhead, // store unhandled user inputs in queue
					 *inputtail; // insert at tail, remove at head

	struct libwebsocket *wsi;
	int msgcounter[SPAM_CAT_COUNT];		// number of inputs and chat messages received
	int delta[DELTA_COUNT];
	int deltaat;
	char deltaon;
	struct pencil pencil;
};

void *smalloc(size_t size);
void *scalloc(size_t num, size_t size);
cJSON *getjsongamepars(struct game *gm);
void resetpencil(struct pencil *p, struct user *u);
void cleanpencil(struct pencil *p);
void simpencil(struct pencil *p);
void gototick(struct pencil *p, int tick);
struct game *creategame(int gametype, int nmin, int nmax);
void endgame(struct game *gm, struct user *winner);
void joingame(struct game *gm, struct user *newusr);
float getlength(float x, float y);
char *gametypetostr(int gametype);
char *pencilmodetostr(int pencilmode);
void addsegment(struct game *gm, struct seg *seg);
float checkcollision(struct game *gm, struct seg *seg);
void endround(struct game *gm);
void tiles(struct game *gm, struct seg *seg, int *tileindices);
void clearinputs(struct user *usr);
char *checkname(char *name);
void killplayer(struct user *usr);
int pointsystem_trivial(int players, int alive);
int pointsystem_wta(int players, int alive);
int pointsystem_rik(int players, int alive);
