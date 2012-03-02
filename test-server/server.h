#define EPS 0.0001
#define PI 3.141592653589793
#define MAX_GAME_WIDTH 2047
#define MAX_GAME_HEIGHT 1023
#define TILE_SIZE_MULTIPLIER 3 // tilesize/ segmentlength
#define TICK_LENGTH 24 // in msecs
#define SERVER_DELAY 200 // in msecs
#define COUNTDOWN 2000 // in msecs
#define COOLDOWN 3500 // time between end of round and countdown of next in msecs
#define SB_MAX 50 // sendbuffer max size
#define DELTA_COUNT 11
#define DELTA_MAX 25
#define PRE_PADDING	LWS_SEND_BUFFER_PRE_PADDING
#define POST_PADDING LWS_SEND_BUFFER_POST_PADDING
#define SHOW_DELAY 0
#define MIN_WIN_DIFF 1 // minimum point lead required to win a game
#define AUTO_ROUNDS 7 // number of expected rounds in automatch
#define MAX_PLAYERSTART_TRIES 100
#define TORUS_MODE 0
#define GAMELIST_UPDATE_INTERVAL 10000
#define MAX_USERS_IN_GAME 8
#define KICK_REJOIN_TIME 15000
#define MAX_TELEPORTS 8
#define HACKS 0

/* default game settings */
#define VELOCITY 70 // pixels per sec
#define GAME_WIDTH 1024
#define GAME_HEIGHT 644
#define TURN_SPEED 2.5 // radians per sec
#define HOLE_SIZE 5 // in ticks
#define HOLE_FREQ 150 // number of ticks between holes

/* artificial intelligence */
#define COMPUTER_NAME "COMPUTER"
#define COMPUTER_AI inputmechanism_marcusai
#define COMPUTER_DELAY (SERVER_DELAY/ TICK_LENGTH)
#define COMPUTER_SEARCH_DEPTH 2 // for marcusai
#define COMPUTER_SEARCH_ANGLE 3.141592
#define COMPUTER_SEARCH_CAREFULNESS 2 // how long we go straight in seconds

/* byte messages */
#define MODE_MODIFIED 0
#define MODE_TICKUPDATE 1
#define MODE_PENCIL 2
#define MODE_JSON 3
#define MODE_OTHER 7
#define MODE_SETMAP (8 + 7)

/* debugging */
#define DEBUG_MODE 0
#define PENCIL_DEBUG 0
#define ULTRA_VERBOSE 0
#define SHOW_WARNING 0
#define GOD_MODE 0
#define SEND_SEGMENTS 30 // om de hoeveel ticks het moet gebeuren (0=nooit)
#define SAVE_COLLISION_TO_FILE 0
#define DEBUGPOS 0
#define KEEP_PLAYING_ONE_ALIVE 0

/* input control */
#define MAX_FILE_REQ_LEN 100
#define MAX_NAME_LENGTH 20
#define SHAME_NAME "newplayer500"
#define MAX_CHAT_LENGTH 140
#define UNLOCK_INTERVAL 0 // in msecs

/* spam control. name from 0 to SPAM_CAT_COUNT-1 */
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

/* game leave reasons */
#define LEAVE_NORMAL 0
#define LEAVE_DISCONNECT 1
#define LEAVE_KICKED 2

/* pencil */
#define PM_ON 0
#define PM_ONDEATH 1
#define PM_OFF 2
#define PM_DEFAULT PM_ONDEATH
#define INK_PER_SEC 15
#define MAX_INK 120
#define START_INK 0
#define MOUSEDOWN_INK 20
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

struct seg {
	double x1, y1, x2, y2;
	struct teleport *t;
	struct seg *nxt;
};

struct teleport {
	struct seg seg, dest;
	double dx, dy, anglediff, tall;
	int colorid;
	struct teleport *nxt;
};

struct point {
	double x, y;
};

struct map {
	struct seg *seg, *playerstarts;
	struct teleport *teleports;
};

struct kicknode {
	struct user *usr;
	long expiration; // servermsecs at which the ban expires
	struct kicknode *nxt;
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
		paramupd, rsn,		// servermsecs at time of last paramupdate, #players at round start
		inkcap, inkregen,	// ink capacity, ink regen/ sec
		inkdelay,			// ink harden time in msec
		inkmousedown,		// ink cost to start new line
		inkstart,			// amount of ink you start with when you are allowed to draw
		round,				// 0 at gamecreats, increments at start of round
		modifieds,
		timeadjustments;

