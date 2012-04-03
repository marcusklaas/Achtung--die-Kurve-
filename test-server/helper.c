#define log(...) {LOGTICK; LOGMSG(__VA_ARGS__);}
#define loggame(gm, ...) {LOGTICK; LOGGAME(gm); LOGMSG(__VA_ARGS__);}
#define logplayer(usr, ...) {LOGTICK; LOGGAME(usr->gm); LOGPLAYER(usr); LOGMSG(__VA_ARGS__);}
#define LOGTICK {logtime(); LOGMSG("%4lu ", serverticks % 10000);}
#define LOGGAME(gm) if(gm) LOGMSG("g:%-4d ", gm->id)
#define LOGPLAYER(usr) LOGMSG("u:%-4d ", usr->id)
#define LOGMSG(...) printf(__VA_ARGS__)

#define warning(...) {WARNINGTICK; WARNINGMSG(__VA_ARGS__);}
#define warninggame(gm, ...) {WARNINGTICK; WARNINGGAME(gm); WARNINGMSG(__VA_ARGS__);}
#define warningplayer(usr, ...) {WARNINGTICK; WARNINGGAME(usr->gm); WARNINGPLAYER(usr); WARNINGMSG(__VA_ARGS__);}
#define WARNINGTICK {logwarningtime(); WARNINGMSG("%4lu ", serverticks % 10000);}
#define WARNINGGAME(gm) if(gm) WARNINGMSG("g:%-4d ", gm->id)
#define WARNINGPLAYER(usr) WARNINGMSG("u:%-4d ", usr->id)
#define WARNINGMSG(...) fprintf(stderr, __VA_ARGS__)

/******************************************************************
 * MEMORY-RELATED
 */

// safe malloc, exit(500) on error
void *smalloc(size_t size) {
	void *a = malloc(size);
	if(!a) {
		printf("malloc failed, exiting..\n");
		exit(500);
	}
	return a;
}

void *scalloc(size_t num, size_t size) {
	void *a = calloc(num, size);
	if(!a) {
		printf("calloc failed, exiting..\n");
		exit(500);
	}
	return a;
}

void *srealloc(void *ptr, size_t size) {
	void *a = realloc(ptr, size);
	if(!a) {
		printf("realloc failed, exiting..\n");
		exit(500);
	}
	return a;
}

struct seg *copyseg(const struct seg *a) {
	return memcpy(smalloc(sizeof(struct seg)), a, sizeof(struct seg));
}

void freesegments(struct seg *seg) {
	struct seg *nxt;
	for(; seg; seg = nxt) {
		nxt = seg->nxt;
		free(seg);
	}
}

void freeteleports(struct teleport *tp) {
	struct teleport *nxt;
	for(; tp; tp = nxt) {
		nxt = tp->nxt;
		free(tp);
	}
}

void createaimap(struct game *gm) {
	gm->aimap = scalloc(1, sizeof(struct aimap));
	gm->aimap->tile = scalloc(gm->htiles * gm->vtiles, sizeof(struct aitile));
}

void freeaimap(struct game *gm) {
	int i;
	for(i = 0; i < gm->htiles * gm->vtiles; i++) {
		struct aitile *tile = gm->aimap->tile + i;
		if(tile->seg)
			free(tile->seg);
	}
	
	free(gm->aimap->tile);
	free(gm->aimap);
	gm->aimap = 0;
}

void freemapaidata(struct mapaidata *data) {
	struct linkedbranch *lb = data->headbranch, *nxt;
	
	while(lb) {
		nxt = lb->nxt;
		free(lb);
		lb = nxt;
	}
	
	if(data->input) {
		free(data->input);
		data->input = 0;
	}
}

void freemap(struct map *map) {
	freesegments(map->seg);
	freesegments(map->playerstarts);
	freeteleports(map->teleports);
	free(map);
}

char *duplicatestring(char *orig) {
	return strcpy(smalloc(strlen(orig) + 1), orig);
}

struct buffer encodemap(struct map *map) {
	struct buffer buf;
	struct seg *seg;
	struct teleport *tel;
	
