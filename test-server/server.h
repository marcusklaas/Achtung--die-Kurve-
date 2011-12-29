#define EPS 0.00000001
#define GAME_WIDTH 1024
#define GAME_HEIGHT 644
#define TILE_SIZE_MULTIPLIER 4 // tilesize/ segmentlength
#define VELOCITY 70 // pixels per sec
#define TURN_SPEED 2.5 // radians per sec
#define HOLE_SIZE 7 // in ticks
#define HOLE_FREQ 150 // number of ticks between holes
#define HOLE_START_MIN 50 // after how many ticks first hole may appear
#define HOLE_START_MAX 200 // after how many ticks first hole must have appeared
#define DEBUG_MODE 1
#define TICK_LENGTH 24 // in msecs
#define SERVER_DELAY 9 // in ticks
#define COUNTDOWN 42 // in ticks
#define COOLDOWN 84 // time between end of round and countdown of next in ticks
#define SB_MAX 10 // sendbuffer max size
#define DELTA_COUNT 11
#define DELTA_MAX 25
#define ULTRA_VERBOSE 0
#define SHOW_WARNING 1
#define PRE_PADDING	LWS_SEND_BUFFER_PRE_PADDING
#define POST_PADDING	LWS_SEND_BUFFER_POST_PADDING
#define SEND_SEGMENTS 0 // om de hoeveel ticks het moet gebeuren (0=nooit)
#define SHOW_DELAY 0
#define MIN_WIN_DIFF 2 // minimum point lead required to win a game
#define TWO_PLAYER_POINTS 3 // points required to win two player game

/* input control */
#define MAX_FILE_REQ_LEN 100
#define MAX_NAME_LENGTH 50
#define MAX_CHAT_LENGTH 140
#define INPUT_CONTROL_INTERVAL 60 // in ticks
#define SPAM_CHECK_INTERVAL 200 // in ticks
#define MAX_INPUTS 60 // per control interval
#define MAX_CHATS 5 // per check interval

/* pencil */
#define PENCIL_GAME 1
#define INK_PER_SEC 25
#define MAX_INK 200
#define START_INK MAX_INK
#define MOUSEDOWN_INK 30
#define INK_BUFFER_TICKS 5
#define INK_MIN_DISTANCE 5
#define INK_VISIBLE 400
#define INK_SOLID 5000

/* game types */
#define GT_LOBBY 0
#define GT_AUTO 1
#define GT_CUSTOM 2

/* game states */
#define GS_LOBBY 0
#define GS_STARTED 1
#define GS_REMOVING_GAME 2

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

struct game{
	int type, n, w, h,		// game_type, number of players, width, height
		nmin, nmax,			// desired number of players
		tilew, tileh,		// tile width & height
		htiles, vtiles,		// number of horizontal tiles & vertical tiles
		goal, state,		// required points to win, game state, see GS_* definitions
		v, ts,				// velocity, turn speed
		tick, alive,		// #ticks that have passed, #alive players
		hsize, hfreq,		// hole size and frequency in ticks
		hmin, hmax,			// min/ max ticks before start of first hole
		start;				// start time in milliseconds after epoch
	struct seg **seg;	// two dimensional array of linked lists, one for each tile
	struct user *usr;	// user list
	struct game *nxt;
	struct seg *tosend;	// voor de DEBUG_SEGMENTS
	char pencilgame;
};

struct pencilseg{
	struct seg seg;
	int tick;
	struct pencilseg *nxt, *prev;
};

struct pencil {
	float ink, x, y;
	struct pencilseg *pseghead, *psegtail;
	struct user *usr;
	int tick, lasttick;
};

struct userinput {
	int tick;
	int turn;
	struct userinput *nxt;
};

struct user{
	int id;
	struct game *gm;
	struct user *nxt;
	char *name;			
	
	char *sb[SB_MAX];	// sendbuffer
	int sbat;			// sendbuffer at

	float x, y, angle;	// used in simulation (these are thus SERVER_DELAY behind)
	int turn;			// -1, 0 or 1
	char alive;			// 1 for alive, 0 else
	int points;
	
	int hstart, hsize, hfreq;	// hole start, hole size, hole frequency

	struct userinput *inputhead, // store unhandled user inputs in queue
					 *inputtail; // insert at tail, remove at head

	struct libwebsocket *wsi;
	int inputs, chats;			// number of inputs and chat messages received
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
void joingame(struct game *gm, struct user *newusr);
float getlength(float x, float y);