	long start;	// start in msecs after server start
	int (*pointsys)(int, int); // function that determines points on death
	double ts;				// turning speed in radians per sec
	struct seg **seg;		// two dimensional array of linked lists, one for each tile
	struct user *usr, *host;// user list, game host
	struct game *nxt;
	struct seg *tosend;		// voor de DEBUG_SEGMENTS
	char pencilmode, torus;	// see PM_*, torus enabled y/n
	struct map *map;
	struct kicknode *kicklist; // for remembering who was kicked so that they dont rejoin too soon
};

struct pencilseg {
	struct seg seg;
	int tick;
	struct pencilseg *nxt, *prev;
};

struct pencil {
	double ink;
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

struct userpos {
	double x, y, angle, v, ts;
	int turn, tick;
	char alive;
};

struct user {
	int id, index;
	struct game *gm;
	struct user *nxt;
	char *name;
	char human;

	void (*inputmechanism)(struct user *, int);
	
	char *recvbuf;		// receivebuffer
	int sbmsglen[SB_MAX]; // length of messages in sendbuffer
	char *sb[SB_MAX];	// sendbuffer
	int sbat;			// sendbuffer at
	
	struct userpos state;	// used in simulation (these are thus SERVER_DELAY behind)
	struct userpos aistate;	
	int points, lastinputtick, lastinputturn, inputcount, gamelistage;
	char ignoreinput;
	
	int hstart, hsize, hfreq;	// hole start, hole size, hole frequency  //TODO: should be moved to userpos

	struct userinput *inputhead, // store unhandled user inputs in queue
					 *inputtail; // insert at tail, remove at head

	struct libwebsocket *wsi;
	int msgcounter[SPAM_CAT_COUNT];		// number of inputs and chat messages received
	int deltaat, delta[DELTA_COUNT];
	char deltaon;
	struct pencil pencil;
};

struct buffer {
	char *start, *at, *end;
};

#define jsonaddnum cJSON_AddNumberToObject
#define jsonaddstr cJSON_AddStringToObject
#define jsonaddfalse cJSON_AddFalseToObject
#define jsonaddtrue cJSON_AddTrueToObject
#define jsonaddjson cJSON_AddItemToObject
#define jsonprint cJSON_PrintUnformatted
#define jsonaddbool(json, name, value) cJSON_AddItemToObject(json, name, cJSON_CreateBool(value))
#define jsondel	cJSON_Delete
#define max(a,b) ((b) > (a) ? (b) : (a))
#define min(a,b) ((b) > (a) ? (a) : (b))

void *smalloc(size_t size);
void *scalloc(size_t num, size_t size);
cJSON *encodegamepars(struct game *gm);
void resetpencil(struct pencil *p, struct user *u);
void cleanpencil(struct pencil *p);
void simpencil(struct pencil *p);
void gototick(struct pencil *p, int tick);
struct game *creategame(int gametype, int nmin, int nmax);
void endgame(struct game *gm, struct user *winner);
void joingame(struct game *gm, struct user *newusr);
double getlength(double x, double y);
char *gametypetostr(int gametype, char *buf);
char *pencilmodetostr(int pencilmode, char *buf);
void addsegment(struct game *gm, struct seg *seg);
double checkcollision(struct game *gm, struct seg *seg);
void endround(struct game *gm);
void tiles(struct game *gm, struct seg *seg, int *tileindices);
void clearinputs(struct user *usr);
char *checkname(char *name);
void handledeath(struct user *usr);
int pointsystem_trivial(int players, int alive);
int pointsystem_wta(int players, int alive);
int pointsystem_rik(int players, int alive);
void allocroom(struct buffer *buf, int size);
void appendheader(struct buffer *buf, char type, char player);
void appendpos(struct buffer *buf, int x, int y);
void logtime();
void logwarningtime();
int checkkick(struct game *gm, struct user *usr);
void freekicklist(struct kicknode *kick);
void inputmechanism_human(struct user *usr, int tick);
void inputmechanism_circling(struct user *usr, int tick);
void inputmechanism_marcusai(struct user *usr, int tick);
void inputmechanism_straightahead(struct user *usr, int tick);
void inputmechanism_random(struct user *usr, int tick);
void inputmechanism_leftisallineed(struct user *usr, int tick);
void inputmechanism_checktangent(struct user *usr, int tick);
void deleteuser(struct user *usr);
void updategamelist();
char *statetostr(int gamestate, char *str);
cJSON *jsoncreate(char *mode);
static long servermsecs();