	buf.start = 0;
	appendheader(&buf, MODE_SETMAP, 0);
	*buf.at++ = 0; // to make sure msg length at least 3
	*buf.at++ = 0;

	for(tel = map->teleports; tel; tel = tel->nxt) {
		appendchar(&buf, tel->colorid | 32);
		seg = &tel->seg;
		appendpos(&buf, seg->x1, seg->y1);
		appendpos(&buf, seg->x2, seg->y2);
		seg = &tel->dest;
		appendpos(&buf, seg->x1, seg->y1);
		appendpos(&buf, seg->x2, seg->y2);
	}

	// this marks start of segments
	appendchar(&buf, 0);

	for(seg = map->seg; seg; seg = seg->nxt) {
		appendpos(&buf, seg->x1, seg->y1);
		appendpos(&buf, seg->x2, seg->y2);
	}
	return buf;
}

cJSON *encodesegments(struct seg *seg) {
	cJSON *ar = cJSON_CreateArray();
	while(seg) {
		cJSON *a = cJSON_CreateObject();
		jsonaddnum(a,"x1", seg->x1);
		jsonaddnum(a,"y1", seg->y1);
		jsonaddnum(a,"x2", seg->x2);
		jsonaddnum(a,"y2", seg->y2);
		cJSON_AddItemToArray(ar, a);
		seg = seg->nxt;
	}
	return ar;
}

cJSON *encodegame(struct game *gm) {
	cJSON *json = cJSON_CreateObject();
	char buf[20];

	jsonaddnum(json, "id", gm->id);
	jsonaddnum(json, "n", gm->n);
	jsonaddnum(json, "nmin", gm->nmin);
	jsonaddnum(json, "nmax", gm->nmax);
	if(gm->host)
		jsonaddstr(json, "host", gm->host->name);

	jsonaddstr(json, "type", gametypetostr(gm->type, buf));
	jsonaddstr(json, "state", statetostr(gm->state, buf));
	return json;
}

cJSON *encodegamelist() {
	struct game *gm;
	cJSON *game, *gmArr, *json = jsoncreate("gameList");
	
	gmArr = cJSON_CreateArray();
	cJSON_AddItemToObject(json, "games", gmArr);

	for(gm = headgame; gm; gm = gm->nxt) {
		game = encodegame(gm);
		cJSON_AddItemToArray(gmArr, game);
	}

	return json;
}

cJSON *encodegamepars(struct game *gm) {
	cJSON *json = jsoncreate("gameParameters");
	char buf[20];

	jsonaddnum(json, "countdown", COUNTDOWN);
	jsonaddnum(json, "hsize", gm->hsize);
	jsonaddnum(json, "hfreq", gm->hfreq);
	jsonaddnum(json, "w", gm->w);
	jsonaddnum(json, "h", gm->h);
	jsonaddnum(json, "nmin", gm->nmin);
	jsonaddnum(json, "nmax", gm->nmax);
	jsonaddnum(json, "v", gm->v);
	jsonaddnum(json, "ts", gm->ts);
	jsonaddnum(json, "id", gm->id);
	jsonaddnum(json, "goal", gm->goal);
	jsonaddstr(json, "type", gametypetostr(gm->type, buf));
	jsonaddstr(json, "pencilmode", pencilmodetostr(gm->pencilmode, buf));
	jsonaddnum(json, "torus", gm->torus);
	jsonaddnum(json, "inkcap", gm->inkcap);
	jsonaddnum(json, "inkregen", gm->inkregen);
	jsonaddnum(json, "inkdelay", gm->inkdelay);
	jsonaddnum(json, "inkstart", gm->inkstart);
	jsonaddnum(json, "inkmousedown", gm->inkmousedown);
	
	return json;
}

/******************************************************************
 * JSON HELP FUNCTIONS
 */

// returns NULL on error
char *jsongetstr(cJSON *json, char *obj) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return 0;
	}
	return json->valuestring;
}

// returns -1 on error
int jsongetint(cJSON *json, char *obj) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valueint;
}

// returns -1 on error
double jsongetdouble(cJSON *json, char *obj) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valuedouble;
}

