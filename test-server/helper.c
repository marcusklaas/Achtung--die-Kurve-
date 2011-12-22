/******************************************************************
 * JSON HELP FUNCTIONS
 */

#define jsonaddnum cJSON_AddNumberToObject
#define jsonaddstr cJSON_AddStringToObject
#define jsonaddfalse cJSON_AddFalseToObject
#define jsonaddtrue cJSON_AddTrueToObject
#define jsonaddjson cJSON_AddItemToObject
#define jsondel	cJSON_Delete
#define max(a,b) ((b) > (a) ? (b) : (a))

// returns NULL on error
char *jsongetstr(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return 0;
	}
	return json->valuestring;
}
// returns -1 on error
int jsongetint(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valueint;
}

void jsonsetstr(cJSON *json, char* obj, char* str){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return ;
	}
	json->valuestring= str;
}

void jsonsetnum(cJSON *json, char* obj, double val){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(DEBUG_MODE) printf("json parse error! object '%s' not found!\n", obj);
		return ;
	}
	json->valuedouble = val;
	json->valueint = (int)val;
}

cJSON *jsoncreate(char *mode){
	cJSON *json= cJSON_CreateObject();
	cJSON_AddStringToObject(json, "mode", mode);
	return json;
}

// returns string with on position PRE_PADDING the message
char *jsongetpacket(cJSON *json){
	char *tmp, *buf;
	tmp= cJSON_PrintUnformatted(json);
	buf= smalloc(PRE_PADDING + strlen(tmp) + 1 + POST_PADDING);
	memcpy(buf + PRE_PADDING, tmp, strlen(tmp) + 1);
	free(tmp);
	return buf;
}

cJSON *getjsongamepars(struct game *gm){
	cJSON *json= jsoncreate("gameParameters");
	jsonaddnum(json, "w", gm->w);
	jsonaddnum(json, "h", gm->h);
	jsonaddnum(json, "nmin", gm->nmin);
	jsonaddnum(json, "nmax", gm->nmax);
	jsonaddnum(json, "v", gm->v);
	jsonaddnum(json, "ts", gm->ts);
	return json;
}

/******************************************************************
 * LIBWEBSOCKETS HELP FUNCTIONS
 */

// will not free buf
void sendstr(char *buf, struct user *u){
	char *tmp;
	if(u->sbat==SB_MAX){
		if(SHOW_WARNING) printf("send-buffer full.\n");
		return;
	}
	// tmp is being freed inside the callback
	tmp= smalloc(PRE_PADDING + strlen(buf + PRE_PADDING) + 1 + POST_PADDING);
	memcpy(tmp, buf, PRE_PADDING + strlen(buf + PRE_PADDING) + 1 + POST_PADDING);
	u->sb[u->sbat++]= tmp;
	if(ULTRA_VERBOSE) printf("queued msg %s, will be sent to user %d\n", tmp + PRE_PADDING, u->id);
	libwebsocket_callback_on_writable(ctx, u->wsi);
}

void sendjson(cJSON *json, struct user *u){
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
void *smalloc(size_t size){
	void* a= malloc(size);
	if(!a){
		printf("malloc failed, exiting..\n");
		exit(500);
	}
	return a;
}
void *scalloc(size_t num, size_t size){
	void* a= calloc(num, size);
	if(!a){
		printf("malloc failed, exiting..\n");
		exit(500);
	}
	return a;
}

/* renamed to servermsecs because by epochmsecs i meant milliseconds since epoch
 * which is 00:00 january 1st 1970 */
static long servermsecs(){
	static struct timeval tv;
	static long serverstart = -1;
	if(serverstart == -1){
		serverstart = 0;
		serverstart = servermsecs();
	}
	gettimeofday(&tv, 0);
	return 1000 * tv.tv_sec + tv.tv_usec/ 1000 - serverstart;
}

void printuser(struct user *u){
	printf("user %d: name = %s, in game = %p\n", u->id, u->name ? u->name : "(null)", (void *)u->gm);
}

void printgame(struct game *gm){
	struct user *usr;
	printf("game %p: n = %d, state = %d, users =\n", (void *)gm, gm->n, gm->state);
	for(usr = gm->usr; usr; usr = usr->nxt){
		printf("\t");
		printuser(usr);
	}
}

void printgames(){
	struct game *gm= headgame;
	if(!gm) printf("no games active\n");
	for(; gm; gm=gm->nxt)
		printgame(gm);
}

void printseg(struct seg *seg){
	printf("(%.1f, %.1f)->(%.1f, %.1f)",seg->x1,seg->y1,seg->x2,seg->y2);
}
