/******************************************************************
 * JSON HELP FUNCTIONS
 */

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

// returns NULL on error
char *jsongetstr(cJSON *json, char* obj) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return 0;
	}
	return json->valuestring;
}

// returns -1 on error
int jsongetint(cJSON *json, char* obj) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valueint;
}

// returns -1 on error
float jsongetfloat(cJSON *json, char* obj) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valuedouble;
}

// returns NULL on error
cJSON *jsongetjson(cJSON *json, char* obj) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return 0;
	}
	return json;
}

// to check if a member exists
cJSON *jsoncheckjson(cJSON *json, char* obj) {
	return cJSON_GetObjectItem(json, obj);
}

void jsonsetstr(cJSON *json, char* obj, char* str) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return ;
	}
	json->valuestring = str;
}


void jsonsetbool(cJSON *json, char* obj, char value) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return ;
	}
	json->type = value ? cJSON_True : cJSON_False;
}

void jsonsetnum(cJSON *json, char* obj, double val) {
	json = cJSON_GetObjectItem(json, obj);
	if(!json) {
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return ;
	}
	json->valuedouble = val;
	json->valueint = val;
}

cJSON *jsoncreate(char *mode) {
	cJSON *json = cJSON_CreateObject();
	cJSON_AddStringToObject(json, "mode", mode);
	return json;
}

cJSON *getjsongamepars(struct game *gm) {
	cJSON *json = jsoncreate("gameParameters");

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
	jsonaddstr(json, "type", gametypetostr(gm->type));
	jsonaddstr(json, "pencilmode", pencilmodetostr(gm->pencilmode));
	jsonaddnum(json, "torus", gm->torus);
	jsonaddnum(json, "inkcap", gm->inkcap);
	jsonaddnum(json, "inkregen", gm->inkregen);
	jsonaddnum(json, "inkdelay", gm->inkdelay);
	jsonaddnum(json, "inkstart", gm->inkstart);
	jsonaddnum(json, "inkmousedown", gm->inkmousedown);
	
	return json;
}

/******************************************************************
 * LIBWEBSOCKETS HELP FUNCTIONS
 */

/* pads str and puts it in send buffer for user */
void sendstr(char *str, int len, struct user *u) {
	char *buf;

	if(u->sbat == SB_MAX) {
		if(SHOW_WARNING) printf("send-buffer full.\n");
		return;
	}

	// tmp is being freed inside the callback
	buf = smalloc(PRE_PADDING + len + POST_PADDING);
	memcpy(buf + PRE_PADDING, str, len);

	u->sbmsglen[u->sbat] = len;
	u->sb[u->sbat++] = buf;

	if(ULTRA_VERBOSE) {
		// zero terminate for print
		char *tmp = smalloc(len + 1);
		memcpy(tmp, buf + PRE_PADDING, len);
		tmp[len] = 0;
		printf("queued msg %s for user %d\n", tmp, u->id);
	}

	libwebsocket_callback_on_writable(ctx, u->wsi);
}

void sendjson(cJSON *json, struct user *u) {
	char *buf = jsonprint(json);
	sendstr(buf, strlen(buf), u);
}

void sendstrtogame(char *msg, int len, struct game *gm, struct user *outsider) {
	struct user *usr;

	for(usr = gm->usr; usr; usr = usr->nxt)
		if(usr != outsider)
			sendstr(msg, len, usr);
}

/* sends a json object to all in game, except for outsider */
void sendjsontogame(cJSON *json, struct game *gm, struct user *outsider) {
	char *buf = jsonprint(json);
	sendstrtogame(buf, strlen(buf), gm, outsider);
}

char *duplicatestring(char *orig) {
	return strcpy(smalloc(strlen(orig) + 1), orig);
}

/* encodes index (i), tickdelta (d) and turn (t) in 2 bytes
 * layout: iiiidddd dddddddt */
unsigned short encodesteer(unsigned short index, unsigned short tickdelta, unsigned char turn) {
	unsigned short tmp = 0;
	tmp &= 1 & turn;
	tmp &= (((1 << 11) - 1) << 1) & (tickdelta << 1);
	tmp &= (((1 << 4) - 1) << 12) & (index << 12);
	return tmp;
}

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
	struct seg *b = smalloc(sizeof(struct seg));
	memcpy(b, a, sizeof(struct seg));
	return b;
}

/******************************************************************
 * THIS-TO-THAT CONVERTERS
 */

char *gametypetostr(int gametype) {
	char *str = smalloc(7);

	if(gametype == GT_AUTO)
		strcpy(str, "auto");
	else if(gametype == GT_LOBBY)
		strcpy(str, "lobby");
	else
		strcpy(str, "custom");

	return str;
}

char *statetostr(int gamestate) {
	char *str = smalloc(8);

	if(gamestate == GS_LOBBY)
		strcpy(str, "lobby");
	else if(gamestate == GS_STARTED)
		strcpy(str, "started");
	else
		strcpy(str, "ended");

	return str;
}

char *pencilmodetostr(int pencilmode) {
	char *str = smalloc(10);

	if(pencilmode == PM_ON)
		strcpy(str, "on");
	else if(pencilmode == PM_ONDEATH)
		strcpy(str, "ondeath");
	else
		strcpy(str, "off");

	return str;
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

float getlength(float x, float y) {
	return sqrt(x * x + y * y);
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
	struct game *gm = headgame;
	if(!gm) printf("no games active\n");
	for(; gm; gm =gm->nxt)
		printgame(gm);
}

void printseg(struct seg *seg) {
	printf("(%.2f, %.2f)->(%.2f, %.2f)", seg->x1, seg->y1, seg->x2, seg->y2);
}

void printjson(cJSON *json) {
	char *buf = cJSON_Print(json);
	printf("%s\n", buf);
	free(buf);
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