// returns NULL on error
cJSON *jsongetjson(cJSON *json, char *obj) {
	json = cJSON_GetObjectItem(json, obj);

	if(!json && DEBUG_MODE)
		printf("json parse error! object '%s' not found!\n", obj);

	return json;
}

// to check if a member exists
cJSON *jsoncheckjson(cJSON *json, char *obj) {
	return cJSON_GetObjectItem(json, obj);
}

cJSON *jsoncreate(char *mode) {
	cJSON *json = cJSON_CreateObject();
	cJSON_AddStringToObject(json, "mode", mode);
	return json;
}

/******************************************************************
 * LIBWEBSOCKETS HELP FUNCTIONS
 */

/* pads str and puts it in send buffer for user */
void sendstr(char *str, int len, struct user *u) {
	char *buf;

	if(!u->human)
		return;

	if(u->sbat == SB_MAX) {
		if(SHOW_WARNING) printf("send-buffer full.\n");
		return;
	}

	// being freed inside callback
	buf = smalloc(PRE_PADDING + len + POST_PADDING);
	memcpy(buf + PRE_PADDING, str, len);
	
	pthread_mutex_lock(&u->comlock);

	u->sbmsglen[u->sbat] = len;
	u->sb[u->sbat++] = buf;

	if(ULTRA_VERBOSE) {
		// zero terminate for print
		char *tmp = smalloc(len + 1);
		memcpy(tmp, buf + PRE_PADDING, len);
		tmp[len] = 0;
		printf("queued msg %s for user %d\n", tmp, u->id);
		free(tmp);
	}

	libwebsocket_callback_on_writable(ctx, u->wsi);
	pthread_mutex_unlock(&u->comlock);
}

void sendjson(cJSON *json, struct user *u) {
	char *buf;

	if(!u->human)
		return;

	buf = jsonprint(json);
	sendstr(buf, strlen(buf), u);
	free(buf);
}

void airstr(char *msg, int len, struct game *gm, struct user *outsider) {
	struct user *usr;

	for(usr = gm->usr; usr; usr = usr->nxt)
		if(usr != outsider)
			sendstr(msg, len, usr);
}

/* sends a json object to all in game, except for outsider */
void airjson(cJSON *json, struct game *gm, struct user *outsider) {
	char *buf = jsonprint(json);
	airstr(buf, strlen(buf), gm, outsider);
	free(buf);
}

void airmap(struct map *map, struct game *gm, struct user *outsider) {
	struct buffer buf = encodemap(map);
	airstr(buf.start, buf.at - buf.start, gm, outsider);
	free(buf.start);
}

void sendmap(struct map *map, struct user *usr) {
	struct buffer buf = encodemap(map);
	sendstr(buf.start, buf.at - buf.start, usr);
	free(buf.start);
}

void sendgamelist(struct user *usr) {
	updategamelist();

	if(gamelistage > usr->gamelistage) {
		usr->gamelistage = gamelistage;
		sendstr(gamelist, gamelistlen, usr);
	}
}

void sendhost(struct user *host, struct user *usr) {
	cJSON *j = jsoncreate("setHost");
	jsonaddnum(j, "playerId", host->id);
	sendjson(j, usr);
	jsondel(j);
}

void airhost(struct game *gm) {
	cJSON *j = jsoncreate("setHost");
	jsonaddnum(j, "playerId", gm->host->id);
	airjson(j, gm, 0);
	jsondel(j);
}

/* send message to group: this player died */
void airdeath(struct user *usr, int tick, int reward) {
	cJSON *json = jsoncreate("playerDied");
	jsonaddnum(json, "playerId", usr->id);
	jsonaddnum(json, "reward", reward);
	jsonaddnum(json, "tick", tick);
	jsonaddnum(json, "x", usr->state.x);
	jsonaddnum(json, "y", usr->state.y);
	airjson(json, usr->gm, 0);
	jsondel(json);
}

void airsegments(struct game *gm) {
	if(gm->tosend) {
		cJSON *json = jsoncreate("segments");
		cJSON *ar = encodesegments(gm->tosend);
		freesegments(gm->tosend);
		gm->tosend = 0;
		jsonaddjson(json, "segments", ar);
		airjson(json, gm, 0);
		jsondel(json);
	}
}

