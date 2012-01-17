/******************************************************************
 * JSON HELP FUNCTIONS
 */

#define jsonaddnum cJSON_AddNumberToObject
#define jsonaddstr cJSON_AddStringToObject
#define jsonaddfalse cJSON_AddFalseToObject
#define jsonaddtrue cJSON_AddTrueToObject
#define jsonaddjson cJSON_AddItemToObject
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

// returns string with on position PRE_PADDING the message
char *jsongetpacket(cJSON *json) {
	char *tmp, *buf;
	tmp = cJSON_PrintUnformatted(json);
	buf = smalloc(PRE_PADDING + strlen(tmp) + 1 + POST_PADDING);
	memcpy(buf + PRE_PADDING, tmp, strlen(tmp) + 1);
	free(tmp);
	return buf;
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
	
	return json;
}

/******************************************************************
 * LIBWEBSOCKETS HELP FUNCTIONS
 */

// will not free buf
void sendstr(char *buf, struct user *u) {
	char *tmp;
	if(u->sbat ==SB_MAX) {
		if(SHOW_WARNING) printf("send-buffer full.\n");
		return;
	}
	// tmp is being freed inside the callback
	tmp = smalloc(PRE_PADDING + strlen(buf + PRE_PADDING) + 1 + POST_PADDING);
	memcpy(tmp, buf, PRE_PADDING + strlen(buf + PRE_PADDING) + 1 + POST_PADDING);
	u->sb[u->sbat++] = tmp;
	if(ULTRA_VERBOSE) printf("queued msg %s, will be sent to user %d\n", tmp + PRE_PADDING, u->id);
	libwebsocket_callback_on_writable(ctx, u->wsi);
}

void sendjson(cJSON *json, struct user *u) {
	char *buf = jsongetpacket(json);
	sendstr(buf, u);
	free(buf);
}

/* sends a message to all in game, except for given user. to send message to
 * all, set u = 0 */
void sendjsontogame(cJSON *json, struct game *gm, struct user *outsider) {
	struct user *usr;
	char *buf = jsongetpacket(json);

	for(usr = gm->usr; usr; usr = usr->nxt)
		if(usr != outsider)
			sendstr(buf, usr);

	free(buf);
}

char *duplicatestring(char *orig) {
	char *duplicate = smalloc(strlen(orig) + 1);
	return strcpy(duplicate, orig);
}


/******************************************************************
 * REST
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

/* renamed to servermsecs */
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
	printf("(%.1f, %.1f)->(%.1f, %.1f)",seg->x1,seg->y1,seg->x2,seg->y2);
}

float getlength(float x, float y) {
	return sqrt(x * x + y * y);
}
