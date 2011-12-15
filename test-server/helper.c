/******************************************************************
 * JSON HELP FUNCTIONS
 */

#define jsonaddnum cJSON_AddNumberToObject
#define jsonaddstr cJSON_AddStringToObject
#define jsonaddfalse cJSON_AddFalseToObject
#define jsonaddtrue cJSON_AddTrueToObject
#define jsondel	cJSON_Delete

// returns NULL on error
char *jsongetstr(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(debug) printf("json parse error! object '%s' not found!\n", obj);
		return 0;
	}
	return json->valuestring;
}
// returns -1 on error
int jsongetint(cJSON *json, char* obj){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(debug) printf("json parse error! object '%s' not found!\n", obj);
		return -1;
	}
	return json->valueint;
}

void jsonsetstr(cJSON *json, char* obj, char* str){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(debug) printf("json parse error! object '%s' not found!\n", obj);
		return ;
	}
	json->valuestring= str;
}

void jsonsetint(cJSON *json, char* obj, int val){
	json= cJSON_GetObjectItem(json,obj);
	if(!json){
		if(debug) printf("json parse error! object '%s' not found!\n", obj);
		return ;
	}
	json->valuedouble = json->valueint = val;
}

cJSON *jsoncreate(char *mode){
	cJSON *json= cJSON_CreateObject();
	cJSON_AddStringToObject(json, "mode", mode);
	return json;
}

// returns string with on position lwsprepadding the message
char *jsongetpacket(cJSON *json){
	char *tmp, *buf;
	tmp= cJSON_PrintUnformatted(json);
	buf= smalloc(lwsprepadding + strlen(tmp) + 1 + lwspostpadding);
	memcpy(buf + lwsprepadding, tmp, strlen(tmp) + 1);
	free(tmp);
	return buf;
}


/******************************************************************
 * LIBWEBSOCKETS HELP FUNCTIONS
 */

// will not free buf
void sendstr(char *buf, struct user *u){
	char *tmp;
	if(u->sbat==sbmax){
		if(showwarning) printf("send-buffer full.\n");
		return;
	}
	// tmp is being freed inside the callback
	tmp= smalloc(lwsprepadding + strlen(buf + lwsprepadding) + 1 + lwspostpadding);
	memcpy(tmp, buf, lwsprepadding + strlen(buf + lwsprepadding) + 1 + lwspostpadding);
	u->sb[u->sbat++]= tmp;
	if(debug) printf("queued msg %s, will be send to user %d\n", tmp + lwsprepadding, u->id);
	libwebsocket_callback_on_writable(ctx, u->wsi);
}

void sendjson(cJSON *json, struct user *u){
	char *buf = jsongetpacket(json);
	sendstr(buf, u);
	free(buf);
}

/* sends a message to all in game, except for given user. to send message to
 * all, set u = 0 */
void sendjsontogame(cJSON *json, struct game *gm, struct user *u) {
	struct usern *a;
	char *buf = jsongetpacket(json);
	
	for(a= gm->usrn; a; a= a->nxt)
		if(a->usr != u)
			sendstr(buf, a->usr);
			
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

long epochmsecs() {
	struct timeval tv;
	gettimeofday(&tv, 0);
	return 1000 * tv.tv_sec + tv.tv_usec/ 1000;
}

void printuser(struct user *u){
	printf("user %d: name = %s, in game = %p\n", u->id, u->name ? u->name : "(null)", (void *)u->gm);
}

void printgame(struct game *gm){
	struct usern *a;
	printf("game %p: n = %d, state = %d, users =\n", (void *)gm, gm->n, gm->state);
	for(a= gm->usrn; a; a= a->nxt){
		printf("\t");
		printuser(a->usr);
	}
}

void printgames(){
	struct game *gm= headgame;
	if(!gm) printf("no games active\n");
	for(; gm; gm=gm->nxt)
		printgame(gm);
}