void airgamelist() {
	struct user *usr;
	static int updateticks = GAMELIST_UPDATE_INTERVAL/ TICK_LENGTH;
	int i = 0, maxsends = ceil(lobby->n * (float) (serverticks % updateticks) / updateticks);

	// should be faster?
	// maxsends = lobby->n * (serverticks % updateticks) / updateticks + 1;

	for(usr = lobby->usr; usr && i++ < maxsends; usr = usr->nxt)
		if(servermsecs() - GAMELIST_UPDATE_INTERVAL > usr->gamelistage)
			sendgamelist(usr);
}

/******************************************************************
 * BYTE MESSAGES
 */

/* sends updated tick for the last input of usr in 4 bytes
 * m = mode, j = input index, d = tickdelta
 * layout: xjjjjmmm xjjjjjjj xdddjjjj xddddddd */
void sendmodified(struct user *usr, int tickdelta) {
	char response[4];
	int index = usr->inputcount;

	logplayer(usr, "sending modified msg, input = %d, delta = %d\n", index, tickdelta);

	response[0] = 7 & MODE_MODIFIED;
	response[0] |= (127 - 7) & (index << 3);
	response[1] = 127 & (index >> 4);
	response[2] = 15 & (index >> 11);
	response[2] |= (127 - 15) & (tickdelta << 4);
	response[3] = 127 & (tickdelta >> 3);

	sendstr(response, 4, usr);
}

/* sends tick update for user to his game in 3 bytes
 * layout: xdiiimmm xddddddd xddddddd */
void sendtickupdate(struct user *usr, int tickdelta) {
	char response[3];

	response[0] = 7 & MODE_TICKUPDATE;
	response[0] |= (8 + 16 + 32) & (usr->index << 3);
	response[0] |= 64 & (tickdelta << 6);
	response[1] = 127 & (tickdelta >> 1);
	response[2] = 127 & (tickdelta >> 8);

	airstr(response, 3, usr->gm, usr);
}

/* encodes index (i), tickdelta (d) and turn (t) in 2 bytes
 * layout: xdddtiii xddddddd */
void encodesteer(char *target, unsigned short index, unsigned short tickdelta, unsigned char turnchange) {
	target[0] = 7 & index;
	target[0] |= (1 & turnchange) << 3;
	target[0] |= (16 + 32 + 64) & (tickdelta << 4);
	target[1] = 127 & (tickdelta >> 3);
}

char getturnchange(char newturn, char oldturn) {
	if(newturn == 1)
		return 1;

	if(newturn == -1)
		return 0;

	return oldturn == 1;
}

/* handles steer message, timeouts and modifications */
void sendsteer(struct user *usr, int tick, int turn, int delay) {
	char response[2];
	int turndelta = getturnchange(turn, usr->lastinputturn);
	int tickdelta = tick - usr->lastinputtick;

	/* not enough bits to encode tickdelta, work around this */
	if(tickdelta >= (1 << 10)) {
		sendtickupdate(usr, tickdelta - 1);
		tickdelta = 1;
	}

	encodesteer(response, usr->index, tickdelta, turndelta);
	airstr(response, 2, usr->gm, usr);

	if(delay)
		sendmodified(usr, delay);

	usr->lastinputtick = tick;
	usr->lastinputturn = turn;
	usr->inputcount++;
}

void allocroom(struct buffer *buf, int size) {
	if(!buf->start) {
		buf->at = buf->start = smalloc(size);
		buf->end = buf->start + size;
	} else if(buf->end - buf->at < size){
		int len = buf->at - buf->start;
		int capacity = buf->end - buf->start;
		
		capacity *= 2;
		if(capacity < size)
			capacity = size;
		
		buf->start = srealloc(buf->start, capacity);
		buf->at = buf->start + len;
		buf->end = buf->start + capacity;
	}
}

void appendheader(struct buffer *buf, char type, char player) {
	allocroom(buf, 20);
	*buf->at++ = type | player << 3;
}

void appendpos(struct buffer *buf, int x, int y) {
	allocroom(buf, 3);
	*buf->at++ = x & 127;
	*buf->at++ = (x >> 7 & 15) | (y << 4 & (16 + 32 + 64));
	*buf->at++ = y >> 3 & 127;
}

void appendchar(struct buffer *buf, char c) {
	allocroom(buf, 1);
	*buf->at++ = c & 127;
}

void appendtick(struct buffer *buf, int tick) {
	allocroom(buf, 3);
	*buf->at++ = tick & 127;
	*buf->at++ = (tick >> 7) & 127;
	*buf->at++ = (tick >> 14) & 127;
}

/******************************************************************
 * THIS-TO-THAT CONVERTERS
 */

char *gametypetostr(int gametype, char *str) {
	if(gametype == GT_AUTO)
		return strcpy(str, "auto");
	if(gametype == GT_LOBBY)
		return strcpy(str, "lobby");
	return strcpy(str, "custom");
}

char *statetostr(int gamestate, char *str) {
	if(gamestate == GS_LOBBY)
		return strcpy(str, "lobby");
	return (gamestate == GS_STARTED) ? strcpy(str, "started") : strcpy(str, "ended");
}

char *leavereasontostr(int reason, char *str) {
	if(reason == LEAVE_NORMAL)
		return strcpy(str, "normal");
	if(reason == LEAVE_DISCONNECT)
		return strcpy(str, "disconnected");
	return strcpy(str, "kicked");
}

char *pencilmodetostr(int pencilmode, char *str) {
	if(pencilmode == PM_ON)
		return strcpy(str, "on");
	return (pencilmode == PM_ONDEATH) ? strcpy(str, "ondeath") : strcpy(str, "off");
}

int strtopencilmode(char *pencilstr) {
	if(!strcmp(pencilstr, "on"))
		return PM_ON;
	if(!strcmp(pencilstr, "ondeath"))
		return PM_ONDEATH;
	return PM_OFF;
}

/******************************************************************
 * REST
 */

float roundavgpts(int players, int (*pointsys)(int, int)) {
	int i, total = 0;

	for(i = players; --i; total += i * pointsys(players, i));

	return total/ (float) players;
}

/* is there no extension, return "" */
char *getFileExt(char *path) {
	char *ext, *point = strrchr(path, '.');
	int extLen;

	if(!point || point < strrchr(path, '/'))
		return scalloc(1, 1);
	
	point++;

	ext = smalloc((extLen = strlen(point)) + 1);
	ext[extLen] = 0; 

	/* do some strtolower action (why isnt this in standard libs? :S) */
	for(point += --extLen; extLen >= 0; point--)
		ext[extLen--] = ('A' <= *point && *point <= 'Z') ? ((*point) - 26) : *point;

	return ext;
}

#ifdef _WIN32
	#include <windows.h>
	inline void msleep(unsigned int msecs) {
		Sleep(msecs);
	}
#else
	inline void msleep(unsigned int msecs) {
		usleep(1000 * msecs);
	}
#endif

static long servermsecs() {
	static struct timeval tv;
	static long serverstart = -1;

	if(serverstart == -1) {
		serverstart = 0;
		serverstart = servermsecs();
	}

	gettimeofday(&tv, 0);

	return 1000 * tv.tv_sec + tv.tv_usec/ 1000 - serverstart;
}

double getlength(double x, double y) {
	return sqrt(x * x + y * y);
}

double getseglength(struct seg *seg) {
	return getlength(seg->x2 - seg->x1, seg->y2 - seg->y1);
}

double getangle(double x, double y) {
	if(x == 0)
		return y < 0 ? PI * 3 / 2 : PI / 2;
		
	return atan(y / x) + (x > 0 ? 0 : PI);
}

double getsegangle(struct seg *seg) {
	return getangle(seg->x2 - seg->x1, seg->y2 - seg->y1);
}

char seginside(struct seg *seg, int w, int h) {
	return min(seg->x1, seg->x2) >= 0 && min(seg->y1, seg->y2) >= 0 &&
	 max(seg->x1, seg->x2) <= w && max(seg->y1, seg->y2) <= h;
}

/* point systems specify how many points the remaining players get when
 * someone dies */
int pointsystem_trivial(int players, int alive) {
	return 1;
}

int pointsystem_wta(int players, int alive) {
	return alive == 1;
}

int pointsystem_rik(int players, int alive) {
	int points[] = {
		6,0,0,0,0,0,0,0,
		6,2,0,0,0,0,0,0,
		6,3,1,0,0,0,0,0,
		6,4,2,1,0,0,0,0
	};
	int map[] = {-1, 0,0, 1, 2,2,2, 3,3};
	
	return points[map[players] * 8 + alive - 1] - points[map[players] * 8 + alive];
}

/******************************************************************
 * DEBUGGING HELPERS
 */

void printuser(struct user *u) {
	printf("user %d: name = %s, in game = %p\n", u->id, u->name ? u->name : "(null)", (void *)u->gm);
}

void printgame(struct game *gm) {
	struct user *usr;
	printf("game %p: n = %d, state = %d, users =\n", (void *)gm, gm->n, gm->state);
	for(usr = gm->usr; usr; usr = usr->nxt) {
		printf("\t");
		printuser(usr);
	}
}

void printgames() {
	struct game *gm;
	
	pthread_mutex_lock(&gamelistlock);
	gm = headgame;	
	if(!gm) printf("no games active\n");
	for(; gm; gm =gm->nxt)
		printgame(gm);
		
	pthread_mutex_unlock(&gamelistlock);
}

void printseg(struct seg *seg) {
	printf("(%.2f, %.2f)->(%.2f, %.2f)", seg->x1, seg->y1, seg->x2, seg->y2);
}

void printjson(cJSON *json) {
	char *buf = cJSON_Print(json);
	printf("%s\n", buf);
	free(buf);
}

void logtime() {
	long now = servermsecs();

	if(now - lastlogtime > 1000 * 60 * 5) {
		struct tm *local;
		time_t t;

		t = time(NULL);
		local = localtime(&t);

		LOGMSG("%s", asctime(local));
		lastlogtime = now;
	}
}

void logwarningtime() {
	long now = servermsecs();

	if(now - lastwarninglogtime > 1000 * 60 * 5) {
		struct tm *local;
		time_t t;

		t = time(NULL);
		local = localtime(&t);

		WARNINGMSG("%s", asctime(local));
		lastwarninglogtime = now;
	}
}

void logstartgame(struct game *gm) {
	loggame(gm, "started! players: %d\n", gm->n);

	if(gm->type == GT_CUSTOM) {
		char *a;
		cJSON *j;

		j = encodegamepars(gm);
		a = cJSON_Print(j);
		log("%s\n", a);

		free(a);
		jsondel(j);

		if(gm->map) {
			j = encodesegments(gm->map->seg);
			a = cJSON_PrintUnformatted(j);
			log("%s\n", a);

			free(a);
			jsondel(j);
		}
	}
}

/******************************************************************
 * INPUT_CONTROL
 */

/* returns 1 in case of spam, 0 if OK */
int checkspam(struct user *usr, int category) {
	return ++usr->msgcounter[category] > spam_maxs[category];
}

/* resets due spam counters for users in game */
void resetspamcounters(struct game *gm, int tick) {
	struct user *usr;
	int i, reset;

	for(i = 0; i < SPAM_CAT_COUNT; i++) {
		reset = (tick % spam_intervals[i]) == 0;

		for(usr = gm->usr; usr; usr = usr->nxt)
			if(reset)
				usr->msgcounter[i] = 0;
	}
}

/* checks that 0 < name size <= MAX_NAME_LENGTH and does not exclusively consist of 
 * chars like space */
char *checkname(char *name) {
	char nameok = 0, notonly[1] = {' '}, *checkedName;
	int i, j;

	for(i = 0; name[i]; i++)
		for(j = 0; j < 1; j++)
			nameok |= name[i] != notonly[j];

	checkedName = smalloc(MAX_NAME_LENGTH + 1);
	
	strncpy(checkedName, nameok ? name : SHAME_NAME, MAX_NAME_LENGTH);
	checkedName[MAX_NAME_LENGTH] = 0;

	return checkedName;
}
